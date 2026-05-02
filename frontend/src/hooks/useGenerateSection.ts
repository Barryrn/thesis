import { useCallback, useEffect, useRef, useState } from "react";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import { streamSSE, type SseEvent } from "@/lib/sseClient";
import { useDetectCitations } from "@/hooks/useDetectCitations";
import { useValidateCitations } from "@/hooks/useValidateCitations";
import type { PendingCitation } from "@/lib/types";

/// Phases the section-writer popover walks through.
///
/// Two-pass mode chains three backend calls after clarify:
///   streaming  – /generate-section emits prose only (no citations)
///   detecting  – /detect-citations marks claims with {{citeNeeded:...}}
///   validating – /validate-citations scores each claim's candidates and
///                promotes ≥0.75 to real {{cite:...}} markers
///
/// Each phase shares one AbortController so a single Stop click cancels
/// whichever step is in flight.
export type GenerateStatus =
  | "idle"
  | "clarifying"
  | "awaitingAnswers"
  | "streaming"
  | "detecting"
  | "validating"
  | "done"
  | "error"
  | "cancelled";

/// Public state shape exposed to the popover component.
export interface GenerateSectionState {
  status: GenerateStatus;
  /// Free-form questions the clarify call returned, if any.
  questions: string[];
  /// Streaming-time accumulator. Reset whenever a fresh generate starts.
  /// After the detect+validate chain settles, this holds the resolved
  /// body with `{{cite:...}}` markers spliced in by validate.
  draft: string;
  /// Citation-validator findings surfaced after the stream completes.
  /// Non-blocking — the user may still Insert.
  warnings: string[];
  /// Last error message (clarify, stream, detect, or validate). Null in
  /// non-error states.
  error: string | null;
  /// Backend tells us when no papers are mapped so we can suppress
  /// retry buttons; the toolbar should also gate the button up front.
  blocked: "no_matches" | null;
  /// Pending citations the detect phase produced that did NOT clear the
  /// validate threshold. Caller persists these so the popover can show
  /// per-chip ranking lists.
  pendingCitations: PendingCitation[];
}

const INITIAL_STATE: GenerateSectionState = {
  status: "idle",
  questions: [],
  draft: "",
  warnings: [],
  error: null,
  blocked: null,
  pendingCitations: [],
};

interface ClarifyResponse {
  needs_clarification: boolean;
  questions?: string[];
  blocked?: "no_matches";
}

/// Optional configuration for the hook.
export interface UseGenerateSectionOptions {
  /// When true, falls back to legacy one-pass generation (the writer
  /// emits `{{cite:...}}` inline). Default false: two-pass.
  citeInline?: boolean;
  /// When true, skip the /clarify roundtrip and stream immediately.
  /// Used by the batch runner so a 12-section subtree doesn't pop 12
  /// dialogs. Default false: clarify normally.
  skipClarify?: boolean;
}

