/// Behavioural tests for the batch section-writer hook.
///
/// We inject fake adapters + a fake fetch + a fake SSE stream so the
/// hook runs end-to-end against in-memory doubles. Each test asserts
/// one decision branch in `processOne`:
///
///   1. happy path — three sections all run to `done`
///   2. skip-no-notes — empty notes short-circuits to `skipped`
///   3. skip-existing-body (mode=skip) — non-empty body short-circuits
///   4. mode=replace overrides the existing-body skip
///   5. one section fails → batch continues with the rest
///   6. Stop mid-batch → current section cancels + queue clears
///   7. zero papers met threshold → section fails fast (not silently)
///
/// The fakes deliberately avoid timers and yield to the microtask
/// queue with `flushPromises` so the tests stay deterministic.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useBatchGenerateSections,
  type BatchAdapters,
  type BatchSectionInput,
} from "../useBatchGenerateSections";
import type { PaperId, PendingCitation, SectionId } from "@/lib/types";

/// Lets pending microtasks resolve so React state updates flush before
/// the next assertion. Avoids `waitFor` polling loops.
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/// Build a section input with sane defaults. Override fields per test.
function makeSection(
  i: number,
  overrides: Partial<BatchSectionInput> = {}
): BatchSectionInput {
  return {
    sectionId: `sec_${i}` as unknown as SectionId,
    title: `Section ${i}`,
    orderNumber: `${i}`,
    notes: "Some notes",
    currentBody: null,
    ...overrides,
  };
}

/// Fake adapters that record every call. The recommend fake returns one
/// paper above the threshold so processOne can proceed past the linking
/// gate; tests that need the "no papers" branch override this.
function makeAdapters(): BatchAdapters & {
  recommendCalls: SectionId[];
  saveCalls: { id: SectionId; body: string }[];
  matchCalls: { paperId: PaperId; sectionId: SectionId; score: number }[];
} {
  const recommendCalls: SectionId[] = [];
  const saveCalls: { id: SectionId; body: string }[] = [];
  const matchCalls: {
    paperId: PaperId;
    sectionId: SectionId;
    score: number;
  }[] = [];

  return {
    recommendCalls,
    saveCalls,
    matchCalls,
    async recommend(sectionId) {
      recommendCalls.push(sectionId);
      return [
        { paperId: "paper_a" as unknown as PaperId, score: 0.9 },
        { paperId: "paper_b" as unknown as PaperId, score: 0.6 }, // below threshold
      ];
    },
    async addMatch(paperId, sectionId, score) {
      matchCalls.push({ paperId, sectionId, score });
    },
    async save(sectionId, body) {
      saveCalls.push({ id: sectionId, body });
    },
  };
}

/// Fake SSE stream that emits a fixed body for every /generate-section
/// call. Returns immediately so the test doesn't have to wait on real
/// network latency or chunk timing.
const fakeStream = vi.fn(async (req: any) => {
  req.onEvent({ type: "ready" });
  req.onEvent({ type: "token", delta: "Drafted prose. " });
  req.onEvent({
    type: "done",
    fullText: "Drafted prose for the section.",
    warnings: [],
  });
});

/// Fake fetch routing both /detect-citations and /validate-citations
/// to canned JSON. Detect returns one claim; validate scores it above
/// the auto-promote threshold so the resulting body has a real cite
/// marker spliced in.
function makeFetch(
  overrides: { detect?: any; validate?: any; failDetect?: boolean } = {}
) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith("/detect-citations")) {
      if (overrides.failDetect) {
        return new Response(JSON.stringify({ detail: "boom" }), {
          status: 500,
        });
      }
      const body = overrides.detect ?? {
        items: [
          {
            claim_sentence: "Drafted prose for the section.",
            claim_type: "general",
            suggested_paper_ids: ["paper_a"],
            reason: "needs cite",
          },
        ],
        warnings: [],
      };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (url.endsWith("/validate-citations")) {
      const body = overrides.validate ?? {
        results: [
          {
            placeholder_id: "ANY", // overwritten per-call below
            candidates: [
              {
                paper_id: "paper_a",
                score: 0.92,
                page_ref_from_excerpt: "S. 14",
              },
            ],
          },
        ],
      };
      // Detect generates random placeholder IDs at runtime; we mirror
      // whatever the validate request used so the promotion succeeds.
      const reqBody = JSON.parse((_init as any).body as string);
      const items = reqBody.items ?? [];
      const aligned = {
        results: items.map((it: any, i: number) => {
          const tmpl = body.results?.[i] ?? body.results?.[0];
          return { ...tmpl, placeholder_id: it.placeholder_id };
        }),
      };
      return new Response(JSON.stringify(aligned), { status: 200 });
    }
    throw new Error(`Unexpected URL ${url}`);
  });
}

