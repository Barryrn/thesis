/// State machine for the auto-citation validate phase.
///
/// `run()` posts the body + each pending placeholder + its candidate
/// paperIds to /validate-citations and partitions the response by score:
///
///   • score ≥ AUTO_PROMOTE_THRESHOLD → caller replaces the chip with a
///     real {{cite:paperId::indirect::pageRef}} marker in the body.
///   • below threshold → chip stays; caller persists per-placeholder
///     candidate lists (so the popover shows ranked options) and creates
///     a sectionTodos row for tracking.
///
/// The hook itself does no DB writes — it just returns the partition so
/// the caller can run the rewrite atomically alongside the existing
/// autosave path.
import { useCallback, useRef, useState } from "react";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import { replacePendingMarker } from "@/lib/citationUtils";
import type { CitationType, PendingCitation } from "@/lib/types";

/// One candidate ranking from the validate endpoint.
export interface ValidateCandidate {
  paper_id: string;
  score: number;
  page_ref_from_excerpt: string;
  justification: string;
}

/// One per-placeholder result from the validate endpoint.
export interface ValidateResult {
  placeholder_id: string;
  candidates: ValidateCandidate[];
}

interface ValidateResponse {
  results: ValidateResult[];
}

/// Score threshold above which the top candidate is auto-inserted as a
/// real {{cite:...}} marker. Anything below leaves the chip in place.
export const AUTO_PROMOTE_THRESHOLD = 0.75;

/// Default citation type for auto-promoted resolutions. The detect prompt
/// targets paraphrased claims, so indirect ("Vgl.") is the safe default.
const DEFAULT_CITATION_TYPE: CitationType = "indirect";

export type ValidateStatus =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "cancelled";

/// Outcome of `run`. The caller applies `body` (with promoted markers
/// already swapped in) and creates one section TODO per `unresolved` row.
export interface ValidateRunResult {
  body: string;
  /// Promotions that were applied in `body`. Useful for telemetry / toasts.
  promoted: { placeholderId: string; paperId: string; score: number }[];
  /// Placeholders that did not clear the threshold. Each row carries the
  /// full candidate list so the popover can render rankings.
  unresolved: ValidateResult[];
  /// Map keyed by placeholder_id for the popover (covers both promoted and
  /// unresolved placeholders so even a promoted chip's history is queryable
  /// before save commits — though after save it goes away).
  resultsById: Record<string, ValidateResult>;
}

interface UseValidateCitationsOptions {
  sectionId: string;
  provider: string;
}

export interface UseValidateCitations {
  status: ValidateStatus;
  error: string | null;
  run: (
    body: string,
    pendingCitations: PendingCitation[]
  ) => Promise<ValidateRunResult | null>;
  reset: () => void;
  /// Aborts an in-flight validate request and lands in `cancelled`.
  cancel: () => void;
  /// Synchronous read of whether the most recent `run()` was aborted by
  /// the user. See `useDetectCitations` for the same rationale.
  wasCancelled: () => boolean;
}

/// Builds a {{cite:...}} marker for an auto-promoted resolution.
function buildResolvedMarker(
  paperId: string,
  citationType: CitationType,
  pageRef: string
): string {
  return `{{cite:${paperId}::${citationType}::${pageRef}}}`;
}

