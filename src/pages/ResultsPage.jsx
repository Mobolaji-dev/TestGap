import { useParams } from "react-router-dom";
import "./ResultsPage.css";

/**
 * Results page - placeholder showing run ID and message
 */
export default function ResultsPage() {
  const { runId } = useParams();

  return (
    <div className="results-page">
      <div className="results-page-container">
        <h1 className="text-display-xl">Results Screen</h1>
        <p className="text-body-lg results-page-message">
          Run ID: <span className="text-code-md">{runId}</span>
        </p>
        <p className="text-body-lg results-page-message">
          Results screen coming next.
        </p>
      </div>
    </div>
  );
}
