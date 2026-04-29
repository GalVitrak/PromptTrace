import { useEffect, useMemo, useState } from "react";
import {
  CTF_STRATEGY_CATEGORIES,
} from "@prompttrace/shared";
import {
  apiJson,
  type CtfRun,
} from "../api.js";

export function CtfMode() {
  type CtfCreateFormState = {
    attackVector: string;
    runName: string;
    challengeObjective: string;
  };
  const [runs, setRuns] = useState<CtfRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState<string | null>(
    null,
  );
  const [candidatePrompt, setCandidatePrompt] =
    useState("");
  const [ctfInstruction, setCtfInstruction] =
    useState("");
  const [pastedResponse, setPastedResponse] =
    useState("");
  const [analyzeLoading, setAnalyzeLoading] =
    useState(false);
  const [exportLoading, setExportLoading] =
    useState(false);
  const [createForm, setCreateForm] =
    useState<CtfCreateFormState>({
    attackVector:
      CTF_STRATEGY_CATEGORIES[0] ?? "Prompt Injection",
    runName: "CTF iterative run",
    challengeObjective: "",
  });
  const [currentVector, setCurrentVector] = useState<string>(
    CTF_STRATEGY_CATEGORIES[0] ?? "Prompt Injection",
  );

  const activeRun = useMemo(
    () =>
      runs.find((r) => r.id === activeRunId) ?? null,
    [runs, activeRunId],
  );

  async function loadRuns() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<CtfRun[]>(
        "/api/ctf/runs",
      );
      setRuns(data);
      setActiveRunId((prev) =>
        prev && data.some((r) => r.id === prev)
          ? prev
          : data[0]?.id ?? null,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to load CTF runs",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRuns();
  }, []);

  async function createRunAndSeedPrompt(
    e: React.FormEvent,
  ) {
    e.preventDefault();
    setStatus(null);
    setError(null);
    const objective = createForm.challengeObjective.trim();
    if (!objective) {
      setError("Provide a challenge objective first.");
      return;
    }
    try {
      const run = await apiJson<CtfRun>("/api/ctf/runs", {
        method: "POST",
        body: JSON.stringify({
          attackerModel: "openai-default",
          targetModel: "black-box-target",
          judgeModel: "openai-default",
          strategyCategory: createForm.attackVector,
          strategyName:
            createForm.runName.trim() || "CTF iterative run",
          challengeObjective:
            objective,
          difficulty: "MEDIUM",
          guardrailProfile: "ctf",
          tags: [],
          attackerProvider: { providerType: "default" },
          targetProvider: { providerType: "default" },
          judgeProvider: {
            providerType: "default",
          },
        }),
      });
      const generated = await apiJson<{
        candidateAttackPrompt: string;
      }>(`/api/ctf/runs/${run.id}/generate-attack`, {
        method: "POST",
        body: JSON.stringify({
          analystInstruction:
            ctfInstruction.trim() || undefined,
          vectorOverride: createForm.attackVector,
        }),
      });
      setRuns((prev) => [run, ...prev]);
      setActiveRunId(run.id);
      setCurrentVector(run.strategyCategory);
      setCandidatePrompt(generated.candidateAttackPrompt);
      setPastedResponse("");
      setStatus(
        "CTF run created and first prompt generated.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not create run",
      );
    }
  }

  async function generateCandidate() {
    if (!activeRun) return;
    setStatus(null);
    setError(null);
    try {
      const out = await apiJson<{
        candidateAttackPrompt: string;
      }>(`/api/ctf/runs/${activeRun.id}/generate-attack`, {
        method: "POST",
        body: JSON.stringify({
          analystInstruction:
            ctfInstruction.trim() || undefined,
          vectorOverride: currentVector,
          providerOverride: {
            providerType: "default",
          },
        }),
      });
      setCandidatePrompt(out.candidateAttackPrompt);
      setStatus("Candidate attack prompt generated.");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not generate candidate",
      );
    }
  }

  async function analyzePastedResponseTurn() {
    if (
      !activeRun ||
      !candidatePrompt.trim() ||
      !pastedResponse.trim()
    )
      return;
    setStatus(null);
    setError(null);
    setAnalyzeLoading(true);
    try {
      const out = await apiJson<{
        run: CtfRun;
        judgeLabel: string | null;
        suggestedNextPrompt: string | null;
      }>(`/api/ctf/runs/${activeRun.id}/analyze-response`, {
        method: "POST",
        body: JSON.stringify({
          prompt: candidatePrompt,
          pastedResponse,
          ctfInstruction:
            ctfInstruction.trim() || undefined,
          vectorOverride: currentVector,
          autoJudge: true,
          judgeProviderOverride: {
            providerType: "default",
          },
        }),
      });
      setRuns((prev) =>
        prev.map((r) =>
          r.id === out.run.id ? out.run : r,
        ),
      );
      if (out.suggestedNextPrompt?.trim()) {
        setCandidatePrompt(out.suggestedNextPrompt);
      }
      setPastedResponse("");
      setStatus(
        out.judgeLabel
          ? `Response analyzed. Judge label: ${out.judgeLabel}`
          : "Response analyzed.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not analyze response",
      );
    } finally {
      setAnalyzeLoading(false);
    }
  }

  async function downloadCtfReport(runId: string) {
    setExportLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ctf/runs/${runId}/export?format=md`,
      );
      const blob = await res.blob();
      if (!res.ok) {
        let msg = `Export failed (${res.status})`;
        try {
          const j = JSON.parse(await blob.text()) as {
            error?: string;
          };
          if (typeof j.error === "string") msg = j.error;
        } catch {
          /* ignore */
        }
        setError(msg);
        return;
      }
      const cd = res.headers.get("Content-Disposition");
      let filename = `ctf-${runId}-report.md`;
      const m = cd?.match(/filename="([^"]+)"/);
      if (m?.[1]) filename = m[1];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Report downloaded.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Export failed",
      );
    } finally {
      setExportLoading(false);
    }
  }

  return (
    <div className="page ctf-page">
      <div className="page-header">
        <div>
          <h1>CTF mode</h1>
          <p className="muted">
            {"Objective -> generate prompt -> paste black-box response -> analyze -> next prompt."}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card error-card">{error}</div>
      ) : null}
      {status ? (
        <div className="card">{status}</div>
      ) : null}

      <div className="ctf-grid">
        <form
          className="card form-card"
          onSubmit={createRunAndSeedPrompt}
        >
          <h2>Start CTF loop</h2>
          <label className="field">
            <span>Run name (optional)</span>
            <input
              value={createForm.runName}
              onChange={(e) =>
                setCreateForm((p) => ({
                  ...p,
                  runName: e.target.value,
                }))
              }
              placeholder="CTF iterative run"
            />
          </label>
          <label className="field">
            <span>Strategy</span>
            <select
              value={createForm.attackVector}
              onChange={(e) =>
                setCreateForm((p) => ({
                  ...p,
                  attackVector: e.target.value,
                }))
              }
            >
              {CTF_STRATEGY_CATEGORIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Initiative / objective</span>
            <textarea
              value={createForm.challengeObjective}
              onChange={(e) =>
                setCreateForm((p) => ({
                  ...p,
                  challengeObjective:
                    e.target.value,
                }))
              }
              rows={4}
              placeholder="Paste the objective here. Example: get the model to leak internal instructions through policy-compliant probing."
              required
            />
          </label>
          <p className="muted small">
            Prompt generation and analysis run through the default backend
            using your server OpenAI configuration.
          </p>
          <div className="panel-actions">
            <button
              type="submit"
              className="btn btn-primary"
            >
              Start and generate first prompt
            </button>
          </div>
        </form>

        <div className="card">
          <h2>Runs</h2>
          {loading ? (
            <p className="muted">Loading runs…</p>
          ) : runs.length === 0 ? (
            <p className="muted">
              No CTF runs yet.
            </p>
          ) : (
            <div className="ctf-run-list">
              {runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`btn btn-secondary ${activeRunId === r.id ? "active-run-btn" : ""}`}
                  onClick={() =>
                    setActiveRunId(r.id)
                  }
                >
                  {r.strategyName} ({r.id})
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeRun ? (
        <section className="card">
          <h2>
            Active run: {activeRun.strategyName}
          </h2>
          <p className="muted small">
            {currentVector} · {activeRun.difficulty}
          </p>
          {activeRun.challengeObjective ? (
            <p className="muted small">
              Objective:{" "}
              {activeRun.challengeObjective}
              {activeRun.flagFormatHint
                ? ` · Flag hint: ${activeRun.flagFormatHint}`
                : ""}
            </p>
          ) : null}
          <div className="panel-actions">
            <a
              className="btn btn-ghost btn-small"
              href={`/api/ctf/runs/${activeRun.id}/export?format=json`}
              download
            >
              Export JSON
            </a>
            <a
              className="btn btn-ghost btn-small"
              href={`/api/ctf/runs/${activeRun.id}/export?format=csv`}
              download
            >
              Export CSV
            </a>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={exportLoading}
              onClick={() =>
                void downloadCtfReport(activeRun.id)
              }
            >
              {exportLoading
                ? "Exporting…"
                : "Export report (.md)"}
            </button>
          </div>
          <div className="ctf-active-toolbar">
            <label className="field">
              <span>Strategy (switch anytime)</span>
              <select
                value={currentVector}
                onChange={(e) =>
                  setCurrentVector(e.target.value)
                }
              >
                {CTF_STRATEGY_CATEGORIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                void generateCandidate()
              }
            >
              Generate prompt
            </button>
          </div>
          <label className="field ctf-instructions-field">
            <span>CTF instructions (optional)</span>
            <textarea
              value={ctfInstruction}
              onChange={(e) =>
                setCtfInstruction(e.target.value)
              }
              rows={3}
              placeholder="Tell the assistant how to approach this challenge phase."
            />
          </label>
          <label className="field">
            <span>Current prompt to send to black box</span>
            <textarea
              value={candidatePrompt}
              onChange={(e) =>
                setCandidatePrompt(e.target.value)
              }
              rows={6}
              className="response-input"
            />
          </label>
          <div className="panel-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                analyzeLoading ||
                !candidatePrompt.trim() ||
                !pastedResponse.trim()
              }
              onClick={() =>
                void analyzePastedResponseTurn()
              }
            >
              {analyzeLoading
                ? "Analyzing..."
                : "Analyze pasted response"}
            </button>
            {activeRun.transcript.length > 0 ? (
              <span className="verdict-pill verdict-borderline">
                Latest:{" "}
                {activeRun.transcript[
                  activeRun.transcript.length - 1
                ]?.judgeLabel ?? "INCONCLUSIVE"}
              </span>
            ) : null}
          </div>
          <label className="field">
            <span>
              Paste black-box response
            </span>
            <textarea
              value={pastedResponse}
              onChange={(e) =>
                setPastedResponse(e.target.value)
              }
              rows={6}
              className="response-input"
              placeholder="Paste model output, click Analyze, then use the suggested next prompt."
            />
          </label>
          <h3>Transcript</h3>
          {activeRun.transcript.length === 0 ? (
            <p className="muted small">
              No turns yet.
            </p>
          ) : (
            <div className="history-list">
              {[...activeRun.transcript]
                .reverse()
                .map((t) => (
                  <div
                    key={`${activeRun.id}-${t.turnNumber}`}
                    className="history-card card"
                  >
                    <div className="history-card-head">
                      <span className="mono">
                        Turn {t.turnNumber}
                      </span>
                      <span className="verdict-pill verdict-borderline">
                        {t.judgeLabel ??
                          "UNLABELED"}
                      </span>
                    </div>
                    <pre className="prompt-block small">
                      {t.promptSent}
                    </pre>
                    <pre className="prompt-block small muted-bg">
                      {t.targetResponse}
                    </pre>
                  </div>
                ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
