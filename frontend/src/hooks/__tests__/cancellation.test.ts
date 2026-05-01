/// Cancellation behavior tests for the AI / parsing hooks.
///
/// Each hook owns an AbortController and a synchronous `cancelledRef`.
/// We verify three things per hook:
///   1. Calling `cancel()` while a request is in flight aborts the
///      underlying fetch (signal flips to aborted).
///   2. The hook lands in `cancelled` status — distinct from `error`,
///      with no error message attached.
///   3. `wasCancelled()` reports true synchronously after `cancel()`,
///      so handlers can branch on it before React state has settled.
///
/// We stub `fetch` with a Promise that resolves only when the abort
/// signal fires, so the test deterministically simulates "user clicks
/// Stop while server is still working."

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDetectCitations } from "../useDetectCitations";
import { useTextOptimize } from "../useTextOptimize";
import { useValidateCitations } from "../useValidateCitations";

/// Builds a fake `fetch` that never resolves on its own — instead, the
/// returned cleanup hook fires an AbortError when `signal.abort()` is
/// observed, mirroring how a real fetch behaves under abort.
function makeAbortableFetch() {
  const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
    return new Promise((_, reject) => {
      const signal = init?.signal;
      if (!signal) return; // tests always pass a signal — guard anyway.
      const onAbort = () => {
        const err = new DOMException("Aborted", "AbortError");
        reject(err);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
  });
  return fetchSpy;
}

beforeEach(() => {
  vi.stubGlobal("fetch", makeAbortableFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDetectCitations.cancel", () => {
  it("aborts the in-flight request and lands in `cancelled`", async () => {
    const { result } = renderHook(() =>
      useDetectCitations({ sectionId: "sec_1", provider: "openai" }),
    );

    let runPromise: Promise<unknown>;
    act(() => {
      runPromise = result.current.run("Some prose with claims.");
    });

    // Wait for status to flip into loading before cancelling.
    await waitFor(() => expect(result.current.status).toBe("loading"));

    act(() => {
      result.current.cancel();
    });

    // Synchronous ref reflects cancellation immediately — the awaiting
    // handler relies on this to skip the error toast.
    expect(result.current.wasCancelled()).toBe(true);

    const settled = await runPromise!;
    expect(settled).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("cancelled"));
    expect(result.current.error).toBeNull();
  });
});

describe("useValidateCitations.cancel", () => {
  it("aborts the in-flight request and lands in `cancelled`", async () => {
    const { result } = renderHook(() =>
      useValidateCitations({ sectionId: "sec_1", provider: "openai" }),
    );

    let runPromise: Promise<unknown>;
    act(() => {
      runPromise = result.current.run("body with {{citeNeeded:abc::r}}", [
        {
          id: "abc",
          reason: "r",
          // Validate filters items with no candidates; supply one so it
          // actually fires the request.
          suggestedPaperIds: ["paper_1"] as unknown as never,
        },
      ]);
    });

    await waitFor(() => expect(result.current.status).toBe("loading"));

    act(() => {
      result.current.cancel();
    });

    expect(result.current.wasCancelled()).toBe(true);

    const settled = await runPromise!;
    expect(settled).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("cancelled"));
    expect(result.current.error).toBeNull();
  });
});

describe("useTextOptimize.cancelOptimize", () => {
  it("aborts the in-flight request and lands in `cancelled`", async () => {
    const body = "Once upon a time.";
    const { result } = renderHook(() => useTextOptimize(body, "en", "openai"));

    act(() => {
      // Selection covers the full body so the hook actually fires the
      // request (it short-circuits on empty selections).
      void result.current.requestOptimize("enhance", 0, body.length);
    });

    await waitFor(() => expect(result.current.state.status).toBe("loading"));

    act(() => {
      result.current.cancelOptimize();
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe("cancelled"),
    );
    expect(result.current.state.error).toBeNull();
  });
});
