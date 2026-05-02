/// Batch section-writer that walks an outline subtree and generates
/// every descendant section in document order.
///
/// Composes existing pieces — does not introduce a new endpoint:
///   1. recommendPapersForSection (Convex action)  – pick candidate papers
///   2. addMatch (Convex mutation)                 – auto-link top-N
///   3. /generate-section (POST SSE, prose-only)   – stream draft
///   4. /detect-citations + /validate-citations    – attach citations
///   5. saveSectionContent (Convex mutation)       – persist body
///
/// All five steps are driven by injectable async functions so the hook
/// is testable without spinning up Convex or the Python backend. The
/// production wiring lives in `BatchGeneratePanel`, which provides the
/// real Convex/network adapters.
import { useCallback, useEffect, useRef, useState } from "react";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import { streamSSE, type SseEvent } from "@/lib/sseClient";
import {
  buildPendingMarker,
  generatePlaceholderId,
  parsePendingCitations,
  replacePendingMarker,
  buildCitationMarker,
  extractCitationIds,
} from "@/lib/citationUtils";
import { findSentenceEnd } from "@/lib/sentenceMatch";
import type { PaperId, PendingCitation, SectionId } from "@/lib/types";

/// Score threshold for auto-linking a recommended paper to a section.
/// Mirrors `useValidateCitations.AUTO_PROMOTE_THRESHOLD` so "good enough
/// to cite" and "good enough to attach" share the same bar.
export const BATCH_AUTO_LINK_THRESHOLD = 0.75;

/// Hard cap on auto-linked papers per section. Without this, a hot
/// section can swallow every paper in the corpus and bloat the prompt
/// past the model's context window.
export const BATCH_AUTO_LINK_MAX_PER_SECTION = 8;

/// What to do when a target section already has body content.
export type BatchExistingBodyMode = "skip" | "append" | "replace";

/// Per-section state in the batch run. Status flows:
///   queued → linking → drafting → detecting → validating → done
///   queued → skipped (no notes / existing body in skip-mode)
///   any → failed (one section's failure does NOT abort the rest)
///   any → cancelled (Stop click clears the rest of the queue)
export type BatchSectionStatus =
  | "queued"
  | "linking"
  | "drafting"
  | "detecting"
  | "validating"
  | "done"
  | "skipped"
  | "failed"
  | "cancelled";

export interface BatchSectionState {
  sectionId: SectionId;
  title: string;
  orderNumber: string;
  status: BatchSectionStatus;
  /// One-line summary of the most recent status change. Surfaced in the
  /// log panel and in the per-row last-message hint.
  lastMessage: string;
  /// Raw error string when `status === "failed"`. Null otherwise.
  error: string | null;
  /// Filled in once the section's draft is persisted.
  finalBody: string | null;
}

export type BatchOverallStatus =
  | "idle"
  | "running"
  | "stopped"
  | "completed";

export interface BatchLogEntry {
  /// Local-time `HH:MM:SS` string captured at log time. ISO would be
  /// noisier in the panel without buying anything for in-session debug.
  ts: string;
  sectionId: SectionId | null;
  sectionTitle: string;
  phase: BatchSectionStatus | "batch";
  level: "info" | "ok" | "warn" | "error";
  message: string;
}

/// Public state surface exposed to the panel component.
export interface BatchState {
  status: BatchOverallStatus;
  /// Index into `sections` of the section currently being processed.
  /// -1 when idle or after stop/completion.
  currentIndex: number;
  sections: BatchSectionState[];
  log: BatchLogEntry[];
  /// Counts derived from `sections` for the header summary.
  stats: {
    total: number;
    done: number;
    skipped: number;
    failed: number;
  };
}

/// Minimal shape of an outline section we need to drive the batch.
/// The caller flattens its tree into this shape so the hook stays
/// agnostic of `SectionTreeNode`'s recursive structure.
export interface BatchSectionInput {
  sectionId: SectionId;
  title: string;
  orderNumber: string;
  /// Notes from the outline node. Empty/null → section is skipped.
  notes: string | null;
  /// Current persisted body (from sectionContent), used for the
  /// existing-body mode decision. Null when no row exists yet.
  currentBody: string | null;
}

