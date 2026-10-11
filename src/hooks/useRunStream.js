import { useState, useEffect, useRef, useCallback } from "react";
import { getRun, cancelRun, eventsUrl, ApiError, formatErrorDetail } from "../api/client";

/**
 * Custom hook for managing a run's real-time event stream
 * Handles hydration, SSE connection, event deduplication, reconnection with backoff,
 * polling fallback, and terminal state detection.
 *
 * @param {string} runId - The run ID to stream events for
 * @returns {{
 *   run: Object | null,
 *   events: Array,
 *   connection: string,
 *   error: string | null,
 *   refresh: Function,
 *   cancel: Function,
 *   isCancelling: boolean
 * }}
 */
export default function useRunStream(runId) {
  const [run, setRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [connection, setConnection] = useState("connecting");
  const [error, setError] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const eventSourceRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const reconcileIntervalRef = useRef(null);
  const eventIdsRef = useRef(new Set());
  const lastEventIdRef = useRef(null);
  const abortControllerRef = useRef(new AbortController());

  // Track if run is terminal (based on latest state)
  const isTerminal = (status) =>
    status === "completed" ||
    status === "completed_with_warnings" ||
    status === "failed" ||
    status === "cancelled";

  /**
   * Parse an SSE event and extract the data
   */
  const parseEvent = (eventData) => {
    try {
      return JSON.parse(eventData);
    } catch {
      return null;
    }
  };

  /**
   * Add or update event in state, keeping sorted by event_id
   */
  const mergeEvent = (newEvent) => {
    setEvents((prevEvents) => {
      // Check if we've already seen this event
      if (eventIdsRef.current.has(newEvent.id)) {
        return prevEvents;
      }

      eventIdsRef.current.add(newEvent.id);
      lastEventIdRef.current = newEvent.id;

      // Add and sort by event_id
      const updated = [...prevEvents, newEvent];
      updated.sort((a, b) => {
        const aId = parseInt(a.id, 10) || 0;
        const bId = parseInt(b.id, 10) || 0;
        return aId - bId;
      });

      return updated;
    });
  };

  /**
   * Hydrate run data and seed events from initial state
   */
  const hydrate = useCallback(async () => {
    try {
      const data = await getRun(runId, abortControllerRef.current.signal);
      setRun(data);
      setError(null);

      // Seed events from the initial run state
      if (Array.isArray(data.events)) {
        data.events.forEach((evt) => {
          if (!eventIdsRef.current.has(evt.id)) {
            mergeEvent(evt);
          }
        });
      }

      return data;
    } catch (err) {
      if (err.name !== "AbortError") {
        const msg = err instanceof ApiError ? formatErrorDetail(err.detail) : err.message;
        setError(msg);
      }
      return null;
    }
  }, [runId]);

  /**
   * Open EventSource connection for live events
   */
  const openStream = useCallback(() => {
    if (eventSourceRef.current) {
      return; // Already open
    }

    const url = eventsUrl(runId, lastEventIdRef.current);
    const eventSource = new EventSource(url);

    // List of event types to listen for
    const eventTypes = [
      "run.queued",
      "run.started",
      "step.started",
      "step.completed",
      "step.failed",
      "warning",
      "run.completed",
      "run.failed",
      "run.cancelled",
    ];

    // Register listeners for each named event type
    eventTypes.forEach((eventType) => {
      eventSource.addEventListener(eventType, (e) => {
        const evt = parseEvent(e.data);
        if (evt) {
          mergeEvent(evt);
          if (isTerminal(evt.status) || evt.type === "run.completed" || evt.type === "run.failed" || evt.type === "run.cancelled") {
            closeStream();
            hydrate(); // Get canonical final state
          }
        }
      });
    });

    // Also listen for unnamed events (onmessage)
    eventSource.onmessage = (e) => {
      const evt = parseEvent(e.data);
      if (evt) {
        mergeEvent(evt);
      }
    };

    eventSource.onerror = () => {
      closeStream();
      handleStreamError();
    };

    eventSourceRef.current = eventSource;
    setConnection("live");
    reconnectAttemptsRef.current = 0;
  }, [runId, hydrate]);

  /**
   * Close EventSource connection
   */
  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  /**
   * Handle stream error with backoff and fallback to polling
   */
  const handleStreamError = useCallback(() => {
    reconnectAttemptsRef.current += 1;

    if (reconnectAttemptsRef.current <= 3) {
      // Backoff: 1s, 2s, 4s
      const backoffMs = Math.pow(2, reconnectAttemptsRef.current - 1) * 1000;
      setConnection("reconnecting");

      reconnectTimeoutRef.current = setTimeout(() => {
        openStream();
      }, backoffMs);
    } else {
      // Switch to polling
      setConnection("polling");
      startPolling();
    }
  }, [openStream]);

  /**
   * Start polling for run updates as fallback
   */
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      return; // Already polling
    }

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const data = await getRun(runId, abortControllerRef.current.signal);
        setRun(data);

        // Merge any new events
        if (Array.isArray(data.events)) {
          data.events.forEach((evt) => {
            if (!eventIdsRef.current.has(evt.id)) {
              mergeEvent(evt);
            }
          });
        }

        // If terminal, stop polling
        if (isTerminal(data.status)) {
          stopPolling();
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          // Log but don't crash polling
          console.error("Polling error:", err);
        }
      }
    }, 3000);
  }, [runId]);

  /**
   * Stop polling
   */
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  /**
   * Reconcile with server every 5 seconds while active (safety net)
   */
  const startReconcile = useCallback(() => {
    if (reconcileIntervalRef.current) {
      return;
    }

    reconcileIntervalRef.current = setInterval(async () => {
      try {
        const data = await getRun(runId, abortControllerRef.current.signal);

        // Merge any new events we haven't seen
        if (Array.isArray(data.events)) {
          data.events.forEach((evt) => {
            if (!eventIdsRef.current.has(evt.id)) {
              mergeEvent(evt);
            }
          });
        }

        // Check if status changed to terminal
        if (run && !isTerminal(run.status) && isTerminal(data.status)) {
          closeStream();
          stopPolling();
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Reconcile error:", err);
        }
      }
    }, 5000);
  }, [runId, run, closeStream, stopPolling]);

  /**
   * Stop reconciliation
   */
  const stopReconcile = useCallback(() => {
    if (reconcileIntervalRef.current) {
      clearInterval(reconcileIntervalRef.current);
      reconcileIntervalRef.current = null;
    }
  }, []);

  /**
   * Refresh: get fresh run data
   */
  const refresh = useCallback(async () => {
    const data = await hydrate();
    return data;
  }, [hydrate]);

  /**
   * Cancel the run
   */
  const cancel = useCallback(async () => {
    try {
      setIsCancelling(true);
      await cancelRun(runId, abortControllerRef.current.signal);
      await hydrate();
    } catch (err) {
      const msg = err instanceof ApiError ? formatErrorDetail(err.detail) : err.message;
      setError(msg);
    } finally {
      setIsCancelling(false);
    }
  }, [runId, hydrate]);

  /**
   * Main effect: hydrate and open stream/polling based on status
   */
  useEffect(() => {
    const init = async () => {
      const data = await hydrate();

      if (!data) {
        // Error already set by hydrate
        return;
      }

      // If already terminal, don't open stream
      if (isTerminal(data.status)) {
        setConnection("closed");
        return;
      }

      // Otherwise, open stream and start reconculation
      openStream();
      startReconcile();
    };

    init();

    // Cleanup on unmount or runId change
    return () => {
      closeStream();
      stopPolling();
      stopReconcile();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      // Don't abort here; let the component decide
    };
  }, [runId, hydrate, openStream, startReconcile, closeStream, stopPolling, stopReconcile]);

  return {
    run,
    events,
    connection,
    error,
    refresh,
    cancel,
    isCancelling,
  };
}
