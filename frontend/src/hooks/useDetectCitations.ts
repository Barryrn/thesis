/// State machine for the auto-citation detect phase.
///
/// `run()` does three things in sequence:
///   1. Posts the live body + sectionId to /detect-citations.
///   2. For each returned item, locates the claim sentence in the live body
///      (handling whitespace drift and light paraphrase via sentenceMatch).
///   3. Splices a `{{citeNeeded:<id>::<encodedReason>}}` marker at the end
///      of each matched sentence and returns the rewritten body plus the
///      cached `pendingCitations` array for `saveSectionContent`.
///
/// The hook does NOT save — the caller wires the returned body into the
/// editor and calls its existing `flushSave` so the chip insertion lands
/// on the same autosave path as user typing.
import { useCallback, useRef, useState } from "react";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import {
  buildPendingMarker,
  generatePlaceholderId,
  parsePendingCitations,
} from "@/lib/citationUtils";
import { findSentenceEnd } from "@/lib/sentenceMatch";
import type { PendingCitation } from "@/lib/types";

/// Hook state. `loading` blocks repeated clicks; `error` surfaces a toast.
/// `cancelled` is distinct from `error` so a Stop click does not raise a
/// "detect failed" toast.
export type DetectStatus =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "cancelled";

/// What the detect endpoint returns per claim.
interface DetectItem {
  claim_sentence: string;
  claim_type: "empirical" | "theoretical" | "data" | "general";
  suggested_paper_ids: string[];
  reason: string;
}

interface DetectResponse {
  items: DetectItem[];
  warnings: string[];
}

/// Outcome of a successful run. The caller applies `body` and persists
/// `pendingCitations` via `saveSectionContent`.
export interface DetectRunResult {
  body: string;
  pendingCitations: PendingCitation[];
  /// How many of the model's items couldn't be located in the live body.
  /// Surfaced as a toast so the user knows some suggestions were dropped.
  unmatchedCount: number;
  /// Warnings from the backend parser (e.g. "Dropped N entries with unknown
  /// paperIds"). Empty when the response was clean.
  warnings: string[];
  /// Number of placeholders actually inserted.
  insertedCount: number;
}

interface UseDetectCitationsOptions {
  sectionId: string;
  provider: string;
}

/// Returned API. `run` accepts the live body so the caller doesn't need to
/// re-read the editor DOM — the hook stays pure of editor-state concerns.
export interface UseDetectCitations {
  status: DetectStatus;
  error: string | null;
  run: (body: string) => Promise<DetectRunResult | null>;
  reset: () => void;
  /// Aborts any in-flight detect request and lands in the `cancelled`
  /// state. No-op when nothing is running.
  cancel: () => void;
  /// Synchronous read of whether the most recent `run()` ended via
  /// `cancel()`. Use this in handlers to skip error toasts after a
  /// user-initiated abort — `status` lags one render so it can't be
  /// trusted directly after `await run()`.
  wasCancelled: () => boolean;
}

/// Builder for the hook. The state lives inside the hook so two editors
/// (split-view, etc.) don't share running flags.
export function useDetectCitations(
  options: UseDetectCitationsOptions
): UseDetectCitations {
  const [status, setStatus] = useState<DetectStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  /// Live AbortController for any /detect-citations request in flight.
  /// Reset to null between calls so `cancel()` is a no-op when idle.
  const abortRef = useRef<AbortController | null>(null);
  /// Synchronous flag flipped by `cancel()` and read by handlers right
  /// after `await run()` to distinguish abort from genuine failure.
  /// State updates are batched and lag a render — a ref does not.
  const cancelledRef = useRef(false);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      cancelledRef.current = true;
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Only flip to `cancelled` if we were actively running — otherwise
    // we'd clobber a freshly-finished `success` state with a stale stop
    // click that arrived a tick late.
    setStatus((prev) => (prev === "loading" ? "cancelled" : prev));
    setError(null);
  }, []);

  const wasCancelled = useCallback(() => cancelledRef.current, []);

  const run = useCallback(
    async (body: string): Promise<DetectRunResult | null> => {
      if (!body.trim()) {
        // No prose, nothing to scan. Surface a soft no-op rather than calling
        // the backend with an empty body — the model would just return [].
        return {
          body,
          pendingCitations: [],
          unmatchedCount: 0,
          warnings: [],
          insertedCount: 0,
        };
      }
      setStatus("loading");
      setError(null);
      cancelledRef.current = false;

      // A fresh run supersedes any in-flight one, mirroring the same
      // pattern used by `useTextOptimize` and `useGenerateSection`.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/detect-citations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            sectionId: options.sectionId,
            body,
            provider: options.provider,
          }),
        });
        if (!res.ok) {
          const errBody = await res
            .json()
            .catch(() => ({ detail: `Server error ${res.status}` }));
          throw new Error(errBody.detail || `Server error ${res.status}`);
        }
        const data = (await res.json()) as DetectResponse;

        // Skip placeholder ids that already exist in the body — defensive
        // against a partial prior detect run that inserted some markers.
        const existing = new Set(parsePendingCitations(body).map((p) => p.id));

        // Walk items in document order so insertions don't shift earlier
        // offsets. We resolve each claim against the *current* working body
        // (which grows as we splice markers in), keeping subsequent matches
        // accurate even when an earlier marker bumped offsets forward.
        let workingBody = body;
        const pendingCitations: PendingCitation[] = [];
        let unmatchedCount = 0;

        for (const item of data.items || []) {
          const match = findSentenceEnd(workingBody, item.claim_sentence);
          if (!match) {
            unmatchedCount++;
            continue;
          }

          // Generate a unique id, retrying once in the astronomically unlikely
          // collision case.
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
            suggestedPaperIds: item.suggested_paper_ids as PendingCitation["suggestedPaperIds"],
          });
        }

        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug(
            "[auto-cite] detect:",
            "items=", data.items?.length ?? 0,
            "inserted=", pendingCitations.length,
            "unmatched=", unmatchedCount,
          );
        }

        setStatus("success");
        return {
          body: workingBody,
          pendingCitations,
          unmatchedCount,
          warnings: data.warnings || [],
          insertedCount: pendingCitations.length,
        };
      } catch (e) {
        // User-initiated abort lands in the silent `cancelled` state so
        // the section editor doesn't show a "detect failed" toast for a
        // request that was deliberately stopped.
        if (e instanceof DOMException && e.name === "AbortError") {
          setStatus((prev) => (prev === "loading" ? "cancelled" : prev));
          return null;
        }
        const message = e instanceof Error ? e.message : String(e);
        setStatus("error");
        setError(message);
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug("[auto-cite] detect failed:", message);
        }
        return null;
      } finally {
        // Drop the controller reference once the request settles so a
        // late `cancel()` doesn't try to abort an already-resolved fetch.
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [options.sectionId, options.provider]
  );

  return { status, error, run, reset, cancel, wasCancelled };
}