/// Adapters injected by the caller. Allows tests to substitute fakes
/// without binding to the convex client or window.fetch.
export interface BatchAdapters {
  /// Pick candidate papers for a section. Should map to the existing
  /// `recommendPapersForSection` action with `scope: { type: "all" }`.
  recommend: (
    sectionId: SectionId,
    signal: AbortSignal
  ) => Promise<{ paperId: PaperId; score: number }[]>;
  /// Attach a paper to a section. Maps to the `addMatch` mutation.
  /// `relevanceScore` is the recommender's score so the UI's downstream
  /// ordering stays sensible.
  addMatch: (
    paperId: PaperId,
    sectionId: SectionId,
    relevanceScore: number
  ) => Promise<void>;
  /// Persist the final body. Maps to `saveSectionContent` and accepts
  /// the resolved citedPaperIds + remaining pending placeholders.
  save: (
    sectionId: SectionId,
    body: string,
    citedPaperIds: PaperId[],
    pendingCitations: PendingCitation[]
  ) => Promise<void>;
}

export interface UseBatchGenerateSectionsOptions {
  provider: string;
  adapters: BatchAdapters;
  /// Override the network base URL. Tests pass a stub server URL; in
  /// production this stays at `PYTHON_SERVICE_URL`.
  serviceUrl?: string;
  /// Hook the global fetch so tests can stub network behaviour without
  /// touching `globalThis`. Defaults to `window.fetch`.
  fetchImpl?: typeof fetch;
  /// Hook for SSE streaming. Allows tests to inject a generator that
  /// emits canned events. Defaults to the real `streamSSE`.
  streamImpl?: typeof streamSSE;
}

/// Detect-endpoint response shape.
interface DetectItem {
  claim_sentence: string;
  claim_type: string;
  suggested_paper_ids: string[];
  reason: string;
}
interface DetectResponse {
  items: DetectItem[];
  warnings: string[];
}

/// Validate-endpoint response shape.
interface ValidateCandidate {
  paper_id: string;
  score: number;
  page_ref_from_excerpt: string;
}
interface ValidateResultRow {
  placeholder_id: string;
  candidates: ValidateCandidate[];
}
interface ValidateResponse {
  results: ValidateResultRow[];
}

const AUTO_PROMOTE_THRESHOLD = 0.75;

function timestamp(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

/// Computes the empty-derived stats once, used as the initial state
/// and after `reset()`.
function emptyStats() {
  return { total: 0, done: 0, skipped: 0, failed: 0 };
}

const INITIAL_STATE: BatchState = {
  status: "idle",
  currentIndex: -1,
  sections: [],
  log: [],
  stats: emptyStats(),
};

export function useBatchGenerateSections(
  options: UseBatchGenerateSectionsOptions
) {
  const {
    provider,
    adapters,
    serviceUrl = PYTHON_SERVICE_URL,
    fetchImpl,
    streamImpl,
  } = options;
  const [state, setState] = useState<BatchState>(INITIAL_STATE);

  /// Outer controller: a single Stop click aborts whichever phase is
  /// in flight (recommend / generate-stream / detect / validate) and
  /// short-circuits the remaining queue.
  const controllerRef = useRef<AbortController | null>(null);
  /// Synchronous "should we stop?" flag read at every loop boundary.
  /// State updates lag a render so we can't trust `state.status`.
  const stoppedRef = useRef(false);

  // Always abort on unmount so a closing panel never leaks a stream.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const log = useCallback(
    (entry: Omit<BatchLogEntry, "ts">) => {
      const full: BatchLogEntry = { ...entry, ts: timestamp() };
      // Mirror to devtools so a bug can be reproduced from console
      // alone — keeps the in-page log panel optional, not load-bearing.
      // eslint-disable-next-line no-console
      console.log(
        `[BATCH-WRITE] ${full.ts} ${full.level.toUpperCase()} ` +
          `${full.sectionTitle} [${full.phase}] ${full.message}`
      );
      setState((prev) => ({ ...prev, log: [...prev.log, full] }));
    },
    []
  );

  const updateSection = useCallback(
    (sectionId: SectionId, patch: Partial<BatchSectionState>) => {
      setState((prev) => {
        const sections = prev.sections.map((s) =>
          s.sectionId === sectionId ? { ...s, ...patch } : s
        );
        return {
          ...prev,
          sections,
          stats: deriveStats(sections),
        };
      });
    },
    []
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    setState(INITIAL_STATE);
    stoppedRef.current = false;
  }, [stop]);

  const start = useCallback(
    async (
      sections: BatchSectionInput[],
      mode: BatchExistingBodyMode = "skip"
    ) => {
      // Reset previous run state, then prime the new one.
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      stoppedRef.current = false;

      const initialSections: BatchSectionState[] = sections.map((s) => ({
        sectionId: s.sectionId,
        title: s.title,
        orderNumber: s.orderNumber,
        status: "queued",
        lastMessage: "queued",
        error: null,
        finalBody: null,
      }));

      setState({
        status: "running",
        currentIndex: -1,
        sections: initialSections,
        log: [
          {
            ts: timestamp(),
            sectionId: null,
            sectionTitle: "(batch)",
            phase: "batch",
            level: "info",
            message: `Starting batch on ${sections.length} section(s) (mode=${mode})`,
          },
        ],
        stats: deriveStats(initialSections),
      });

      const fetchFn = fetchImpl ?? globalThis.fetch.bind(globalThis);
      const streamFn = streamImpl ?? streamSSE;

      for (let i = 0; i < sections.length; i++) {
        if (stoppedRef.current) break;

        const section = sections[i];
        setState((prev) => ({ ...prev, currentIndex: i }));

        try {
          await processOne({
            section,
            mode,
            provider,
            serviceUrl,
            adapters,
            fetchFn,
            streamFn,
            signal: controller.signal,
            stoppedRef,
            log,
            updateSection,
          });
        } catch (err) {
          // Per-section failures are intentionally non-fatal: the user
          // wants the rest of the batch to proceed. Stop is the only
          // mechanism that aborts the queue.
          const message =
            err instanceof Error ? err.message : String(err);
          updateSection(section.sectionId, {
            status: "failed",
            error: message,
            lastMessage: message,
          });
          log({
            sectionId: section.sectionId,
            sectionTitle: section.title,
            phase: "failed",
            level: "error",
            message,
          });
        }
      }

      // Decide the terminal status. If the user clicked Stop mid-flight,
      // the final state is `stopped`; otherwise we ran to completion.
      const stopped = stoppedRef.current;
      setState((prev) => ({
        ...prev,
        status: stopped ? "stopped" : "completed",
        currentIndex: -1,
      }));
      log({
        sectionId: null,
        sectionTitle: "(batch)",
        phase: "batch",
        level: stopped ? "warn" : "ok",
        message: stopped ? "Batch stopped by user." : "Batch completed.",
      });
    },
    [adapters, fetchImpl, log, provider, serviceUrl, streamImpl, updateSection]
  );

  return { state, start, stop, reset };
}

