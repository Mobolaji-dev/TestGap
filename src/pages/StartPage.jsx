import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { listProjects, createRun, formatErrorDetail, ApiError } from "../api/client";
import ProjectCard from "../components/ProjectCard";
import "./StartPage.css";

const TARGET_LIMIT_MIN = 1;
const TARGET_LIMIT_MAX = 10;
const TARGET_LIMIT_DEFAULT = 3;

const REPAIR_LIMIT_MIN = 0;
const REPAIR_LIMIT_MAX = 2;
const REPAIR_LIMIT_DEFAULT = 2;

/**
 * Start screen - project selector and scan configuration
 */
export default function StartPage() {
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [slowBackend, setSlowBackend] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(null);

  // Form state
  const [targetLimit, setTargetLimit] = useState(TARGET_LIMIT_DEFAULT);
  const [repairLimit, setRepairLimit] = useState(REPAIR_LIMIT_DEFAULT);
  const [verifyMutations, setVerifyMutations] = useState(true);

  // Validation errors
  const [targetError, setTargetError] = useState(null);
  const [repairError, setRepairError] = useState(null);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // For slow backend timeout
  const slowBackendTimeout = useRef(null);

  // Fetch projects on mount
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setLoading(true);
        setError(null);

        // Set timeout for slow backend message
        slowBackendTimeout.current = setTimeout(() => {
          setSlowBackend(true);
        }, 6000);

        const data = await listProjects();
        
        // Defensive check: ensure data is an array
        if (!Array.isArray(data)) {
          setError("Invalid projects response from backend");
          setLoading(false);
          return;
        }

        setProjects(data);

        // Try to preselect "demo-flask-shop" if it exists and is ready
        const demoProject = data.find(
          (p) => p.name === "demo-flask-shop" && p.ready
        );
        if (demoProject) {
          setSelectedProjectId(demoProject.id);
        }

        // Clear slow backend message if we got results
        if (slowBackendTimeout.current) {
          clearTimeout(slowBackendTimeout.current);
          setSlowBackend(false);
        }
      } catch (err) {
        setError(err instanceof ApiError ? formatErrorDetail(err.detail) : err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();

    return () => {
      if (slowBackendTimeout.current) {
        clearTimeout(slowBackendTimeout.current);
      }
    };
  }, []);

  // Validate target limit
  const validateTargetLimit = (value) => {
    const num = Number(value);
    if (isNaN(num)) {
      setTargetError("Must be a number");
      return false;
    }
    if (num < TARGET_LIMIT_MIN || num > TARGET_LIMIT_MAX) {
      setTargetError(`Must be between ${TARGET_LIMIT_MIN} and ${TARGET_LIMIT_MAX}`);
      return false;
    }
    setTargetError(null);
    return true;
  };

  // Validate repair limit
  const validateRepairLimit = (value) => {
    const num = Number(value);
    if (isNaN(num)) {
      setRepairError("Must be a number");
      return false;
    }
    if (num < REPAIR_LIMIT_MIN || num > REPAIR_LIMIT_MAX) {
      setRepairError(`Must be between ${REPAIR_LIMIT_MIN} and ${REPAIR_LIMIT_MAX}`);
      return false;
    }
    setRepairError(null);
    return true;
  };

  const handleTargetLimitChange = (e) => {
    const value = e.target.value;
    setTargetLimit(value);
    validateTargetLimit(value);
  };

  const handleRepairLimitChange = (e) => {
    const value = e.target.value;
    setRepairLimit(value);
    validateRepairLimit(value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    // Validate all fields
    if (!validateTargetLimit(targetLimit)) return;
    if (!validateRepairLimit(repairLimit)) return;

    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    if (!selectedProject || !selectedProject.ready) {
      setSubmitError("Please select a ready project");
      return;
    }

    try {
      setIsSubmitting(true);

      const response = await createRun({
        project_id: selectedProjectId,
        target_limit: Number(targetLimit),
        repair_limit: Number(repairLimit),
        verify_mutations: verifyMutations,
      });

      // Navigate to run page
      navigate(`/run/${response.run_id}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? formatErrorDetail(err.detail) : err.message
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedProject = Array.isArray(projects) 
    ? projects.find((p) => p.id === selectedProjectId)
    : null;
  const canStartScan = selectedProject?.ready && !isSubmitting && !targetError && !repairError;

  return (
    <div className="start-page">
      <div className="start-page-container">
        {/* Header */}
        <section className="start-page-header">
          <h1 className="text-display-xl">TestGap Finder</h1>
          <p className="text-body-lg start-page-description">
            Discover gaps in the test coverage of your repository. Select a project and
            configure your scan.
          </p>
        </section>

        {/* Notice panel */}
        <div className="notice-panel">
          <h2 className="text-body-md notice-panel-heading">Current Capabilities</h2>
          <ul className="text-body-sm">
            <li>Baseline coverage scanning</li>
            <li>Target ranking</li>
            <li>Draft test generation</li>
            <li>
              <em>Test execution, repair, and mutation verification coming soon.</em>
            </li>
          </ul>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="start-page-form">
          {/* Loading state */}
          {loading && (
            <div className="projects-section">
              <h2 className="text-heading-lg projects-heading">Projects</h2>
              <div className="projects-grid">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="project-card-skeleton" />
                ))}
              </div>
            </div>
          )}

          {/* Slow backend message */}
          {slowBackend && loading && (
            <div className="slow-backend-message text-body-sm">
              The backend may be waking up. This can take up to a minute.
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="error-section">
              <p className="text-body-sm error-message">{error}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="retry-button"
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && projects.length === 0 && (
            <div className="empty-section">
              <p className="text-body-lg">No projects available</p>
              <p className="text-body-sm">
                The backend needs a local or demo repository to scan. Please set up a
                project and try again.
              </p>
            </div>
          )}

          {/* Success state - projects list */}
          {!loading && !error && projects.length > 0 && (
            <div className="projects-section">
              <h2 className="text-heading-lg projects-heading">Projects</h2>
              <div className="projects-grid">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    isSelected={selectedProjectId === project.id}
                    onSelect={setSelectedProjectId}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Controls - target limit */}
          <div className="form-group">
            <label htmlFor="target-limit" className="text-body-md form-label">
              Target Limit
            </label>
            <input
              id="target-limit"
              type="number"
              min={TARGET_LIMIT_MIN}
              max={TARGET_LIMIT_MAX}
              value={targetLimit}
              onChange={handleTargetLimitChange}
              className="form-input"
              aria-describedby={targetError ? "target-error" : undefined}
            />
            {targetError && (
              <p id="target-error" className="text-body-sm form-error">
                {targetError}
              </p>
            )}
          </div>

          {/* Controls - repair limit */}
          <div className="form-group">
            <label htmlFor="repair-limit" className="text-body-md form-label">
              Repair Limit
            </label>
            <input
              id="repair-limit"
              type="number"
              min={REPAIR_LIMIT_MIN}
              max={REPAIR_LIMIT_MAX}
              value={repairLimit}
              onChange={handleRepairLimitChange}
              className="form-input"
              aria-describedby={repairError ? "repair-error" : undefined}
            />
            {repairError && (
              <p id="repair-error" className="text-body-sm form-error">
                {repairError}
              </p>
            )}
          </div>

          {/* Controls - verify mutations toggle */}
          <div className="form-group form-group-toggle">
            <label htmlFor="verify-mutations" className="text-body-md form-label">
              <input
                id="verify-mutations"
                type="checkbox"
                checked={verifyMutations}
                onChange={(e) => setVerifyMutations(e.target.checked)}
                className="form-checkbox"
              />
              <span>Verify Mutations</span>
            </label>
            <p className="text-body-sm form-helper-text">
              The backend does not run mutation verification yet.
            </p>
          </div>

          {/* Submit error */}
          {submitError && (
            <div className="submit-error">
              <p className="text-body-sm error-message">{submitError}</p>
              <button
                type="button"
                onClick={() => setSubmitError(null)}
                className="try-again-button"
              >
                Try again
              </button>
            </div>
          )}

          {/* Submit button */}
          <div className="form-actions">
            <button
              type="submit"
              disabled={!canStartScan}
              className="start-scan-button"
              aria-live="polite"
            >
              Start Scan
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