export function useValidateCitations(
  options: UseValidateCitationsOptions
): UseValidateCitations {
  const [status, setStatus] = useState<ValidateStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  /// Live AbortController for any /validate-citations request in flight.
  const abortRef = useRef<AbortController | null>(null);
  /// Synchronous cancellation flag — see `useDetectCitations`.
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
    setStatus((prev) => (prev === "loading" ? "cancelled" : prev));
    setError(null);
  }, []);

  const wasCancelled = useCallback(() => cancelledRef.current, []);

  const run = useCallback(
    async (
      body: string,
      pendingCitations: PendingCitation[]
    ): Promise<ValidateRunResult | null> => {
      if (pendingCitations.length === 0) {
        return {
          body,
          promoted: [],
          unresolved: [],
          resultsById: {},
        };
      }

      setStatus("loading");
      setError(null);
      cancelledRef.current = false;

      // Build per-placeholder request items by re-extracting each chip's
      // claim sentence from the live body. This way an edit between detect
      // and validate doesn't ship stale prose to the model.
      const items = pendingCitations
        .map((p) => {
          const claim = extractClaimSentenceFor(body, p.id);
          if (!claim) return null;
          return {
            placeholder_id: p.id,
            claim_sentence: claim,
            candidate_paper_ids: p.suggestedPaperIds as unknown as string[],
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (items.length === 0) {
        // All placeholders disappeared from the body since detect — surface
        // success with no changes so the caller can clear pending state.
        setStatus("success");
        return { body, promoted: [], unresolved: [], resultsById: {} };
      }

      // Newer requests supersede in-flight ones; same pattern as the
      // detect/optimize/generate hooks.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/validate-citations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            sectionId: options.sectionId,
            body,
            items,
            provider: options.provider,
          }),
        });
        if (!res.ok) {
          const errBody = await res
            .json()
            .catch(() => ({ detail: `Server error ${res.status}` }));
          throw new Error(errBody.detail || `Server error ${res.status}`);
        }
        const data = (await res.json()) as ValidateResponse;
        const results = data.results || [];

        const resultsById: Record<string, ValidateResult> = {};
        for (const r of results) resultsById[r.placeholder_id] = r;

        const promoted: ValidateRunResult["promoted"] = [];
        const unresolved: ValidateResult[] = [];
        let workingBody = body;

        for (const r of results) {
          const top = r.candidates[0];
          if (top && top.score >= AUTO_PROMOTE_THRESHOLD) {
            const marker = buildResolvedMarker(
              top.paper_id,
              DEFAULT_CITATION_TYPE,
              top.page_ref_from_excerpt
            );
            workingBody = replacePendingMarker(
              workingBody,
              r.placeholder_id,
              marker
            );
            promoted.push({
              placeholderId: r.placeholder_id,
              paperId: top.paper_id,
              score: top.score,
            });
          } else {
            unresolved.push(r);
          }
        }

        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug(
            "[auto-cite] validate:",
            "results=", results.length,
            "promoted=", promoted.length,
            "unresolved=", unresolved.length,
          );
        }

        setStatus("success");
        return { body: workingBody, promoted, unresolved, resultsById };
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setStatus((prev) => (prev === "loading" ? "cancelled" : prev));
          return null;
        }
        const message = e instanceof Error ? e.message : String(e);
        setStatus("error");
        setError(message);
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug("[auto-cite] validate failed:", message);
        }
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [options.sectionId, options.provider]
  );

  return { status, error, run, reset, cancel, wasCancelled };
}

/// Locates the sentence containing the placeholder marker in `body` and
/// returns just the claim sentence (without the marker itself). This is
/// what gets sent to the validator so the model scores against the prose
/// the user is currently editing — not the snapshot detect saw.
function extractClaimSentenceFor(body: string, placeholderId: string): string | null {
  const re = new RegExp(
    `\\{\\{citeNeeded:${placeholderId}::[^}]*\\}\\}`,
    "g"
  );
  const m = re.exec(body);
  if (!m) return null;

  const markerStart = m.index;

  // Walk backwards to the previous sentence terminator (or start of body).
  let start = markerStart;
  while (start > 0) {
    const c = body[start - 1];
    if ((c === "." || c === "!" || c === "?") && /\s/.test(body[start] ?? "")) {
      // Skip the terminator + any whitespace that follows it.
      while (start < body.length && /\s/.test(body[start])) start++;
      break;
    }
    start--;
  }

  // Walk forward from `markerStart` past the marker, then find the first
  // terminator after it (the sentence the marker belongs to).
  const afterMarker = markerStart + m[0].length;
  let end = afterMarker;
  while (end < body.length) {
    const c = body[end];
    if (c === "." || c === "!" || c === "?") {
      end++;
      break;
    }
    end++;
  }

  // Strip the marker out of the returned sentence — the model doesn't need
  // to see our internal syntax.
  const sentence = body.slice(start, end).replace(re, "").trim();
  return sentence || null;
}
