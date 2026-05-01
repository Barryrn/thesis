import { useState, useCallback, useRef } from "react";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import {
  replaceCitationsWithPlaceholders,
  restorePlaceholders,
  stripCitationMarkers,
} from "@/lib/citationUtils";
import {
  replaceFormulasWithPlaceholders,
  restoreFormulaPlaceholders,
} from "@/lib/formulaUtils";
import {
  replaceFigureMarkersWithPlaceholders,
  restoreFigurePlaceholders,
} from "@/lib/figureUtils";
import type { OptimizeMode } from "@/lib/types";

/// Possible states for the optimize workflow.
///
/// `cancelled` is distinct from `error` so callers can show silent UX
/// (no toast) when the user deliberately aborts via the Stop button.
type OptimizeStatus =
  | "idle"
  | "loading"
  | "preview"
  | "error"
  | "cancelled";

export interface OptimizeState {
  status: OptimizeStatus;
  mode: OptimizeMode | null;
  /// The raw selected text (with citation markers intact).
  originalText: string;
  /// The AI-optimized text (with citation markers restored).
  optimizedText: string;
  /// Selection boundaries at the time the request was made.
  selectionStart: number;
  selectionEnd: number;
  /// Error message when status is "error".
  error: string | null;
}

const INITIAL_STATE: OptimizeState = {
  status: "idle",
  mode: null,
  originalText: "",
  optimizedText: "",
  selectionStart: 0,
  selectionEnd: 0,
  error: null,
};

/// Extracts ~1 sentence of context before the selection start.
/// Searches backward from `start` for the nearest sentence boundary (period,
/// newline, or start of text), taking at most 200 characters.
function extractContextBefore(body: string, start: number): string {
  const lookback = Math.max(0, start - 200);
  const segment = body.slice(lookback, start);
  // Find last sentence boundary in the segment.
  const lastPeriod = Math.max(
    segment.lastIndexOf(". "),
    segment.lastIndexOf(".\n"),
    segment.lastIndexOf("\n\n")
  );
  const contextStart = lastPeriod >= 0 ? lastPeriod + 1 : 0;
  return stripCitationMarkers(segment.slice(contextStart).trim());
}

/// Extracts ~1 sentence of context after the selection end.
/// Searches forward from `end` for the nearest sentence boundary, taking at
/// most 200 characters.
function extractContextAfter(body: string, end: number): string {
  const lookahead = Math.min(body.length, end + 200);
  const segment = body.slice(end, lookahead);
  // Find first sentence boundary in the segment.
  const firstPeriod = segment.search(/\.\s|\.\n|\n\n/);
  const contextEnd = firstPeriod >= 0 ? firstPeriod + 1 : segment.length;
  return stripCitationMarkers(segment.slice(0, contextEnd).trim());
}

/// Hook that encapsulates the AI text optimization workflow.
///
/// Manages the full lifecycle: request → loading → preview/error → accept/discard.
/// Citation markers are swapped to placeholders before the AI call and restored
/// after, ensuring they are never lost or corrupted.
///
/// @param getCustomPrompt Optional callback that returns the resolved custom prompt
///   for a given mode. Called at request time to avoid stale closures.
export function useTextOptimize(
  body: string,
  language: string = "en",
  provider: string = "openai",
  getCustomPrompt?: (mode: OptimizeMode) => string | undefined,
) {
  const [state, setState] = useState<OptimizeState>(INITIAL_STATE);
  /// Abort controller so we can cancel in-flight requests on discard.
  const abortRef = useRef<AbortController | null>(null);

  /// Sends the selected text to the /optimize backend endpoint.
  const requestOptimize = useCallback(
    async (mode: OptimizeMode, selectionStart: number, selectionEnd: number) => {
      // Cancel any in-flight request.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const selectedText = body.slice(selectionStart, selectionEnd);
      if (!selectedText.trim()) return;

      setState({
        status: "loading",
        mode,
        originalText: selectedText,
        optimizedText: "",
        selectionStart,
        selectionEnd,
        error: null,
      });

      try {
        // Swap citations, formulas, and figure markers for safe placeholders.
        const { cleaned: citeCleaned, placeholders } =
          replaceCitationsWithPlaceholders(selectedText);
        const { cleaned: formulaCleaned, placeholders: formulaPlaceholders } =
          replaceFormulasWithPlaceholders(citeCleaned);
        const { cleaned, placeholders: figurePlaceholders } =
          replaceFigureMarkersWithPlaceholders(formulaCleaned);

        // Gather surrounding context for better AI results.
        const contextBefore = extractContextBefore(body, selectionStart);
        const contextAfter = extractContextAfter(body, selectionEnd);

        // Resolve custom prompt for this mode (if any tier is customized).
        const customPrompt = getCustomPrompt?.(mode);

        const res = await fetch(`${PYTHON_SERVICE_URL}/optimize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            text: cleaned,
            mode,
            context_before: contextBefore,
            context_after: contextAfter,
            language,
            provider,
            ...(customPrompt ? { custom_prompt: customPrompt } : {}),
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ detail: "Unknown error" }));
          throw new Error(errBody.detail || `Server error ${res.status}`);
        }

        const data = await res.json();
        const rawOptimized: string = data.optimized;

        // Restore figure markers, then formula markers, then citation markers.
        const { restored: figureRestored, missing: missingFigures } =
          restoreFigurePlaceholders(rawOptimized, figurePlaceholders);
        const { restored: formulaRestored, missing: missingFormulas } =
          restoreFormulaPlaceholders(figureRestored, formulaPlaceholders);
        const { restoredText, missingRefs } = restorePlaceholders(
          formulaRestored,
          placeholders
        );

        const allMissing = [...missingRefs, ...missingFormulas, ...missingFigures];
        if (allMissing.length > 0) {
          setState((prev) => ({
            ...prev,
            status: "error",
            error: `Reference lost during optimization (${allMissing.join(", ")}). Please try again.`,
          }));
          return;
        }

        setState((prev) => ({
          ...prev,
          status: "preview",
          optimizedText: restoredText,
        }));
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") {
          // The user clicked Stop (or this controller was aborted by a
          // newer request). Surface a silent `cancelled` state instead
          // of an error so the UI can simply clear without a toast.
          setState((prev) =>
            prev.status === "loading"
              ? { ...prev, status: "cancelled", error: null }
              : prev,
          );
          return;
        }
        setState((prev) => ({
          ...prev,
          status: "error",
          error: (err as Error).message || "Optimization failed",
        }));
      }
    },
    [body, language, provider, getCustomPrompt]
  );

  /// Aborts an in-flight request and lands in the `cancelled` state.
  /// Idempotent — safe to call when nothing is in flight.
  const cancelOptimize = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState((prev) =>
      prev.status === "loading"
        ? { ...prev, status: "cancelled", error: null }
        : prev,
    );
  }, []);

  /// Accepts the optimized text, splicing it into the body at the original
  /// selection range. Returns the new full body string for the caller to apply.
  const acceptOptimize = useCallback((): { newBody: string } => {
    const { selectionStart, selectionEnd, optimizedText } = state;
    const newBody =
      body.slice(0, selectionStart) + optimizedText + body.slice(selectionEnd);
    setState(INITIAL_STATE);
    return { newBody };
  }, [body, state]);

  /// Discards the preview and resets to idle. Cancels any in-flight request.
  const discardOptimize = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  return {
    state,
    requestOptimize,
    acceptOptimize,
    discardOptimize,
    cancelOptimize,
  };
}
