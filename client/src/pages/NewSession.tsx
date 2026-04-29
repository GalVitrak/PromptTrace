import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ATTACK_STRATEGIES,
  CATEGORIES,
  MODEL_TYPES,
} from "@prompttrace/shared";
import { apiJson } from "../api.js";

export function NewSession() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [modelType, setModelType] =
    useState<string>(MODEL_TYPES[0]);
  const [modelNotes, setModelNotes] =
    useState("");
  const [category, setCategory] =
    useState<string>(CATEGORIES[0]);
  const [strategy, setStrategy] =
    useState<string>(ATTACK_STRATEGIES[0]);
  const [objective, setObjective] = useState("");
  const [aggressive, setAggressive] =
    useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<
    string | null
  >(null);

  async function handleSubmit(
    e: React.FormEvent,
  ) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = {
        title: title.trim() || undefined,
        modelType,
        modelNameOrNotes:
          modelNotes.trim() || undefined,
        category,
        strategy,
        objective: objective.trim() || undefined,
        aggressive: aggressive || undefined,
        provider: {
          providerType: "default" as const,
        },
        generateFirstTurn: true as const,
      };
      const session = await apiJson<{
        id: string;
      }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create session",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page narrow">
      <div className="page-header">
        <div>
          <h1>New session</h1>
          <p className="muted">
            Configure target context and taxonomy.
            The first adversarial test prompt is
            generated for analyst review before
            use in the black-box system.
          </p>
        </div>
      </div>

      <form
        className="card form-card"
        onSubmit={handleSubmit}
      >
        {error ? (
          <div className="form-error">
            {error}
          </div>
        ) : null}

        <label className="field">
          <span>Title (optional)</span>
          <input
            value={title}
            onChange={(e) =>
              setTitle(e.target.value)
            }
            placeholder="Defaults to category + date"
            maxLength={500}
          />
        </label>

        <label className="field">
          <span>Model type</span>
          <select
            value={modelType}
            onChange={(e) =>
              setModelType(e.target.value)
            }
          >
            {MODEL_TYPES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {modelType === "Text-to-Image" ? (
            <span className="muted small block">
              On the workbench you can paste, upload, or paste a public image URL
              for review (vision-capable analysis when the API key is set).
            </span>
          ) : null}
        </label>

        <label className="field">
          <span>
            Target model notes (optional)
          </span>
          <input
            value={modelNotes}
            onChange={(e) =>
              setModelNotes(e.target.value)
            }
            placeholder="e.g. provider, version, modalities"
          />
        </label>

        <label className="field">
          <span>Category</span>
          <select
            value={category}
            onChange={(e) =>
              setCategory(e.target.value)
            }
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Attack strategy</span>
          <select
            value={strategy}
            onChange={(e) =>
              setStrategy(e.target.value)
            }
          >
            {ATTACK_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Custom objective (optional)</span>
          <textarea
            value={objective}
            onChange={(e) =>
              setObjective(e.target.value)
            }
            rows={4}
            placeholder="Narrow the test objective for this session…"
          />
        </label>

        <label className="field field-checkbox">
          <input
            type="checkbox"
            checked={aggressive}
            onChange={(e) =>
              setAggressive(e.target.checked)
            }
          />
          <span>
            <strong>
              More aggressive first prompt
            </strong>
            <span className="muted block small">
              Stronger indirect pressure and
              tighter scenario framing. Use for
              authorized safety testing only.
            </span>
          </span>
        </label>

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
          >
            {loading
              ? "Generating…"
              : "Generate first prompt"}
          </button>
        </div>
      </form>
    </div>
  );
}