function deriveStats(sections: BatchSectionState[]) {
  const stats = emptyStats();
  stats.total = sections.length;
  for (const s of sections) {
    if (s.status === "done") stats.done++;
    else if (s.status === "skipped") stats.skipped++;
    else if (s.status === "failed" || s.status === "cancelled") stats.failed++;
  }
  return stats;
}

/// Process one section through the full pipeline. Throws on any
/// unrecoverable error; the caller catches and tags the section as
/// `failed` without aborting the batch.
async function processOne(args: {
  section: BatchSectionInput;
  mode: BatchExistingBodyMode;
  provider: string;
  serviceUrl: string;
  adapters: BatchAdapters;
  fetchFn: typeof fetch;
  streamFn: typeof streamSSE;
  signal: AbortSignal;
  stoppedRef: React.MutableRefObject<boolean>;
  log: (e: Omit<BatchLogEntry, "ts">) => void;
  updateSection: (
    id: SectionId,
    patch: Partial<BatchSectionState>
  ) => void;
}): Promise<void> {
  const {
    section,
    mode,
    provider,
    serviceUrl,
    adapters,
    fetchFn,
    streamFn,
    signal,
    stoppedRef,
    log,
    updateSection,
  } = args;
  const id = section.sectionId;

  // ---------------------------------------------------------------
  // Pre-flight: skip rules
  // ---------------------------------------------------------------
  const notes = (section.notes ?? "").trim();
  if (!notes) {
    updateSection(id, { status: "skipped", lastMessage: "no notes" });
    log({
      sectionId: id,
      sectionTitle: section.title,
      phase: "skipped",
      level: "info",
      message: "Skipped — no outline notes.",
    });
    return;
  }
  const existingBody = (section.currentBody ?? "").trim();
  if (existingBody && mode === "skip") {
    updateSection(id, {
      status: "skipped",
      lastMessage: "existing content",
    });
    log({
      sectionId: id,
      sectionTitle: section.title,
      phase: "skipped",
      level: "info",
      message: "Skipped — section already has content (mode=skip).",
    });
    return;
  }

  // ---------------------------------------------------------------
  // Phase 1: link papers
  // ---------------------------------------------------------------
  updateSection(id, { status: "linking", lastMessage: "linking papers…" });
  log({
    sectionId: id,
    sectionTitle: section.title,
    phase: "linking",
    level: "info",
    message: "Recommending papers…",
  });
  const recs = await adapters.recommend(id, signal);
  const accepted = recs
    .filter((r) => r.score >= BATCH_AUTO_LINK_THRESHOLD)
    .slice(0, BATCH_AUTO_LINK_MAX_PER_SECTION);
  for (const r of accepted) {
    if (stoppedRef.current) throwAbort();
    await adapters.addMatch(r.paperId, id, r.score);
  }
  log({
    sectionId: id,
    sectionTitle: section.title,
    phase: "linking",
    level: "ok",
    message: `Linked ${accepted.length} paper(s) (of ${recs.length} candidate(s)).`,
  });
  if (accepted.length === 0) {
    // The /generate-section endpoint refuses to run with zero matches.
    // Fail fast so the user sees a clear reason in the log.
    throw new Error(
      "No papers met the auto-link threshold; section needs manual paper selection."
    );
  }

  // ---------------------------------------------------------------
  // Phase 2: stream draft (prose only — two-pass mode)
  // ---------------------------------------------------------------
  if (stoppedRef.current) throwAbort();
  updateSection(id, { status: "drafting", lastMessage: "drafting prose…" });
  log({
    sectionId: id,
    sectionTitle: section.title,
    phase: "drafting",
    level: "info",
    message: "Streaming draft from /generate-section…",
  });
  const draft = await streamSection({
    sectionId: id,
    serviceUrl,
    provider,
    streamFn,
    signal,
  });
  if (!draft.trim()) {
    throw new Error("Model returned an empty draft.");
  }

  // ---------------------------------------------------------------
  // Phase 3: detect citation-needing claims
  // ---------------------------------------------------------------
  if (stoppedRef.current) throwAbort();
  updateSection(id, {
    status: "detecting",
    lastMessage: "detecting claims…",
  });
  log({
    sectionId: id,
    sectionTitle: section.title,
    phase: "detecting",
    level: "info",
    message: "Detecting claims to cite…",
  });
  const detect = await runDetect({
    sectionId: id,
    body: draft,
    provider,
    serviceUrl,
    fetchFn,
    signal,
  });

  // ---------------------------------------------------------------
  // Phase 4: validate + auto-promote
  // ---------------------------------------------------------------
  let bodyAfter = detect.body;
  let unresolved: PendingCitation[] = [];
  if (detect.pendingCitations.length === 0) {
    log({
      sectionId: id,
      sectionTitle: section.title,
      phase: "validating",
      level: "info",
      message: "No citation-worthy claims detected — saving prose as-is.",
    });
  } else {
    if (stoppedRef.current) throwAbort();
    updateSection(id, {
      status: "validating",
      lastMessage: `validating ${detect.pendingCitations.length} claim(s)…`,
    });
    log({
      sectionId: id,
      sectionTitle: section.title,
      phase: "validating",
      level: "info",
      message: `Validating ${detect.pendingCitations.length} placeholder(s)…`,
    });
    const validated = await runValidate({
      sectionId: id,
      body: detect.body,
      pendingCitations: detect.pendingCitations,
      provider,
      serviceUrl,
      fetchFn,
      signal,
    });
    bodyAfter = validated.body;
    unresolved = validated.unresolved;
    log({
      sectionId: id,
      sectionTitle: section.title,
      phase: "validating",
      level: "ok",
      message: `Promoted ${validated.promotedCount}; ${unresolved.length} placeholder(s) left for review.`,
    });
  }

  // ---------------------------------------------------------------
  // Phase 5: persist
  // ---------------------------------------------------------------
  if (stoppedRef.current) throwAbort();
  const finalBody =
    mode === "append" && existingBody
      ? `${section.currentBody}\n\n${bodyAfter}`
      : bodyAfter;
  const citedPaperIds = extractCitationIds(finalBody) as PaperId[];
  await adapters.save(id, finalBody, citedPaperIds, unresolved);

  updateSection(id, {
    status: "done",
    lastMessage: `done (${citedPaperIds.length} citation(s), ${unresolved.length} TODO chip(s))`,
    finalBody,
  });
  log({
    sectionId: id,
    sectionTitle: section.title,
    phase: "done",
    level: "ok",
    message: `Saved (${citedPaperIds.length} citation(s), ${unresolved.length} pending chip(s)).`,
  });
}

