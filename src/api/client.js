/**
 * Custom error class for API responses
 */
export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `API Error: ${status}`);
    this.status = status;
    this.detail = detail;
    this.name = "ApiError";
  }
}

/**
 * Convert error detail (string or validation error array) into readable format
 * @param {string | Array} detail - Error detail from API response
 * @returns {string} Human-readable error message
 */
export function formatErrorDetail(detail) {
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    // Handle validation errors: array of objects with 'msg' or 'detail' field
    return detail
      .map((error) => {
        if (typeof error === "string") {
          return error;
        }
        if (error.msg) {
          return error.msg;
        }
        if (error.detail) {
          return error.detail;
        }
        return String(error);
      })
      .join("; ");
  }

  return String(detail);
}

/**
 * Make an API request with proper headers and error handling
 * @param {string} path - API path (e.g., "/api/projects")
 * @param {Object} options - Fetch options
 * @param {AbortSignal} options.signal - Optional abort signal for cancellation
 * @returns {Promise<any>} Parsed JSON response
 * @throws {ApiError} On non-2xx status
 */
async function apiCall(path, options = {}) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
  const url = `${baseUrl}${path}`;

  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Response body is not JSON or is empty
  }

  if (!response.ok) {
    // Extract detail from error response
    const detail = data?.detail || data?.message || response.statusText || `HTTP ${response.status}`;
    throw new ApiError(response.status, detail);
  }

  return data;
}

/**
 * GET /api/projects
 * Fetch list of all projects
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<Array<{
 *   id: string,
 *   name: string,
 *   repo_url: string,
 *   language: string,
 *   test_framework: string,
 *   path_label: string,
 *   ready: boolean,
 *   warning: string | null
 * }>>} List of project objects (always an array)
 */
export async function listProjects(signal = null) {
  const data = await apiCall("/api/projects", { signal });
  // API returns { projects: [...] }, unwrap to array
  return data.projects ?? [];
}

/**
 * POST /api/runs
 * Create a new test scan run
 * @param {Object} payload - Run creation payload
 * @param {string} payload.project_id - Project ID to scan
 * @param {number} payload.target_limit - Max number of targets to test (1-10)
 * @param {number} payload.repair_limit - Max number of repairs per target (0-2)
 * @param {boolean} payload.verify_mutations - Whether to verify mutations
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<{
 *   run_id: string,
 *   status: string
 * }>} Created run with run_id
 */
export async function createRun(payload, signal = null) {
  return apiCall("/api/runs", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

/**
 * GET /api/runs/:run_id
 * Fetch details of a specific run
 * @param {string} runId - The run ID
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<{
 *   run_id: string,
 *   project_id: string,
 *   status: string,
 *   target_limit: number,
 *   repair_limit: number,
 *   verify_mutations: boolean,
 *   targets: Array,
 *   baseline_coverage: number | null,
 *   created_at: string,
 *   updated_at: string,
 *   message: string | null,
 *   events: Array<{id: string, type: string, timestamp: string, step: string | null, status: string, message: string, data: any}>,
 *   warnings: Array<string> | null,
 *   current_step: string | null
 * }>} Run details
 */
export async function getRun(runId, signal = null) {
  return apiCall(`/api/runs/${runId}`, { signal });
}

/**
 * Get the EventSource URL for a run's events
 * @param {string} runId - The run ID
 * @param {string | null} afterEventId - Optional: resume after this event ID
 * @returns {string} Full EventSource URL
 */
export function eventsUrl(runId, afterEventId = null) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
  const path =
    afterEventId != null && afterEventId !== ""
      ? `/api/runs/${runId}/events?after=${encodeURIComponent(afterEventId)}`
      : `/api/runs/${runId}/events`;
  return `${baseUrl}${path}`;
}

/**
 * POST /api/runs/:run_id/cancel
 * Cancel a specific run
 * @param {string} runId - The run ID
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<{
 *   run_id: string,
 *   status: string
 * }>} Updated run
 */
export async function cancelRun(runId, signal = null) {
  return apiCall(`/api/runs/${runId}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
    signal,
  });
}

/**
 * GET /api/runs/:run_id/diff
 * Fetch diff results for a run
 * @param {string} runId - The run ID
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<{
 *   run_id: string,
 *   diff: string | null
 * }>} Diff content
 */
export async function getDiff(runId, signal = null) {
  return apiCall(`/api/runs/${runId}/diff`, { signal });
}

/**
 * PATCH /api/runs/:run_id
 * Update a run's URL (when code changes)
 * @param {string} runId - The run ID
 * @param {Object} payload - Update payload
 * @param {string} payload.repo_url - New repository URL
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<{
 *   run_id: string,
 *   repo_url: string
 * }>} Updated run
 */
export async function patchUrl(runId, payload, signal = null) {
  return apiCall(`/api/runs/${runId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    signal,
  });
}

/**
 * GET /api/health
 * Check backend health
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<{
 *   status: string
 * }>} Health status
 */
export async function health(signal = null) {
  return apiCall("/api/health", { signal });
}