/// Hook driving the section-writer popover.
///
/// Owns:
///   1. The state machine across clarify → answers → streaming →
///      detecting → validating → done.
///   2. The AbortController shared by clarify + stream. The detect and
///      validate phases manage their own controllers internally; on
///      external `abort()` we call their public `cancel()` methods.
///   3. Cleanup on unmount — we always abort, otherwise the user
///      closing the popover would leave the model writing into the
///      void at our expense.
///
/// The hook deliberately does NOT save anything to Convex — the
/// caller (popover or editor) decides whether to Insert/Append/Replace
/// and runs the existing ``saveSectionContent`` mutation itself.
export function useGenerateSection(
  sectionId: string,
  provider: string,
  options: UseGenerateSectionOptions = {}
) {
  const { citeInline = false, skipClarify = false } = options;
  const [state, setState] = useState<GenerateSectionState>(INITIAL_STATE);

  /// Live controller for any in-flight clarify or stream call. Detect
  /// and validate use their own internal controllers (they're separate
  /// hooks); we cancel them through their public `cancel()` API.
  const controllerRef = useRef<AbortController | null>(null);
  /// Cached guidance for the eventual generate call. We capture it on
  /// the initial ``start()`` so the user can edit the textarea later
  /// without changing what the AI was originally given.
  const guidanceRef = useRef<string>("");

  // Compose with detect + validate so two-pass generation can chain
  // them onto the streaming output without any caller wiring.
  const detect = useDetectCitations({ sectionId, provider });
  const validate = useValidateCitations({ sectionId, provider });

  /// Cancel any in-flight network calls. Safe to call repeatedly. Hits
  /// every layer (clarify/stream + detect + validate) so the caller
  /// doesn't need to reason about which phase is currently active.
  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    detect.cancel();
    validate.cancel();
  }, [detect, validate]);

  /// Always abort on unmount so a closing popover never leaks a stream
  /// or a follow-up detect/validate call.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      // detect/validate cancellation on unmount is handled by their own
      // hook lifecycles — calling them here would be a no-op once their
      // refs have been torn down.
    };
  }, []);

  /// Reset to idle without changing sectionId/provider. Used when the
  /// popover closes after a successful insert.
  const reset = useCallback(() => {
    abort();
    setState(INITIAL_STATE);
    guidanceRef.current = "";
  }, [abort]);

  /// Run the detect → validate chain on a finished draft.
  ///
  /// Returns the resolved body (with promoted citations spliced in) and
  /// the list of placeholders that did NOT clear the validate threshold.
  /// Cancellation lands the outer state in `cancelled`; errors land it
  /// in `error`. The draft is preserved either way so the user can still
  /// inspect the prose.
  const runCitationChain = useCallback(
    async (draftBody: string) => {
      // Phase 2: detect.
      setState((prev) => ({ ...prev, status: "detecting", error: null }));
      const detectResult = await detect.run(draftBody);
      if (detect.wasCancelled()) {
        setState((prev) =>
          prev.status === "detecting"
            ? { ...prev, status: "cancelled", error: null }
            : prev,
        );
        return;
      }
      if (!detectResult) {
        // Detect set its own error state. Mirror onto the outer machine.
        setState((prev) => ({
          ...prev,
          status: "error",
          error: detect.error || "Citation detection failed.",
        }));
        return;
      }

      // No claims to validate? Settle as `done` immediately — clean
      // prose with no citations is a valid output for short paragraphs.
      if (detectResult.pendingCitations.length === 0) {
        setState((prev) => ({
          ...prev,
          status: "done",
          draft: detectResult.body,
          pendingCitations: [],
          warnings: [...prev.warnings, ...(detectResult.warnings ?? [])],
        }));
        return;
      }

      // Phase 3: validate.
      setState((prev) => ({
        ...prev,
        status: "validating",
        draft: detectResult.body,
        warnings: [...prev.warnings, ...(detectResult.warnings ?? [])],
      }));
      const validateResult = await validate.run(
        detectResult.body,
        detectResult.pendingCitations
      );
      if (validate.wasCancelled()) {
        setState((prev) =>
          prev.status === "validating"
            ? {
                ...prev,
                status: "cancelled",
                // Keep the detect-stage body so the user sees the chips
                // even though validate didn't get to score them.
                draft: detectResult.body,
                pendingCitations: detectResult.pendingCitations,
                error: null,
              }
            : prev,
        );
        return;
      }
      if (!validateResult) {
        setState((prev) => ({
          ...prev,
          status: "error",
          error: validate.error || "Citation validation failed.",
        }));
        return;
      }

      // Map the per-placeholder original metadata onto the unresolved
      // entries so the caller can persist them to Convex via the
      // existing pendingCitations cache shape.
      const pendingById = new Map(
        detectResult.pendingCitations.map((p) => [p.id, p])
      );
      const unresolved: PendingCitation[] = validateResult.unresolved
        .map((r) => pendingById.get(r.placeholder_id))
        .filter((p): p is PendingCitation => Boolean(p));

      setState((prev) => ({
        ...prev,
        status: "done",
        draft: validateResult.body,
        pendingCitations: unresolved,
      }));
    },
    [detect, validate]
  );

  /// Drive the streaming generate call. Used by both the
  /// "clarification not needed" path and the "answers submitted" path,
  /// so it lives separately rather than being inlined in ``start``.
  const runGenerate = useCallback(
    async (
      guidance: string,
      answers: { question: string; answer: string }[]
    ) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setState((prev) => ({
        ...prev,
        status: "streaming",
        draft: "",
        warnings: [],
        error: null,
        pendingCitations: [],
      }));

      let streamedFullText = "";
      let streamFailed = false;

      try {
        await streamSSE({
          url: `${PYTHON_SERVICE_URL}/generate-section`,
          body: {
            sectionId,
            guidance: guidance || null,
            answers,
            provider,
            cite_inline: citeInline,
          },
          signal: controller.signal,
          onEvent: (event: SseEvent) => {
            if (event.type === "ready") {
              // No-op — just confirms the stream is live and any
              // upstream proxy buffer has been flushed.
              return;
            }
            if (event.type === "token") {
              const delta = typeof event.delta === "string" ? event.delta : "";
              if (!delta) return;
              setState((prev) => ({
                ...prev,
                draft: prev.draft + delta,
              }));
              return;
            }
            if (event.type === "done") {
              const fullText =
                typeof event.fullText === "string" ? event.fullText : "";
              const warnings = Array.isArray(event.warnings)
                ? (event.warnings as string[])
                : [];
              streamedFullText = fullText;
              setState((prev) => ({
                ...prev,
                // Prefer the validated full text over the raw streamed
                // accumulator: the backend may have stripped leakage.
                draft: fullText || prev.draft,
                warnings,
              }));
              return;
            }
            if (event.type === "error") {
              const message =
                typeof event.message === "string"
                  ? event.message
                  : "Streaming failed";
              streamFailed = true;
              setState((prev) => ({
                ...prev,
                status: "error",
                error: message,
              }));
            }
          },
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // User clicked Stop (or a newer call superseded this one).
          // Surface a silent `cancelled` state so callers can keep the
          // partial draft on screen without rendering a "Streaming
          // failed" error toast.
          setState((prev) =>
            prev.status === "streaming"
              ? { ...prev, status: "cancelled", error: null }
              : prev,
          );
          return;
        }
        setState((prev) => ({
          ...prev,
          status: "error",
          error: (err as Error).message || "Streaming failed",
        }));
        return;
      }

      // In legacy one-pass mode the writer already emitted citations,
      // so we settle as `done` directly. Two-pass mode chains
      // detect+validate on the streamed prose.
      if (streamFailed) return;
      if (citeInline) {
        setState((prev) => ({ ...prev, status: "done" }));
        return;
      }
      if (!streamedFullText) {
        // Stream produced nothing — treat as error rather than running
        // detect+validate against an empty body (which would no-op silently).
        setState((prev) => ({
          ...prev,
          status: "error",
          error: "The model returned an empty draft.",
        }));
        return;
      }
      await runCitationChain(streamedFullText);
    },
    [citeInline, provider, runCitationChain, sectionId]
  );

  /// Kick off a fresh generation. Calls /clarify first (unless
  /// ``skipClarify`` is set); if the AI wants questions, transitions to
  /// ``awaitingAnswers`` — otherwise it streams immediately. Cancels
  /// anything currently in flight.
  const start = useCallback(
    async (guidance: string) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      guidanceRef.current = guidance;
      setState({
        status: "clarifying",
        questions: [],
        draft: "",
        warnings: [],
        error: null,
        blocked: null,
        pendingCitations: [],
      });

      // Batch mode and other automated callers can opt out of the
      // clarify roundtrip — popping a dialog per section is unworkable
      // when generating an entire chapter at once.
      if (skipClarify) {
        await runGenerate(guidance, []);
        return;
      }

      let parsed: ClarifyResponse;
      try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/clarify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            sectionId,
            guidance: guidance || null,
            provider,
          }),
        });
        if (!res.ok) {
          const detail = await res
            .json()
            .catch(() => ({ detail: `Server error ${res.status}` }));
          throw new Error(detail.detail || `Server error ${res.status}`);
        }
        parsed = (await res.json()) as ClarifyResponse;
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // Cancelled while the clarify request was outstanding —
          // silent transition.
          setState((prev) =>
            prev.status === "clarifying"
              ? { ...prev, status: "cancelled", error: null }
              : prev,
          );
          return;
        }
        setState((prev) => ({
          ...prev,
          status: "error",
          error: (err as Error).message || "Clarify failed",
        }));
        return;
      }

      // Defensive: the toolbar should already block the button when
      // there are no mapped papers, but a stale UI could slip through.
      if (parsed.blocked === "no_matches") {
        setState({
          status: "error",
          questions: [],
          draft: "",
          warnings: [],
          error: "No mapped papers for this section.",
          blocked: "no_matches",
          pendingCitations: [],
        });
        return;
      }

      if (parsed.needs_clarification && (parsed.questions ?? []).length > 0) {
        setState((prev) => ({
          ...prev,
          status: "awaitingAnswers",
          questions: parsed.questions ?? [],
        }));
        return;
      }

      // No clarification needed — go straight to streaming.
      await runGenerate(guidance, []);
    },
    [provider, runGenerate, sectionId, skipClarify]
  );

  /// Called by the popover after the user fills in clarify answers.
  /// Pairs them with the original questions and starts streaming.
  const submitAnswers = useCallback(
    async (answers: string[]) => {
      const paired = state.questions.map((question, i) => ({
        question,
        answer: (answers[i] ?? "").trim(),
      }));
      await runGenerate(guidanceRef.current, paired);
    },
    [runGenerate, state.questions]
  );

  /// Skip clarification questions. The AI is told via empty answers
  /// that the user opted out, and the original guidance is reused.
  const skipAnswers = useCallback(async () => {
    await runGenerate(guidanceRef.current, []);
  }, [runGenerate]);

  return {
    state,
    start,
    submitAnswers,
    skipAnswers,
    abort,
    reset,
  };
}