/// Helper used at every loop boundary inside `processOne` so a Stop
/// click between phases produces an AbortError that the outer try/catch
/// can interpret as a clean cancellation.
function throwAbort(): never {
  throw new DOMException("Aborted by user", "AbortError");
}

/// Streams /generate-section and accumulates the full text. Returns the
/// validator-cleaned body from the `done` event when present, falling
/// back to the raw streamed accumulator (matches useGenerateSection).
async function streamSection(args: {
  sectionId: SectionId;
  serviceUrl: string;
  provider: string;
  streamFn: typeof streamSSE;
  signal: AbortSignal;
}): Promise<string> {
  const { sectionId, serviceUrl, provider, streamFn, signal } = args;
  let accumulated = "";
  let fullText = "";
  let errorMessage: string | null = null;

  await streamFn({
    url: `${serviceUrl}/generate-section`,
    body: {
      sectionId,
      guidance: null,
      answers: [],
      provider,
      cite_inline: false,
    },
    signal,
    onEvent: (event: SseEvent) => {
      if (event.type === "token" && typeof event.delta === "string") {
        accumulated += event.delta;
      } else if (event.type === "done") {
        if (typeof event.fullText === "string") fullText = event.fullText;
      } else if (event.type === "error") {
        errorMessage =
          typeof event.message === "string" ? event.message : "Stream error";
      }
    },
  });

  if (errorMessage) throw new Error(errorMessage);
  return fullText || accumulated;
}

