export type ApiError = { error: string; details?: unknown };

export async function apiJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as ApiError).error === "string"
        ? (data as ApiError).error
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export type SessionListItem = {
  id: string;
  title: string;
  modelType: string;
  category: string;
  strategy: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** Worst verdict across analyzed turns (FAILED > BORDERLINE > SAFE). */
  aggregateVerdict: string | null;
  /** Mean safety score (1–100) over turns that have scores. */
  sessionScore: number | null;
  analyzedTurnCount: number;
  totalTurnCount: number;
  isConcluded: boolean;
  /** When concluded: true if any analyzed turn FAILED (red-team probe succeeded). */
  redTeamSuccess: boolean | null;
  hadModelFailure: boolean;
  latestTurnNumber: number | null;
};

export type QuotedFailureItem = {
  quote: string;
  explanation: string;
};

export type DiscriminatoryBiasTurn = {
  detected: boolean;
  summary?: string;
  targetedGroupsOrCommunities?: string[];
  verbatimQuotesFromResponse?: string[];
};

/** Assistant flag: explicit / sexual material (verbatim-backed). */
export type VerbatimRiskTurn = {
  detected: boolean;
  summary?: string;
  verbatimQuotesFromResponse?: string[];
};

/** Assistant flag: misinformation / false claims (verbatim-backed). */
export type MisinformationTurn = VerbatimRiskTurn;

/** Assistant flag: gaps vs active session category targets. */
export type CategorySpecificTurn = {
  detected: boolean;
  summary?: string;
  issueTags?: string[];
  verbatimQuotesFromResponse?: string[];
};

export type TestTurn = {
  id: string;
  sessionId: string;
  turnNumber: number;
  generatedPrompt: string;
  generatedMeta: unknown;
  pastedModelResponse: string | null;
  /** Public http(s) image URL attached for review (file uploads use asset path + API URL). */
  pastedModelImageDataUrl?: string | null;
  /** Repo-relative path e.g. assets/{sessionId}/{turnId}.png when an upload was saved. */
  pastedModelImageAssetPath?: string | null;
  evaluationVerdict: string | null;
  evaluationScore: number | null;
  evaluationConfidence: number | null;
  evaluationReasoning: string | null;
  observedWeakness: string | null;
  recommendedNextPrompt: string | null;
  evaluationSummary: string | null;
  quotedFailures: unknown;
  discriminatoryBias: unknown;
  explicitContentReport: unknown;
  misinformationReport: unknown;
  categorySpecificReport: unknown;
  heuristicFlags: unknown;
  /** ISO timestamp when this turn’s follow-up was locked and the next turn started. */
  nextPromptLockedAt?: string | null;
  createdAt: string;
};

export type SessionDetail = {
  id: string;
  title: string;
  modelType: string;
  modelNameOrNotes: string | null;
  category: string;
  strategy: string;
  objective: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  turns: TestTurn[];
};
