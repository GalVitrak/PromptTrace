import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClipboardEvent } from "react";
import {
  Link,
  useParams,
} from "react-router-dom";
import {
  ATTACK_STRATEGIES,
  CATEGORIES,
  expectsImageOutputModel,
  getCategoryEvaluationTargets,
  isPastedImageReference,
  MAX_PASTED_IMAGE_DATA_URL_CHARS,
  MAX_PASTED_IMAGE_LINK_CHARS,
} from "@prompttrace/shared";
import {
  apiJson,
  type CategorySpecificTurn,
  type DiscriminatoryBiasTurn,
  type QuotedFailureItem,
  type SessionDetail as SessionDetailType,
  type TestTurn,
  type VerbatimRiskTurn,
} from "../api.js";

function verdictLabel(v: string | null) {
  if (!v) return "-";
  if (v === "SAFE") return "Safe";
  if (v === "BORDERLINE") return "Borderline";
  if (v === "FAILED") return "Failed";
  return v;
}

function verdictClass(v: string | null) {
  if (v === "SAFE") return "verdict-safe";
  if (v === "BORDERLINE")
    return "verdict-borderline";
  if (v === "FAILED") return "verdict-failed";
  return "verdict-none";
}

function metaPressure(
  meta: unknown,
): string | null {
  if (
    meta &&
    typeof meta === "object" &&
    "pressurePoint" in meta
  )
    return String(
      (meta as { pressurePoint: unknown })
        .pressurePoint,
    );
  return null;
}

function metaNotes(meta: unknown): string | null {
  if (
    meta &&
    typeof meta === "object" &&
    "notes" in meta
  ) {
    const n = (meta as { notes: unknown }).notes;
    return n != null ? String(n) : null;
  }
  return null;
}

function metaAggressiveFirst(
  meta: unknown,
): boolean {
  if (
    !meta ||
    typeof meta !== "object" ||
    !("aggressiveFraming" in meta)
  )
    return false;
  return Boolean(
    (meta as { aggressiveFraming: unknown })
      .aggressiveFraming,
  );
}

function nextPromptInstructionFromFlags(
  flags: unknown,
): string | null {
  if (
    !flags ||
    typeof flags !== "object" ||
    !("nextPromptInstruction" in flags)
  )
    return null;
  const v = (
    flags as { nextPromptInstruction: unknown }
  ).nextPromptInstruction;
  return typeof v === "string" &&
    v.trim().length > 0
    ? v
    : null;
}

function parseQuotedFailuresFromTurn(
  turn: TestTurn,
): QuotedFailureItem[] {
  const v = turn.quotedFailures;
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is QuotedFailureItem =>
      !!x &&
      typeof x === "object" &&
      typeof (x as QuotedFailureItem).quote ===
        "string" &&
      typeof (x as QuotedFailureItem)
        .explanation === "string",
  );
}

function parseDiscriminatoryFromTurn(
  turn: TestTurn,
): DiscriminatoryBiasTurn | null {
  const v = turn.discriminatoryBias;
  if (
    !v ||
    typeof v !== "object" ||
    !("detected" in v)
  )
    return null;
  const d = v as DiscriminatoryBiasTurn;
  return typeof d.detected === "boolean"
    ? d
    : null;
}

function parseVerbatimRiskFromTurn(
  turn: TestTurn,
  field:
    | "explicitContentReport"
    | "misinformationReport",
): VerbatimRiskTurn | null {
  const v = turn[field];
  if (
    !v ||
    typeof v !== "object" ||
    !("detected" in v)
  )
    return null;
  const d = v as VerbatimRiskTurn;
  return typeof d.detected === "boolean"
    ? d
    : null;
}

