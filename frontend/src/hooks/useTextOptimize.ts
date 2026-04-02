import { useState, useCallback, useRef } from "react";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import {
  replaceCitationsWithPlaceholders,
  restorePlaceholders,
  stripCitationMarkersToLabels,
} from "@/lib/citationUtils";
import type { OptimizeMode } from "@/lib/types";

/// Possible states for the optimize workflow.
type OptimizeStatus = "idle" | "loading" | "preview" | "error";

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
  return stripCitationMarkersToLabels(segment.slice(contextStart).trim());
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
  return stripCitationMarkersToLabels(segment.slice(0, contextEnd).trim());
}

/// Hook that encapsulates the AI text optimization workflow.
///
/// Manages the full lifecycle: request → loading → preview/error → accept/discard.
/// Citation markers are swapped to placeholders before the AI call and restored
/// after, ensuring they are never lost or corrupted.
export function useTextOptimize(body: string, language: string = "en") {
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
        // Swap citations for safe placeholders.
        const { cleaned, placeholders } =
          replaceCitationsWithPlaceholders(selectedText);

        // Gather surrounding context for better AI results.
        const contextBefore = extractContextBefore(body, selectionStart);
        const contextAfter = extractContextAfter(body, selectionEnd);

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
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ detail: "Unknown error" }));
          throw new Error(errBody.detail || `Server error ${res.status}`);
        }

        const data = await res.json();
        const rawOptimized: string = data.optimized;

        // Restore citation markers from placeholders.
        const { restoredText, missingRefs } = restorePlaceholders(
          rawOptimized,
          placeholders
        );

        if (missingRefs.length > 0) {
          setState((prev) => ({
            ...prev,
            status: "error",
            error: `Citation lost during optimization (${missingRefs.join(", ")}). Please try again.`,
          }));
          return;
        }

        setState((prev) => ({
          ...prev,
          status: "preview",
          optimizedText: restoredText,
        }));
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          status: "error",
          error: (err as Error).message || "Optimization failed",
        }));
      }
    },
    [body, language]
  );

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

  return { state, requestOptimize, acceptOptimize, discardOptimize };
}
