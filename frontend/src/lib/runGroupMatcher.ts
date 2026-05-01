/// Browser-side AI matcher orchestrator. Runs the full
/// "score every eligible paper against one group" loop from the user's
/// laptop, where it can reach the local Python service.
///
/// We keep this client-side (rather than in a Convex action) because the
/// Convex action runtime is in the cloud and cannot connect to the user's
/// localhost Python container. The action's previous attempt to fetch
/// http://localhost:8000 always failed with ECONNREFUSED — see the
/// console logs in grouper.ts before this rewrite.
///
/// The Convex side still owns:
///   • candidate selection (getRunCandidates query — does the dedupe/filter)
///   • progress + status (start/increment/finishSuggestionRun mutations)
///   • suggestion persistence (recordSuggestion)
///
/// This module is just the network layer that bridges the two.

import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PYTHON_SERVICE_URL } from "./config";

interface SuggestGroupsResponse {
  suggestions: {
    paperId: string;
    groupId: string;
    confidence: number;
    reason: string;
  }[];
}

interface GroupArg {
  groupId: string;
  description: string;
}

/// Run the matcher for a single group. Drives the full lifecycle:
///   start run → score each paper → record matches → finish run.
/// Returns the number of new suggestions written (for the toast).
///
/// Pass `signal` to allow the caller to stop the run mid-flight. When the
/// signal aborts:
///   • the in-flight fetch is cancelled (AbortController on fetch)
///   • the per-paper loop exits at its next checkpoint
///   • finishSuggestionRun is still called so the spinner clears
export async function runGroupMatcher(
  convex: ConvexReactClient,
  groupId: Id<"paperGroups">,
  options: { provider?: "anthropic" | "openai"; signal?: AbortSignal } = {}
): Promise<number> {
  const provider = options.provider ?? "anthropic";
  const signal = options.signal;

  // 1. Fetch the work list. Convex applies all the filters here so the
  //    client never has to know about declines / memberships / hashes.
  const candidates = await convex.query(api.groups.getRunCandidates, {
    groupId,
  });
  if (!candidates) {
    console.warn(
      "[matcher] no candidates returned — group is not auto-assign or has no description"
    );
    return 0;
  }

  const { group, papers } = candidates;
  console.log(
    `[matcher] starting run for group="${group.name}", papers=${papers.length}`
  );

  // 2. Flip into "running" state so the group row shows the spinner.
  await convex.mutation(api.groups.startSuggestionRun, {
    groupId,
    total: papers.length,
  });

  // Empty work list — close out cleanly so the toast still fires.
  if (papers.length === 0) {
    await convex.mutation(api.groups.finishSuggestionRun, { groupId });
    return 0;
  }

  const groupArg: GroupArg = {
    groupId: group._id,
    description: group.description,
  };

  let writtenSuggestions = 0;
  let lastError: string | undefined;

  let aborted = false;
  try {
    // 3. Score one paper per Python call. Per-paper round-trips give live
    //    progress in the UI, and one failure can't take down the whole run.
    for (const paper of papers) {
      // Honor the abort signal at every loop iteration, before any new
      // network call. Already-written suggestions are preserved.
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/suggest-groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            papers: [paper],
            groups: [groupArg],
            provider,
          }),
          // Cancels the in-flight HTTP request when the user clicks Stop.
          signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "<unreadable>");
          console.error(
            `[matcher] non-OK from Python: ${res.status}`,
            body.slice(0, 300)
          );
        } else {
          const data = (await res.json()) as SuggestGroupsResponse;
          for (const s of data.suggestions ?? []) {
            await convex.mutation(api.groups.recordSuggestion, {
              paperId: s.paperId as Id<"papers">,
              groupId: s.groupId as Id<"paperGroups">,
              confidence: s.confidence,
              reason: s.reason,
              groupDescriptionHashAtSuggestion: group.descriptionHash,
            });
            writtenSuggestions++;
          }
        }
      } catch (err) {
        // AbortError from fetch is the user clicking Stop — exit the loop
        // cleanly. Any other error is a real failure: log and continue so
        // one bad paper can't take down the whole run.
        if (err instanceof DOMException && err.name === "AbortError") {
          aborted = true;
          break;
        }
        console.error("[matcher] per-paper fetch failed:", err);
        lastError = err instanceof Error ? err.message : String(err);
      }
      await convex.mutation(api.groups.incrementSuggestionRun, {
        groupId,
        by: 1,
      });
    }
  } finally {
    // 4. Always close the run, even on uncaught exceptions or abort, so the
    //    spinner doesn't get stuck forever. Abort isn't surfaced as an error
    //    — the user already knows they cancelled.
    await convex.mutation(api.groups.finishSuggestionRun, {
      groupId,
      // Only surface the error if we got zero suggestions and weren't
      // aborted — a single transient failure shouldn't paint the run red,
      // and a deliberate stop isn't a failure at all.
      error:
        writtenSuggestions === 0 && !aborted ? lastError : undefined,
    });
  }

  if (aborted) {
    console.log(
      `[matcher] run aborted for "${group.name}": ${writtenSuggestions} suggestion(s) written before stop`
    );
    return writtenSuggestions;
  }

  console.log(
    `[matcher] run complete for "${group.name}": ${writtenSuggestions} suggestion(s) written`
  );
  return writtenSuggestions;
}
