import { useParams } from "react-router-dom";
import "./RunPage.css";

/**
 * Run page - placeholder showing run ID and message
 */
export default function RunPage() {
  const { runId } = useParams();

  return (
    <div className="run-page">
      <div className="run-page-container">
        <h1 className="text-display-xl">Run Screen</h1>
        <p className="text-body-lg run-page-message">
          Run ID: <span className="text-code-md">{runId}</span>
        </p>
        <p className="text-body-lg run-page-message">
          Run screen coming next.
        </p>
      </div>
    </div>
  );
}