/// Runs /detect-citations against the draft and splices `{{citeNeeded}}`
/// markers into the body. Mirrors `useDetectCitations.run` but inlined
/// so the batch hook owns its own AbortController + result shape.
async function runDetect(args: {
  sectionId: SectionId;
  body: string;
  provider: string;
  serviceUrl: string;
  fetchFn: typeof fetch;
  signal: AbortSignal;
}): Promise<{ body: string; pendingCitations: PendingCitation[] }> {
  const { sectionId, body, provider, serviceUrl, fetchFn, signal } = args;
  const res = await fetchFn(`${serviceUrl}/detect-citations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ sectionId, body, provider }),
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .catch(() => ({ detail: `Server error ${res.status}` }));
    throw new Error(detail.detail || `Server error ${res.status}`);
  }
  const data = (await res.json()) as DetectResponse;

  let workingBody = body;
  const existing = new Set(parsePendingCitations(body).map((p) => p.id));
  const pendingCitations: PendingCitation[] = [];

  for (const item of data.items || []) {
    const match = findSentenceEnd(workingBody, item.claim_sentence);
    if (!match) continue;
    let id = generatePlaceholderId();
    if (existing.has(id)) id = generatePlaceholderId();
    existing.add(id);

    const marker = buildPendingMarker(id, item.reason || "");
    workingBody =
      workingBody.slice(0, match.insertionOffset) +
      marker +
      workingBody.slice(match.insertionOffset);

    pendingCitations.push({
      id,
      reason: item.reason || "",
      suggestedPaperIds:
        item.suggested_paper_ids as PendingCitation["suggestedPaperIds"],
    });
  }

  return { body: workingBody, pendingCitations };
}

/// Runs /validate-citations and promotes any candidate scoring at or
/// above the threshold. Mirrors `useValidateCitations.run` but inlined
/// for batch ownership.
async function runValidate(args: {
  sectionId: SectionId;
  body: string;
  pendingCitations: PendingCitation[];
  provider: string;
  serviceUrl: string;
  fetchFn: typeof fetch;
  signal: AbortSignal;
}): Promise<{
  body: string;
  promotedCount: number;
  unresolved: PendingCitation[];
}> {
  const {
    sectionId,
    body,
    pendingCitations,
    provider,
    serviceUrl,
    fetchFn,
    signal,
  } = args;
  const items = pendingCitations.map((p) => ({
    placeholder_id: p.id,
    claim_sentence: "",
    candidate_paper_ids: p.suggestedPaperIds,
  }));
  const res = await fetchFn(`${serviceUrl}/validate-citations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ sectionId, body, items, provider }),
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .catch(() => ({ detail: `Server error ${res.status}` }));
    throw new Error(detail.detail || `Server error ${res.status}`);
  }
  const data = (await res.json()) as ValidateResponse;

  let workingBody = body;
  let promotedCount = 0;
  const unresolved: PendingCitation[] = [];
  const pendingById = new Map(pendingCitations.map((p) => [p.id, p]));

  for (const r of data.results ?? []) {
    const top = r.candidates[0];
    if (top && top.score >= AUTO_PROMOTE_THRESHOLD) {
      const marker = buildCitationMarker({
        paperId: top.paper_id as PaperId,
        citationType: "indirect",
        pageRef: top.page_ref_from_excerpt,
        origin: "ai",
      });
      workingBody = replacePendingMarker(workingBody, r.placeholder_id, marker);
      promotedCount++;
    } else {
      const orig = pendingById.get(r.placeholder_id);
      if (orig) unresolved.push(orig);
    }
  }

  return { body: workingBody, promotedCount, unresolved };
}
