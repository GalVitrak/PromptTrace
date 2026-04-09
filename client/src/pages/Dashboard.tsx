import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, type SessionListItem } from "../api.js";

function verdictLabel(v: string | null) {
  if (!v) return "-";
  if (v === "SAFE") return "Safe";
  if (v === "BORDERLINE") return "Borderline";
  if (v === "FAILED") return "Failed";
  return v;
}

function verdictClass(v: string | null) {
  if (v === "SAFE") return "verdict-safe";
  if (v === "BORDERLINE") return "verdict-borderline";
  if (v === "FAILED") return "verdict-failed";
  return "verdict-none";
}

function SessionOutcomeCell({ s }: { s: SessionListItem }) {
  const scoreLabel =
    s.sessionScore != null
      ? s.isConcluded
        ? `${s.sessionScore}/100`
        : `${s.sessionScore}`
      : null;
  return (
    <div className="session-outcome-cell">
      <div className="session-outcome-row">
        <span
          className={`verdict-pill ${verdictClass(s.aggregateVerdict)}`}
        >
          {verdictLabel(s.aggregateVerdict)}
        </span>
        {scoreLabel != null ? (
          <span className="mono session-outcome-score">{scoreLabel}</span>
        ) : null}
        {s.redTeamSuccess === true ? (
          <span className="verdict-pill verdict-test-success">
            Test success
          </span>
        ) : null}
      </div>
      <div className="muted small session-outcome-meta">
        {s.analyzedTurnCount}/{s.totalTurnCount} analyzed
        {s.isConcluded ? " · Concluded" : ""}
      </div>
    </div>
  );
}

export function Dashboard() {
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const data = await apiJson<SessionListItem[]>("/api/sessions");
        if (!cancel) setSessions(data);
      } catch (e) {
        if (!cancel)
          setError(e instanceof Error ? e.message : "Failed to load sessions");
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Sessions</h1>
          <p className="muted">
            Black-box adversarial test sessions - traceable turns and
            structured evaluation.
          </p>
        </div>
        <Link to="/sessions/new" className="btn btn-primary">
          New session
        </Link>
      </div>

      {error ? (
        <div className="card error-card">{error}</div>
      ) : sessions === null ? (
        <div className="card muted">Loading sessions…</div>
      ) : sessions.length === 0 ? (
        <div className="card empty-card">
          <p>No sessions yet.</p>
          <Link to="/sessions/new" className="btn btn-secondary">
            Start a session
          </Link>
        </div>
      ) : (
        <div className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Outcome</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="cell-title">{s.title}</td>
                  <td>{s.category}</td>
                  <td>
                    <SessionOutcomeCell s={s} />
                  </td>
                  <td className="mono muted">
                    {new Date(s.updatedAt).toLocaleString()}
                  </td>
                  <td className="cell-actions">
                    <Link
                      to={`/sessions/${s.id}`}
                      className="btn btn-ghost btn-small"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