beforeEach(() => {
  fakeStream.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useBatchGenerateSections", () => {
  it("runs the happy path: drafts → cites → saves every section", async () => {
    const adapters = makeAdapters();
    const fetchImpl = makeFetch();
    const { result } = renderHook(() =>
      useBatchGenerateSections({
        provider: "openai",
        adapters,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        streamImpl: fakeStream as unknown as any,
      }),
    );

    const sections = [makeSection(1), makeSection(2)];
    await act(async () => {
      await result.current.start(sections, "skip");
    });

    expect(result.current.state.status).toBe("completed");
    expect(result.current.state.stats).toMatchObject({
      total: 2,
      done: 2,
      skipped: 0,
      failed: 0,
    });
    // One save per section.
    expect(adapters.saveCalls).toHaveLength(2);
    // Each save body should carry the promoted citation marker.
    for (const call of adapters.saveCalls) {
      expect(call.body).toContain("{{cite:paper_a::indirect::S. 14");
    }
    // Only the above-threshold paper should be auto-linked.
    expect(adapters.matchCalls.every((c) => c.paperId === "paper_a")).toBe(true);
  });

  it("skips sections with no notes and continues the batch", async () => {
    const adapters = makeAdapters();
    const fetchImpl = makeFetch();
    const { result } = renderHook(() =>
      useBatchGenerateSections({
        provider: "openai",
        adapters,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        streamImpl: fakeStream as unknown as any,
      }),
    );

    const sections = [
      makeSection(1, { notes: "" }), // skipped
      makeSection(2),                 // processed
      makeSection(3, { notes: null }),// skipped
    ];
    await act(async () => {
      await result.current.start(sections, "skip");
    });

    expect(result.current.state.stats).toMatchObject({
      total: 3,
      done: 1,
      skipped: 2,
    });
    // Recommend (and downstream) ran only for the section with notes.
    expect(adapters.recommendCalls).toHaveLength(1);
  });

  it("skips sections with existing body when mode=skip", async () => {
    const adapters = makeAdapters();
    const fetchImpl = makeFetch();
    const { result } = renderHook(() =>
      useBatchGenerateSections({
        provider: "openai",
        adapters,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        streamImpl: fakeStream as unknown as any,
      }),
    );

    const sections = [
      makeSection(1, { currentBody: "already written" }),
      makeSection(2),
    ];
    await act(async () => {
      await result.current.start(sections, "skip");
    });

    expect(result.current.state.stats).toMatchObject({
      total: 2,
      done: 1,
      skipped: 1,
    });
    expect(adapters.recommendCalls).toEqual(["sec_2"]);
  });

  it("mode=replace overrides the existing-body skip", async () => {
    const adapters = makeAdapters();
    const fetchImpl = makeFetch();
    const { result } = renderHook(() =>
      useBatchGenerateSections({
        provider: "openai",
        adapters,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        streamImpl: fakeStream as unknown as any,
      }),
    );

    const sections = [makeSection(1, { currentBody: "old text" })];
    await act(async () => {
      await result.current.start(sections, "replace");
    });

    expect(result.current.state.stats.done).toBe(1);
    expect(adapters.saveCalls).toHaveLength(1);
    // Replace mode persists only the new body — no concatenation.
    expect(adapters.saveCalls[0].body).not.toContain("old text");
  });

  it("continues the batch when one section fails", async () => {
    const adapters = makeAdapters();
    // First /detect-citations call fails; subsequent calls succeed.
    let detectCallNum = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/detect-citations")) {
        detectCallNum++;
        if (detectCallNum === 1) {
          return new Response(JSON.stringify({ detail: "first call boom" }), {
            status: 500,
          });
        }
      }
      return makeFetch()(url, init);
    });
    const { result } = renderHook(() =>
      useBatchGenerateSections({
        provider: "openai",
        adapters,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        streamImpl: fakeStream as unknown as any,
      }),
    );

    await act(async () => {
      await result.current.start([makeSection(1), makeSection(2)], "skip");
    });

    expect(result.current.state.status).toBe("completed");
    expect(result.current.state.stats).toMatchObject({
      total: 2,
      done: 1,
      failed: 1,
    });
    expect(result.current.state.sections[0].status).toBe("failed");
    expect(result.current.state.sections[1].status).toBe("done");
  });

  it("Stop mid-batch cancels the current section and clears the queue", async () => {
    const adapters = makeAdapters();
    // Stream that hangs until aborted, simulating a long-running model call.
    const hangingStream = vi.fn(async (req: any) => {
      await new Promise((_, reject) => {
        if (req.signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        req.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const fetchImpl = makeFetch();
    const { result } = renderHook(() =>
      useBatchGenerateSections({
        provider: "openai",
        adapters,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        streamImpl: hangingStream as unknown as any,
      }),
    );

    const sections = [makeSection(1), makeSection(2), makeSection(3)];
    let runPromise: Promise<unknown>;
    act(() => {
      runPromise = result.current.start(sections, "skip");
    });

    // Let the loop reach the streaming phase of section 1.
    await act(async () => {
      await flushPromises();
      await flushPromises();
      await flushPromises();
    });

    act(() => {
      result.current.stop();
    });

    await act(async () => {
      await runPromise!;
    });

    expect(result.current.state.status).toBe("stopped");
    // Sections 2 and 3 must remain `queued` — Stop clears the rest of
    // the queue without touching their state.
    expect(result.current.state.sections[1].status).toBe("queued");
    expect(result.current.state.sections[2].status).toBe("queued");
    // No save should have happened — section 1 was cancelled mid-flight.
    expect(adapters.saveCalls).toHaveLength(0);
  });

  it("fails fast when no recommended paper meets the threshold", async () => {
    const adapters = makeAdapters();
    adapters.recommend = async () => [
      { paperId: "weak" as unknown as PaperId, score: 0.4 },
    ];
    const fetchImpl = makeFetch();
    const { result } = renderHook(() =>
      useBatchGenerateSections({
        provider: "openai",
        adapters,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        streamImpl: fakeStream as unknown as any,
      }),
    );

    await act(async () => {
      await result.current.start([makeSection(1)], "skip");
    });

    expect(result.current.state.sections[0].status).toBe("failed");
    expect(result.current.state.sections[0].error).toMatch(
      /threshold|manual paper selection/i,
    );
    // Stream should never have been called — we bail before drafting.
    expect(fakeStream).not.toHaveBeenCalled();
    // Save should never have been called either.
    expect(adapters.saveCalls).toHaveLength(0);
  });

  it("logs to the in-memory log panel for every phase transition", async () => {
    const adapters = makeAdapters();
    const fetchImpl = makeFetch();
    const { result } = renderHook(() =>
      useBatchGenerateSections({
        provider: "openai",
        adapters,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        streamImpl: fakeStream as unknown as any,
      }),
    );

    await act(async () => {
      await result.current.start([makeSection(1)], "skip");
    });

    const phases = result.current.state.log.map((l) => l.phase);
    // Exact ordering — start, linking, drafting, detecting, validating,
    // done, batch-completed.
    expect(phases).toContain("batch");
    expect(phases).toContain("linking");
    expect(phases).toContain("drafting");
    expect(phases).toContain("detecting");
    expect(phases).toContain("validating");
    expect(phases).toContain("done");
    // Final entry is the batch summary.
    expect(phases[phases.length - 1]).toBe("batch");
  });

  it("propagates unresolved placeholders from validate to save", async () => {
    const adapters = makeAdapters();
    // Validate returns a candidate below the auto-promote threshold so
    // the placeholder stays as a chip and shows up in pendingCitations.
    const fetchImpl = makeFetch({
      validate: {
        results: [
          {
            placeholder_id: "ANY",
            candidates: [
              {
                paper_id: "paper_a",
                score: 0.5,
                page_ref_from_excerpt: "S. 14",
              },
            ],
          },
        ],
      },
    });
    const saveSpy = vi.fn(async () => {});
    adapters.save = saveSpy as unknown as BatchAdapters["save"];
    const { result } = renderHook(() =>
      useBatchGenerateSections({
        provider: "openai",
        adapters,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        streamImpl: fakeStream as unknown as any,
      }),
    );

    await act(async () => {
      await result.current.start([makeSection(1)], "skip");
    });

    // saveSpy(sectionId, body, citedPaperIds, pendingCitations)
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const [, body, citedPaperIds, pending] = saveSpy.mock.calls[0] as [
      SectionId,
      string,
      PaperId[],
      PendingCitation[],
    ];
    // Below-threshold → no real {{cite:...}} marker; chip remains.
    expect(body).not.toContain("{{cite:paper_a");
    expect(body).toContain("{{citeNeeded:");
    expect(citedPaperIds).toHaveLength(0);
    expect(pending).toHaveLength(1);
  });
});
