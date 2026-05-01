import { useCallback, useEffect, useRef, useState } from "react";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import { streamSSE, type SseEvent } from "@/lib/sseClient";

/// Phases the section-writer popover walks through.
///
/// The clarify call is non-streaming and either lands us in
/// ``awaitingAnswers`` (the AI wants user input) or jumps straight to
/// ``streaming`` (no clarification needed). Once streaming completes we
/// settle in ``done`` so the popover can offer Insert. ``error`` is
/// terminal until the consumer calls :meth:`reset`.
export type GenerateStatus =
  | "idle"
  | "clarifying"
  | "awaitingAnswers"
  | "streaming"
  | "done"
  | "error"
  | "cancelled";

/// Public state shape exposed to the popover component.
export interface GenerateSectionState {
  status: GenerateStatus;
  /// Free-form questions the clarify call returned, if any.
  questions: string[];
  /// Streaming-time accumulator. Reset whenever a fresh generate starts.
  draft: string;
  /// Citation-validator findings surfaced after the stream completes.
  /// Non-blocking — the user may still Insert.
  warnings: string[];
  /// Last error message (clarify or stream). Null in non-error states.
  error: string | null;
  /// Backend tells us when no papers are mapped so we can suppress
  /// retry buttons; the toolbar should also gate the button up front.
  blocked: "no_matches" | null;
}

const INITIAL_STATE: GenerateSectionState = {
  status: "idle",
  questions: [],
  draft: "",
  warnings: [],
  error: null,
  blocked: null,
};

interface ClarifyResponse {
  needs_clarification: boolean;
  questions?: string[];
  blocked?: "no_matches";
}

/// Hook driving the section-writer popover.
///
/// Owns:
///   1. The state machine across clarify → answers → streaming → done.
///   2. The AbortController shared by both the clarify fetch and the
///      streaming response, so a single ``abort()`` cancels whichever
///      call is in flight.
///   3. Cleanup on unmount — we always abort, otherwise the user
///      closing the popover would leave the model writing into the
///      void at our expense.
///
/// The hook deliberately does NOT save anything to Convex — the
/// caller (popover or editor) decides whether to Insert/Append/Replace
/// and runs the existing ``saveSectionContent`` mutation itself.
export function useGenerateSection(sectionId: string, provider: string) {
  const [state, setState] = useState<GenerateSectionState>(INITIAL_STATE);

  /// Live controller for any in-flight clarify or stream call.
  const controllerRef = useRef<AbortController | null>(null);
  /// Cached guidance for the eventual generate call. We capture it on
  /// the initial ``start()`` so the user can edit the textarea later
  /// without changing what the AI was originally given.
  const guidanceRef = useRef<string>("");

  /// Cancel any in-flight network calls. Safe to call repeatedly.
  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  /// Always abort on unmount so a closing popover never leaks a stream.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  /// Reset to idle without changing sectionId/provider. Used when the
  /// popover closes after a successful insert.
  const reset = useCallback(() => {
    abort();
    setState(INITIAL_STATE);
    guidanceRef.current = "";
  }, [abort]);

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
      }));

      try {
        await streamSSE({
          url: `${PYTHON_SERVICE_URL}/generate-section`,
          body: {
            sectionId,
            guidance: guidance || null,
            answers,
            provider,
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
              setState((prev) => ({
                ...prev,
                status: "done",
                // Prefer the validated full text over the raw streamed
                // accumulator: the validator strips invalid markers.
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
      }
    },
    [provider, sectionId]
  );

  /// Kick off a fresh generation. Calls /clarify first; if the AI
  /// wants questions, transitions to ``awaitingAnswers`` — otherwise
  /// it streams immediately. Cancels anything currently in flight.
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
      });

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
    [provider, runGenerate, sectionId]
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