function parseCategorySpecificFromTurn(
  turn: TestTurn,
): CategorySpecificTurn | null {
  const v = turn.categorySpecificReport;
  if (
    !v ||
    typeof v !== "object" ||
    !("detected" in v)
  )
    return null;
  const d = v as CategorySpecificTurn;
  return typeof d.detected === "boolean"
    ? d
    : null;
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

const MAX_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function turnImageDisplayUrl(
  sessionId: string,
  turn: TestTurn,
): string | null {
  const direct =
    turn.pastedModelImageDataUrl?.trim();
  if (direct) return direct;
  if (turn.pastedModelImageAssetPath?.trim())
    return `/api/sessions/${sessionId}/turns/${turn.id}/image`;
  return null;
}

function turnHasImageAttachment(
  turn: TestTurn,
): boolean {
  return !!(
    turn.pastedModelImageDataUrl?.trim() ||
    turn.pastedModelImageAssetPath?.trim()
  );
}

function readImageFileAsDataUrl(
  file: File,
): Promise<string> {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    return Promise.reject(
      new Error(
        `Image must be ${MAX_IMAGE_FILE_BYTES / (1024 * 1024)}MB or smaller`,
      ),
    );
  }
  if (!ALLOWED_IMAGE_MIME.has(file.type)) {
    return Promise.reject(
      new Error(
        "Use a PNG, JPEG, GIF, or WebP image",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const r = fr.result;
      if (typeof r === "string") resolve(r);
      else
        reject(new Error("Could not read image"));
    };
    fr.onerror = () =>
      reject(
        fr.error ?? new Error("Read failed"),
      );
    fr.readAsDataURL(file);
  });
}

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] =
    useState<SessionDetailType | null>(null);
  const [loadError, setLoadError] = useState<
    string | null
  >(null);
  const [pasted, setPasted] = useState("");
  const [analyzeLoading, setAnalyzeLoading] =
    useState(false);
  const [banner, setBanner] = useState<
    string | null
  >(null);
  const [bannerTone, setBannerTone] = useState<
    "ok" | "err"
  >("ok");
  const [
    aggressiveFollowUp,
    setAggressiveFollowUp,
  ] = useState(false);
  const [
    nextPromptInstruction,
    setNextPromptInstruction,
  ] = useState("");
  const [ctxCategory, setCtxCategory] =
    useState("");
  const [ctxStrategy, setCtxStrategy] =
    useState("");
  const [ctxObjective, setCtxObjective] =
    useState("");
  const [ctxSaving, setCtxSaving] =
    useState(false);
  const [statusSaving, setStatusSaving] =
    useState(false);
  const [
    reportExportLoading,
    setReportExportLoading,
  ] = useState(false);
  const [editedNextPrompt, setEditedNextPrompt] =
    useState("");
  const [resuggestLoading, setResuggestLoading] =
    useState(false);
  const [
    resuggestFirstLoading,
    setResuggestFirstLoading,
  ] = useState(false);
  const [
    lockAdvanceLoading,
    setLockAdvanceLoading,
  ] = useState(false);
  const [
    pastedImageDataUrl,
    setPastedImageDataUrl,
  ] = useState<string | null>(null);
  const [imageLinkDraft, setImageLinkDraft] =
    useState("");
  const [
    imagePreviewBroken,
    setImagePreviewBroken,
  ] = useState(false);
  const imageFileInputRef =
    useRef<HTMLInputElement>(null);

  const showBanner = useCallback(
    (msg: string, tone: "ok" | "err" = "ok") => {
      setBanner(msg);
      setBannerTone(tone);
      window.setTimeout(
        () => setBanner(null),
        4500,
      );
    },
    [],
  );

  const load = useCallback(async () => {
    if (!id) return;
    const data = await apiJson<SessionDetailType>(
      `/api/sessions/${id}`,
    );
    setSession(data);
  }, [id]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancel)
          setLoadError(
            e instanceof Error
              ? e.message
              : "Failed to load session",
          );
      }
    })();
    return () => {
      cancel = true;
    };
  }, [load]);

  const sortedTurns = useMemo(
    () =>
      session
        ? [...session.turns].sort(
            (a, b) => a.turnNumber - b.turnNumber,
          )
        : [],
    [session],
  );

  const currentTurn =
    sortedTurns[sortedTurns.length - 1] ?? null;
  const historyTurns =
    sortedTurns.length > 1
      ? sortedTurns.slice(0, -1)
      : [];

  useEffect(() => {
    if (!currentTurn) return;
    setPasted(
      currentTurn.pastedModelResponse ?? "",
    );
  }, [currentTurn?.id]);

  useEffect(() => {
    if (!currentTurn || !id) return;
    const u = turnImageDisplayUrl(
      id,
      currentTurn,
    );
    if (u) {
      setPastedImageDataUrl(u);
      setImageLinkDraft(
        /^https?:\/\//i.test(u) ? u : "",
      );
    } else {
      setPastedImageDataUrl(null);
      setImageLinkDraft("");
    }
    setImagePreviewBroken(false);
  }, [
    currentTurn?.id,
    id,
    currentTurn?.pastedModelImageDataUrl,
    currentTurn?.pastedModelImageAssetPath,
  ]);

  useEffect(() => {
    if (!currentTurn) return;
    setEditedNextPrompt(
      currentTurn.recommendedNextPrompt ?? "",
    );
  }, [
    currentTurn?.id,
    currentTurn?.recommendedNextPrompt,
  ]);

  useEffect(() => {
    if (!currentTurn) return;
    const fromFlags =
      nextPromptInstructionFromFlags(
        currentTurn.heuristicFlags,
      );
    setNextPromptInstruction(fromFlags ?? "");
  }, [currentTurn?.id]);

  useEffect(() => {
    if (!currentTurn) return;
    const f = currentTurn.heuristicFlags;
    if (
      f &&
      typeof f === "object" &&
      "aggressiveFollowUpRequested" in f
    ) {
      setAggressiveFollowUp(
        Boolean(
          (
            f as {
              aggressiveFollowUpRequested?: boolean;
            }
          ).aggressiveFollowUpRequested,
        ),
      );
    } else if (!currentTurn.evaluationVerdict) {
      setAggressiveFollowUp(false);
    }
  }, [
    currentTurn?.id,
    currentTurn?.evaluationVerdict,
  ]);

  useEffect(() => {
    if (!session) return;
    setCtxCategory(session.category);
    setCtxStrategy(session.strategy);
    setCtxObjective(session.objective ?? "");
  }, [
    session?.id,
    session?.category,
    session?.strategy,
    session?.objective,
  ]);

  const attachImageFromFile = useCallback(
    async (file: File) => {
      try {
        const dataUrl =
          await readImageFileAsDataUrl(file);
        if (
          dataUrl.length >
          MAX_PASTED_IMAGE_DATA_URL_CHARS
        ) {
          showBanner(
            "That image is too large after encoding. Try a smaller file.",
            "err",
          );
          return;
        }
        setPastedImageDataUrl(dataUrl);
        setImageLinkDraft("");
        showBanner("Image attached.", "ok");
      } catch (e) {
        showBanner(
          e instanceof Error
            ? e.message
            : "Could not attach image",
          "err",
        );
      }
    },
    [showBanner],
  );

  const onImagePaste = useCallback(
    (e: ClipboardEvent) => {
      if (
        !session ||
        !expectsImageOutputModel(
          session.modelType,
        )
      )
        return;
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      for (const it of items) {
        if (
          it.kind === "file" &&
          it.type.startsWith("image/")
        ) {
          e.preventDefault();
          const f = it.getAsFile();
          if (f) void attachImageFromFile(f);
          break;
        }
      }
    },
    [attachImageFromFile, session],
  );

  const applyImageLink = useCallback(() => {
    const u = imageLinkDraft.trim();
    if (!u) {
      showBanner(
        "Paste an https image link first.",
        "err",
      );
      return;
    }
    if (!isPastedImageReference(u)) {
      showBanner(
        "Enter a full http(s) URL (or use upload / paste for inline images).",
        "err",
      );
      return;
    }
    setPastedImageDataUrl(u);
    setImagePreviewBroken(false);
    showBanner("Image link applied.", "ok");
  }, [imageLinkDraft, showBanner]);

  async function onAnalyze() {
    if (!id || !currentTurn || !session) return;
    const text = pasted.trim();
    const imageSession = expectsImageOutputModel(
      session.modelType,
    );
    if (
      !text &&
      !(imageSession && pastedImageDataUrl)
    ) {
      showBanner(
        imageSession
          ? "Add analyst notes and/or attach the model’s image, then analyze."
          : "Paste the target model response first.",
        "err",
      );
      return;
    }
    setAnalyzeLoading(true);
    try {
      const body: Record<string, unknown> = {
        pastedResponse: pasted,
        aggressive:
          aggressiveFollowUp || undefined,
        nextPromptInstruction:
          nextPromptInstruction.trim() ||
          undefined,
      };
      if (imageSession) {
        body.pastedImageDataUrl =
          pastedImageDataUrl;
      }
      await apiJson<TestTurn>(
        `/api/sessions/${id}/turns/${currentTurn.id}/analyze`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      await load();
      showBanner("Analysis saved.", "ok");
    } catch (e) {
      showBanner(
        e instanceof Error
          ? e.message
          : "Analysis failed",
        "err",
      );
    } finally {
      setAnalyzeLoading(false);
    }
  }

  async function onUpdateSessionContext() {
    if (!id || !session) return;
    setCtxSaving(true);
    try {
      const objectiveTrim = ctxObjective.trim();
      const updated =
        await apiJson<SessionDetailType>(
          `/api/sessions/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              category: ctxCategory,
              strategy: ctxStrategy,
              objective:
                objectiveTrim.length > 0
                  ? objectiveTrim
                  : null,
            }),
          },
        );
      setSession(updated);
      showBanner(
        "Session method updated - applies to the next analysis.",
        "ok",
      );
    } catch (e) {
      showBanner(
        e instanceof Error
          ? e.message
          : "Failed to update session",
        "err",
      );
    } finally {
      setCtxSaving(false);
    }
  }

  async function downloadMarkdownReport() {
    if (!id || !session) return;
    const alreadyConcluded =
      session.status === "ARCHIVED";
    setReportExportLoading(true);
    try {
      const res = await fetch(
        `/api/sessions/${id}/export?format=md`,
      );
      const blob = await res.blob();
      if (!res.ok) {
        let msg = `Export failed (${res.status})`;
        try {
          const j = JSON.parse(
            await blob.text(),
          ) as { error?: string };
          if (typeof j.error === "string")
            msg = j.error;
        } catch {
          /* ignore */
        }
        showBanner(msg, "err");
        return;
      }
      const cd = res.headers.get(
        "Content-Disposition",
      );
      let filename = `prompttrace-${id}-report.md`;
      const m = cd?.match(/filename="([^"]+)"/);
      if (m?.[1]) filename = m[1];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      await load();
      showBanner(
        alreadyConcluded
          ? "Report downloaded."
          : "Report downloaded. This session is now concluded - reopen it here if you need more turns.",
        "ok",
      );
    } catch (e) {
      showBanner(
        e instanceof Error
          ? e.message
          : "Report export failed",
        "err",
      );
    } finally {
      setReportExportLoading(false);
    }
  }

  async function patchSessionStatus(
    next: "ACTIVE" | "ARCHIVED",
  ) {
    if (!id || !session) return;
    setStatusSaving(true);
    try {
      const objectiveTrim = ctxObjective.trim();
      const updated =
        await apiJson<SessionDetailType>(
          `/api/sessions/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              category: ctxCategory,
              strategy: ctxStrategy,
              objective:
                objectiveTrim.length > 0
                  ? objectiveTrim
                  : null,
              status: next,
            }),
          },
        );
      setSession(updated);
      showBanner(
        next === "ARCHIVED"
          ? "Session marked concluded - dashboard shows final outcome."
          : "Session reopened.",
        "ok",
      );
    } catch (e) {
      showBanner(
        e instanceof Error
          ? e.message
          : "Could not update session status",
        "err",
      );
    } finally {
      setStatusSaving(false);
    }
  }

  async function onResuggestNext() {
    if (!id || !currentTurn) return;
    setResuggestLoading(true);
    try {
      await apiJson<SessionDetailType>(
        `/api/sessions/${id}/turns/${currentTurn.id}/resuggest-next`,
        {
          method: "POST",
          body: JSON.stringify({
            aggressive:
              aggressiveFollowUp || undefined,
            nextPromptInstruction:
              nextPromptInstruction.trim() ||
              undefined,
          }),
        },
      );
      await load();
      showBanner(
        "Follow-up prompt re-suggested.",
        "ok",
      );
    } catch (e) {
      showBanner(
        e instanceof Error
          ? e.message
          : "Re-suggest failed",
        "err",
      );
    } finally {
      setResuggestLoading(false);
    }
  }

  async function onResuggestFirst() {
    if (!id || !currentTurn) return;
    setResuggestFirstLoading(true);
    try {
      await apiJson<SessionDetailType>(
        `/api/sessions/${id}/turns/${currentTurn.id}/resuggest-first`,
        {
          method: "POST",
        },
      );
      await load();
      showBanner("First prompt re-suggested.", "ok");
    } catch (e) {
      showBanner(
        e instanceof Error
          ? e.message
          : "Could not re-suggest first prompt",
        "err",
      );
    } finally {
      setResuggestFirstLoading(false);
    }
  }

  async function onLockAndAdvance() {
    if (!id || !currentTurn) return;
    const draft = editedNextPrompt.trim();
    if (!draft) {
      showBanner(
        "Set a non-empty follow-up prompt before locking this turn.",
        "err",
      );
      return;
    }
    setLockAdvanceLoading(true);
    try {
      await apiJson<SessionDetailType>(
        `/api/sessions/${id}/turns/${currentTurn.id}/lock-and-advance`,
        {
          method: "POST",
          body: JSON.stringify({
            recommendedNextPrompt: draft,
          }),
        },
      );
      await load();
      setPasted("");
      showBanner(
        "Turn locked. Use the new test prompt above - paste the model’s reply, then analyze.",
        "ok",
      );
    } catch (e) {
      showBanner(
        e instanceof Error
          ? e.message
          : "Could not lock and continue",
        "err",
      );
    } finally {
      setLockAdvanceLoading(false);
    }
  }

  if (loadError) {
    return (
      <div className="page">
        <div className="card error-card">
          {loadError}
        </div>
        <Link
          to="/"
          className="btn btn-secondary"
        >
          Back
        </Link>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="page">
        <div className="card muted">
          Loading session…
        </div>
      </div>
    );
  }

  if (!currentTurn) {
    return (
      <div className="page">
        <div className="card error-card">
          This session has no turns. The session
          may be incomplete-try creating a new
          session from the dashboard.
        </div>
        <Link
          to="/"
          className="btn btn-secondary"
        >
          Back
        </Link>
      </div>
    );
  }

  const sessionConcluded =
    session.status === "ARCHIVED";
  const workbenchBusy =
    analyzeLoading ||
    resuggestLoading ||
    resuggestFirstLoading ||
    lockAdvanceLoading;
  const workbenchDisabled =
    sessionConcluded || workbenchBusy;
  const ctxDisabled =
    ctxSaving || sessionConcluded;

  const isImageSession = expectsImageOutputModel(
    session.modelType,
  );
  const hasAnalyzePayload =
    pasted.trim().length > 0 ||
    (isImageSession && !!pastedImageDataUrl);

  const canAnalyze =
    !!currentTurn &&
    !analyzeLoading &&
    !lockAdvanceLoading &&
    !sessionConcluded;
  const nextPromptDraft = editedNextPrompt.trim();
  const canLockAndAdvance =
    !!currentTurn?.evaluationVerdict &&
    !!nextPromptDraft &&
    !lockAdvanceLoading &&
    !resuggestLoading &&
    !analyzeLoading &&
    !sessionConcluded;

  const recordedNextInstruction =
    nextPromptInstructionFromFlags(
      currentTurn.heuristicFlags,
    );
  const quotedFailures =
    parseQuotedFailuresFromTurn(currentTurn);
  const biasReport =
    parseDiscriminatoryFromTurn(currentTurn);
  const explicitReport =
    parseVerbatimRiskFromTurn(
      currentTurn,
      "explicitContentReport",
    );
  const misinfoReport = parseVerbatimRiskFromTurn(
    currentTurn,
    "misinformationReport",
  );
  const categoryReport =
    parseCategorySpecificFromTurn(currentTurn);
  const categoryEvalTargets =
    getCategoryEvaluationTargets(
      session.category,
    );
  const nextPromptDirty =
    nextPromptDraft !==
    (
      currentTurn.recommendedNextPrompt ?? ""
    ).trim();

  return (
    <div className="page">
      {banner ? (
        <div
          className={`toast-banner ${bannerTone === "err" ? "is-error" : "is-ok"}`}
        >
          {banner}
        </div>
      ) : null}

      {sessionConcluded ? (
        <div
          className="card concluded-session-notice"
          role="status"
        >
          <p>
            <strong>Session concluded.</strong>{" "}
            You cannot add turns, analyze, or
            change method until you{" "}
            <strong>Reopen session</strong> above.
            Exporting the Markdown report
            concludes the session automatically.
          </p>
        </div>
      ) : null}

      <div className="page-header workbench-header">
        <div>
          <p className="muted mono">
            <Link to="/">Sessions</Link>
            <span className="crumb">/</span>
            <span>{session.title}</span>
          </p>
          <h1 className="workbench-title">
            {session.title}
          </h1>
          <div className="meta-grid">
            <div>
              <span className="meta-label">
                Model type
              </span>
              <span>{session.modelType}</span>
            </div>
            <div>
              <span className="meta-label">
                Category (active)
              </span>
              <span>{session.category}</span>
            </div>
            <div>
              <span className="meta-label">
                Strategy (active)
              </span>
              <span>{session.strategy}</span>
            </div>
            <div>
              <span className="meta-label">
                Session ID
              </span>
              <span className="mono">
                {session.id}
              </span>
            </div>
            <div>
              <span className="meta-label">
                Status
              </span>
              <span>
                {session.status === "ARCHIVED"
                  ? "Concluded"
                  : "Active"}
              </span>
            </div>
          </div>
          {session.modelNameOrNotes ? (
            <p className="notes-block">
              <span className="meta-label">
                Target notes ·{" "}
              </span>
              {session.modelNameOrNotes}
            </p>
          ) : null}
        </div>
        <div className="export-actions">
          {session.status === "ACTIVE" ? (
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={statusSaving || ctxSaving}
              onClick={() =>
                void patchSessionStatus(
                  "ARCHIVED",
                )
              }
            >
              Mark concluded
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={statusSaving || ctxSaving}
              onClick={() =>
                void patchSessionStatus("ACTIVE")
              }
            >
              Reopen session
            </button>
          )}
          <a
            className="btn btn-ghost btn-small"
            href={`/api/sessions/${session.id}/export?format=json`}
            download
          >
            Export JSON
          </a>
          <a
            className="btn btn-ghost btn-small"
            href={`/api/sessions/${session.id}/export?format=csv`}
            download
          >
            Export CSV
          </a>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={
              reportExportLoading ||
              ctxSaving ||
              statusSaving
            }
            onClick={() =>
              void downloadMarkdownReport()
            }
          >
            {reportExportLoading
              ? "Exporting…"
              : "Export report (.md)"}
          </button>
        </div>
      </div>

      <section className="card session-context-card">
        <div className="section-title-row">
          <h2 className="session-context-title">
            Switch method mid-session
          </h2>
        </div>
        <p className="muted small">
          Category and attack strategy feed the
          analysis model for this session.
          Updating here does not rewrite existing
          prompts - it applies to the next{" "}
          <strong>Analyze</strong> /{" "}
          <strong>Re-suggest</strong> and onward.
          {sessionConcluded
            ? " Concluded sessions cannot be edited until reopened."
            : ""}
        </p>
        <div className="session-context-form">
          <label className="field">
            <span>Category</span>
            <select
              value={ctxCategory}
              onChange={(e) =>
                setCtxCategory(e.target.value)
              }
              disabled={ctxDisabled}
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
              value={ctxStrategy}
              onChange={(e) =>
                setCtxStrategy(e.target.value)
              }
              disabled={ctxDisabled}
            >
              {ATTACK_STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              Session objective (optional)
            </span>
            <textarea
              value={ctxObjective}
              onChange={(e) =>
                setCtxObjective(e.target.value)
              }
              rows={2}
              maxLength={10_000}
              placeholder="Override or refine objective for remaining turns…"
              disabled={ctxDisabled}
              className="instruction-input"
            />
          </label>
          <div className="panel-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={
                ctxDisabled ||
                (ctxCategory ===
                  session.category &&
                  ctxStrategy ===
                    session.strategy &&
                  (ctxObjective.trim() || "") ===
                    (
                      session.objective ?? ""
                    ).trim())
              }
              onClick={() =>
                void onUpdateSessionContext()
              }
            >
              {ctxSaving
                ? "Saving…"
                : "Update session method"}
            </button>
          </div>
        </div>
      </section>

      <section className="current-turn card highlighted">
        <div className="section-title-row">
          <h2>
            Current turn
            <span className="turn-badge">
              #{currentTurn.turnNumber}
            </span>
          </h2>
        </div>

        <p className="muted small workbench-flow-intro">
          <strong>Workflow:</strong> paste the
          target model&apos;s reply to the test
          prompt → <strong>Analyze</strong> →
          adjust the instruction below and{" "}
          <strong>Re-suggest</strong> or edit the
          follow-up text → when it matches what
          you will send next,{" "}
          <strong>
            Save prompt &amp; lock - start next
            turn
          </strong>{" "}
          → paste the new reply on the next turn
          and repeat.
          {sessionConcluded
            ? " (Disabled while the session is concluded.)"
            : ""}
        </p>

        <div className="panel">
          <div className="panel-head">
            <h3>Generated test prompt</h3>
            <div className="panel-head-actions">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() =>
                  void onResuggestFirst()
                }
                disabled={
                  workbenchDisabled ||
                  currentTurn.turnNumber !== 1 ||
                  !!currentTurn.evaluationVerdict ||
                  resuggestFirstLoading
                }
              >
                {resuggestFirstLoading
                  ? "Re-suggesting…"
                  : "Re-suggest first prompt"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() =>
                  copyToClipboard(
                    currentTurn.generatedPrompt,
                  ).then(() =>
                    showBanner(
                      "Prompt copied.",
                      "ok",
                    ),
                  )
                }
              >
                Copy
              </button>
            </div>
          </div>
          <pre className="prompt-block">
            {currentTurn.generatedPrompt}
          </pre>
          {metaAggressiveFirst(
            currentTurn.generatedMeta,
          ) ? (
            <p className="muted small">
              <span className="verdict-pill verdict-borderline">
                Aggressive first prompt
              </span>
            </p>
          ) : null}
          {metaPressure(
            currentTurn.generatedMeta,
          ) ? (
            <p className="muted small">
              <strong>Pressure point · </strong>
              {metaPressure(
                currentTurn.generatedMeta,
              )}
            </p>
          ) : null}
          {metaNotes(
            currentTurn.generatedMeta,
          ) ? (
            <p className="muted small">
              <strong>Notes · </strong>
              {metaNotes(
                currentTurn.generatedMeta,
              )}
            </p>
          ) : null}
        </div>

        <div className="panel follow-up-steer-panel">
          <div className="panel-head">
            <h3>Steer the follow-up prompt</h3>
          </div>
          <p className="muted small">
            These options apply on{" "}
            <strong>Analyze</strong> and on{" "}
            <strong>Re-suggest</strong>. Refine
            them until the suggested follow-up
            matches your intent before you lock
            the turn.
          </p>
          <label className="field field-checkbox field-checkbox-inline">
            <input
              type="checkbox"
              checked={aggressiveFollowUp}
              onChange={(e) =>
                setAggressiveFollowUp(
                  e.target.checked,
                )
              }
              disabled={workbenchDisabled}
            />
            <span>
              <strong>
                More aggressive next prompt
              </strong>
              <span className="muted block small">
                Stronger indirect pressure in the
                suggested follow-up (still
                non-explicit).
              </span>
            </span>
          </label>
          <label className="field">
            <span>
              Custom instruction for next prompt
              (optional)
            </span>
            <textarea
              className="instruction-input"
              value={nextPromptInstruction}
              onChange={(e) =>
                setNextPromptInstruction(
                  e.target.value,
                )
              }
              placeholder="e.g. pivot to academic framing, add a nested document-review scenario, stress ambiguity…"
              rows={3}
              maxLength={4000}
              disabled={workbenchDisabled}
            />
            <span className="muted small">
              The assistant must follow this when
              suggesting the follow-up. Max 4000
              characters.
            </span>
          </label>
        </div>

        {isImageSession ? (
          <div
            className="panel image-output-panel"
            tabIndex={
              sessionConcluded ? undefined : 0
            }
            onPaste={
              sessionConcluded
                ? undefined
                : onImagePaste
            }
          >
            <div className="panel-head">
              <h3>Model image output</h3>
              <div className="panel-head-actions">
                <input
                  ref={imageFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="sr-only"
                  aria-hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      void attachImageFromFile(f);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={workbenchDisabled}
                  onClick={() =>
                    imageFileInputRef.current?.click()
                  }
                >
                  Upload image
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={
                    !pastedImageDataUrl ||
                    workbenchDisabled
                  }
                  onClick={() => {
                    setPastedImageDataUrl(null);
                    setImageLinkDraft("");
                    setImagePreviewBroken(false);
                    showBanner(
                      "Image removed.",
                      "ok",
                    );
                  }}
                >
                  Clear image
                </button>
              </div>
            </div>
            <p className="muted small">
              Paste from the clipboard (click
              here, then Ctrl+V), upload, or use a
              public image URL below. Inline: PNG,
              JPEG, GIF, or WebP, up to{" "}
              {MAX_IMAGE_FILE_BYTES /
                (1024 * 1024)}
              MB. Live analysis uses a
              vision-capable model when{" "}
              <code className="mono">
                OPENAI_API_KEY
              </code>{" "}
              is set.
            </p>
            <label className="field image-link-field">
              <span>Image link (optional)</span>
              <div className="image-link-row">
                <input
                  type="url"
                  className="image-link-input"
                  placeholder="https://example.com/generated.png"
                  maxLength={
                    MAX_PASTED_IMAGE_LINK_CHARS
                  }
                  value={imageLinkDraft}
                  onChange={(e) =>
                    setImageLinkDraft(
                      e.target.value,
                    )
                  }
                  disabled={workbenchDisabled}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={
                    workbenchDisabled ||
                    !imageLinkDraft.trim()
                  }
                  onClick={() => applyImageLink()}
                >
                  Use link
                </button>
              </div>
              <span className="muted small">
                Direct link to an image file. The
                evaluator&apos;s API must be able
                to fetch it (public URL).
              </span>
            </label>
            {pastedImageDataUrl ? (
              <div className="image-preview-wrap">
                <img
                  className="image-preview"
                  src={pastedImageDataUrl}
                  alt="Pasted model output"
                  onLoad={() =>
                    setImagePreviewBroken(false)
                  }
                  onError={() =>
                    setImagePreviewBroken(true)
                  }
                />
              </div>
            ) : null}
            {pastedImageDataUrl &&
            imagePreviewBroken ? (
              <p className="muted small image-preview-fallback">
                Preview didn&apos;t load in the
                browser (CORS or not an image).
                Analysis can still use the URL if
                the model API can fetch it.
              </p>
            ) : null}
            {!pastedImageDataUrl ? (
              <p className="muted small image-paste-hint">
                No image attached yet - paste a
                screenshot here, upload, or set an
                image URL above.
              </p>
            ) : null}
          </div>
        ) : null}

        {!currentTurn.evaluationVerdict ? (
          <div className="panel">
            <div className="panel-head">
              <h3>Paste black-box response</h3>
            </div>
            <textarea
              className="response-input"
              value={pasted}
              onChange={(e) =>
                setPasted(e.target.value)
              }
              placeholder={
                isImageSession
                  ? "Optional notes: e.g. generation settings, refusal text, or what to look for in the image."
                  : "Paste the target system's full response here, then run analysis."
              }
              disabled={workbenchDisabled}
            />
            <div className="panel-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !canAnalyze ||
                  !hasAnalyzePayload
                }
                onClick={() => void onAnalyze()}
              >
                {analyzeLoading
                  ? "Analyzing…"
                  : "Analyze response"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <details className="panel reanalyze-details-card">
              <summary>
                Pasted response - open to edit and
                re-analyze if needed
              </summary>
              <textarea
                className="response-input"
                value={pasted}
                onChange={(e) =>
                  setPasted(e.target.value)
                }
                placeholder={
                  isImageSession
                    ? "Optional notes for this turn (see image panel above to change the image)."
                    : "Target model response for this turn"
                }
                disabled={workbenchDisabled}
              />
              <div className="panel-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={
                    !canAnalyze ||
                    !hasAnalyzePayload ||
                    workbenchDisabled
                  }
                  onClick={() => void onAnalyze()}
                >
                  {analyzeLoading
                    ? "Analyzing…"
                    : "Re-analyze response"}
                </button>
              </div>
            </details>

            <div className="panel evaluation-panel">
              <div className="panel-head">
                <h3>Assessment (assistant)</h3>
                <span
                  className={`verdict-pill ${verdictClass(currentTurn.evaluationVerdict)}`}
                >
                  {verdictLabel(
                    currentTurn.evaluationVerdict,
                  )}
                </span>
              </div>
              <p className="muted small disclaimer-inline">
                Indicative scoring from the
                evaluator and heuristics - not a
                certification of model safety.
              </p>
              {id &&
              turnImageDisplayUrl(
                id,
                currentTurn,
              ) ? (
                <div className="eval-image-preview eval-block">
                  <span className="meta-label">
                    Image under review
                  </span>
                  <div className="image-preview-wrap">
                    <img
                      className="image-preview"
                      src={
                        turnImageDisplayUrl(
                          id,
                          currentTurn,
                        )!
                      }
                      alt="Stored model image output for this turn"
                    />
                  </div>
                </div>
              ) : null}
              <div className="eval-block muted small category-targets-hint">
                <span className="meta-label">
                  Category evaluation focus
                </span>
                <p>{categoryEvalTargets}</p>
              </div>
              <div className="score-row">
                <div>
                  <span className="meta-label">
                    Score
                  </span>
                  <span className="score-val">
                    {currentTurn.evaluationScore}
                  </span>
                  <span className="muted">
                    {" "}
                    / 100
                  </span>
                </div>
                <div>
                  <span className="meta-label">
                    Confidence
                  </span>
                  <span className="score-val">
                    {
                      currentTurn.evaluationConfidence
                    }
                  </span>
                  <span className="muted">
                    {" "}
                    / 100
                  </span>
                </div>
              </div>
              {currentTurn.evaluationSummary ? (
                <div className="eval-block eval-summary-block">
                  <span className="meta-label">
                    Summary
                  </span>
                  <p>
                    {
                      currentTurn.evaluationSummary
                    }
                  </p>
                </div>
              ) : null}
              {quotedFailures.length > 0 ? (
                <div className="eval-block">
                  <span className="meta-label">
                    Failure excerpts (verbatim
                    from tested model)
                  </span>
                  <p className="muted small disclaimer-inline">
                    Quoted text is taken from the
                    pasted response for audit
                    review.
                  </p>
                  <ul className="failure-quote-list">
                    {quotedFailures.map(
                      (qf, i) => (
                        <li
                          key={i}
                          className="failure-quote-item"
                        >
                          <blockquote className="model-quote">
                            {qf.quote}
                          </blockquote>
                          <p className="small">
                            {qf.explanation}
                          </p>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ) : null}
              {biasReport?.detected ? (
                <div className="eval-block bias-signal-block">
                  <span className="meta-label">
                    Bias / hate / group targeting
                    (assistant flag)
                  </span>
                  {biasReport.summary ? (
                    <p>{biasReport.summary}</p>
                  ) : null}
                  {biasReport.targetedGroupsOrCommunities &&
                  biasReport
                    .targetedGroupsOrCommunities
                    .length > 0 ? (
                    <p className="small">
                      <strong>
                        Named or implied
                        groups:{" "}
                      </strong>
                      {biasReport.targetedGroupsOrCommunities.join(
                        "; ",
                      )}
                    </p>
                  ) : null}
                  {biasReport.verbatimQuotesFromResponse &&
                  biasReport
                    .verbatimQuotesFromResponse
                    .length > 0 ? (
                    <ul className="failure-quote-list">
                      {biasReport.verbatimQuotesFromResponse.map(
                        (q, i) => (
                          <li key={i}>
                            <blockquote className="model-quote">
                              {q}
                            </blockquote>
                          </li>
                        ),
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {explicitReport?.detected ? (
                <div className="eval-block explicit-signal-block">
                  <span className="meta-label">
                    Explicit / sexual content
                    (assistant flag)
                  </span>
                  <p className="muted small disclaimer-inline">
                    For audit review; may include
                    offensive excerpts from the
                    pasted target response.
                  </p>
                  {explicitReport.summary ? (
                    <p>
                      {explicitReport.summary}
                    </p>
                  ) : null}
                  {explicitReport.verbatimQuotesFromResponse &&
                  explicitReport
                    .verbatimQuotesFromResponse
                    .length > 0 ? (
                    <ul className="failure-quote-list">
                      {explicitReport.verbatimQuotesFromResponse.map(
                        (q, i) => (
                          <li key={i}>
                            <blockquote className="model-quote">
                              {q}
                            </blockquote>
                          </li>
                        ),
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {misinfoReport?.detected ? (
                <div className="eval-block misinfo-signal-block">
                  <span className="meta-label">
                    Misinformation / false claims
                    (assistant flag)
                  </span>
                  {misinfoReport.summary ? (
                    <p>{misinfoReport.summary}</p>
                  ) : null}
                  {misinfoReport.verbatimQuotesFromResponse &&
                  misinfoReport
                    .verbatimQuotesFromResponse
                    .length > 0 ? (
                    <ul className="failure-quote-list">
                      {misinfoReport.verbatimQuotesFromResponse.map(
                        (q, i) => (
                          <li key={i}>
                            <blockquote className="model-quote">
                              {q}
                            </blockquote>
                          </li>
                        ),
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {categoryReport?.detected ? (
                <div className="eval-block category-signal-block">
                  <span className="meta-label">
                    Category-specific gaps (vs
                    session focus)
                  </span>
                  {categoryReport.summary ? (
                    <p>
                      {categoryReport.summary}
                    </p>
                  ) : null}
                  {categoryReport.issueTags &&
                  categoryReport.issueTags
                    .length > 0 ? (
                    <p className="small">
                      <strong>Tags: </strong>
                      {categoryReport.issueTags.join(
                        "; ",
                      )}
                    </p>
                  ) : null}
                  {categoryReport.verbatimQuotesFromResponse &&
                  categoryReport
                    .verbatimQuotesFromResponse
                    .length > 0 ? (
                    <ul className="failure-quote-list">
                      {categoryReport.verbatimQuotesFromResponse.map(
                        (q, i) => (
                          <li key={i}>
                            <blockquote className="model-quote">
                              {q}
                            </blockquote>
                          </li>
                        ),
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <div className="eval-block">
                <span className="meta-label">
                  Reasoning
                </span>
                <p>
                  {
                    currentTurn.evaluationReasoning
                  }
                </p>
              </div>
              <div className="eval-block">
                <span className="meta-label">
                  Observed weakness
                </span>
                <p>
                  {currentTurn.observedWeakness}
                </p>
              </div>
              {recordedNextInstruction ? (
                <div className="eval-block">
                  <span className="meta-label">
                    Custom instruction (next
                    prompt)
                  </span>
                  <pre className="prompt-block small">
                    {recordedNextInstruction}
                  </pre>
                </div>
              ) : null}
              {currentTurn.heuristicFlags &&
              typeof currentTurn.heuristicFlags ===
                "object" &&
              "aggressiveFollowUpRequested" in
                currentTurn.heuristicFlags &&
              (
                currentTurn.heuristicFlags as {
                  aggressiveFollowUpRequested?: boolean;
                }
              ).aggressiveFollowUpRequested ? (
                <p className="muted small">
                  <span className="verdict-pill verdict-borderline">
                    Aggressive follow-up
                  </span>{" "}
                  Recommended next prompt used
                  higher-pressure framing.
                </p>
              ) : null}
              {currentTurn.heuristicFlags &&
              typeof currentTurn.heuristicFlags ===
                "object" ? (
                <div className="eval-block muted small">
                  <span className="meta-label">
                    Heuristic flags ·{" "}
                  </span>
                  {JSON.stringify(
                    currentTurn.heuristicFlags,
                  )}
                </div>
              ) : null}
            </div>

            <div className="panel next-prompt-panel">
              <div className="panel-head">
                <h3>
                  Suggested follow-up prompt
                </h3>
                <div className="panel-head-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    disabled={!nextPromptDraft}
                    onClick={() =>
                      copyToClipboard(
                        editedNextPrompt,
                      ).then(() =>
                        showBanner(
                          "Follow-up prompt copied.",
                          "ok",
                        ),
                      )
                    }
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={workbenchDisabled}
                    onClick={() =>
                      void onResuggestNext()
                    }
                  >
                    {resuggestLoading
                      ? "Re-suggesting…"
                      : "Re-suggest"}
                  </button>
                </div>
              </div>
              <p className="muted small">
                Copy this into the target system
                after you lock the turn, or edit
                it here first. Re-suggest uses
                your instruction and aggressive
                settings above.
                {nextPromptDirty ? (
                  <span className="next-prompt-dirty">
                    {" "}
                    Edited text will be what gets
                    locked.
                  </span>
                ) : null}
              </p>
              <textarea
                className="prompt-block response-input next-prompt-edit"
                value={editedNextPrompt}
                onChange={(e) =>
                  setEditedNextPrompt(
                    e.target.value,
                  )
                }
                rows={10}
                aria-label="Edit suggested follow-up prompt"
                disabled={workbenchDisabled}
              />
              <div className="panel-actions lock-advance-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canLockAndAdvance}
                  onClick={() =>
                    void onLockAndAdvance()
                  }
                >
                  {lockAdvanceLoading
                    ? "Locking…"
                    : "Save prompt & lock - start next turn"}
                </button>
                <span className="muted small">
                  Locks this turn, saves the
                  follow-up text, and opens the
                  next turn with that prompt ready
                  to run.
                </span>
              </div>
            </div>
          </>
        )}
      </section>

      {historyTurns.length > 0 ? (
        <section className="history-section">
          <h2>Turn history</h2>
          <div className="history-list">
            {[...historyTurns]
              .reverse()
              .map((t) => (
                <div
                  key={t.id}
                  className="card history-card"
                >
                  <div className="history-card-head">
                    <span className="mono">
                      Turn {t.turnNumber}
                    </span>
                    <span className="history-card-badges">
                      {t.evaluationVerdict ? (
                        <span
                          className={`verdict-pill ${verdictClass(t.evaluationVerdict)}`}
                        >
                          {verdictLabel(
                            t.evaluationVerdict,
                          )}
                        </span>
                      ) : (
                        <span className="muted">
                          Not analyzed
                        </span>
                      )}
                      {turnHasImageAttachment(
                        t,
                      ) ? (
                        <span className="verdict-pill verdict-safe">
                          Image
                        </span>
                      ) : null}
                      {t.nextPromptLockedAt ? (
                        <span className="verdict-pill verdict-borderline">
                          Locked
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <details>
                    <summary>
                      Prompt & response
                    </summary>
                    <pre className="prompt-block small">
                      {t.generatedPrompt}
                    </pre>
                    {t.pastedModelResponse ? (
                      <pre className="prompt-block small muted-bg">
                        {t.pastedModelResponse}
                      </pre>
                    ) : null}
                    {id &&
                    turnImageDisplayUrl(id, t) ? (
                      <div className="history-thumb">
                        <span className="meta-label small">
                          Image output
                        </span>
                        <img
                          className="image-preview"
                          src={
                            turnImageDisplayUrl(
                              id,
                              t,
                            )!
                          }
                          alt=""
                        />
                      </div>
                    ) : null}
                    {t.evaluationReasoning ? (
                      <p className="small">
                        {t.evaluationReasoning}
                      </p>
                    ) : null}
                    {t.recommendedNextPrompt ? (
                      <pre className="prompt-block small">
                        Next:{" "}
                        {t.recommendedNextPrompt}
                      </pre>
                    ) : null}
                  </details>
                </div>
              ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
