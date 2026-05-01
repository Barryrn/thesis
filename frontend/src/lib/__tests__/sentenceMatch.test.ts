/// Tests for the three-tier sentence locator used by /detect-citations.
import { describe, it, expect } from "vitest";
import { findSentenceEnd } from "../sentenceMatch";

describe("findSentenceEnd — tier 1 exact", () => {
  it("returns insertion offset just past the matching sentence", () => {
    const body = "First sentence. Recent surveys report a 23% drop. Tail.";
    const claim = "Recent surveys report a 23% drop.";
    const result = findSentenceEnd(body, claim);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("exact");
    // Insertion point lands directly after the period — the trailing space
    // before "Tail" stays outside the marker.
    const offset = result!.insertionOffset;
    expect(body.slice(0, offset)).toBe(
      "First sentence. Recent surveys report a 23% drop."
    );
    expect(body[offset]).toBe(" ");
  });

  it("matches a claim at the very end of the body", () => {
    const body = "Intro. Final claim about X.";
    const result = findSentenceEnd(body, "Final claim about X.");
    expect(result?.tier).toBe("exact");
    expect(result?.insertionOffset).toBe(body.length);
  });
});

describe("findSentenceEnd — tier 2 normalized whitespace", () => {
  it("matches when the body has runs of extra whitespace", () => {
    const body =
      "Intro. The   model   produced  good   results.  Done.";
    const claim = "The model produced good results.";
    const result = findSentenceEnd(body, claim);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("normalized");
    // Result should land after "results." but before the trailing spaces.
    const offset = result!.insertionOffset;
    expect(body.slice(offset, offset + 1)).toBe(" ");
    expect(body.slice(0, offset).endsWith("results.")).toBe(true);
  });

  it("matches when the body wraps the claim onto a new line", () => {
    const body = "Intro.\n\nThe model produced\ngood results. Done.";
    const claim = "The model produced good results.";
    const result = findSentenceEnd(body, claim);
    expect(result?.tier).toBe("normalized");
    const offset = result!.insertionOffset;
    expect(body.slice(0, offset).endsWith("results.")).toBe(true);
  });
});

describe("findSentenceEnd — tier 3 fuzzy Jaccard", () => {
  it("falls back to fuzzy match when claim was lightly paraphrased", () => {
    // Body sentence has the same tokens as the claim plus one extra ("notable")
    // — Jaccard ≈ 0.91, well above the 0.6 floor.
    const body =
      "Recent surveys reported a notable 23 percent drop in the population. "
      + "Other findings exist.";
    const claim = "Recent surveys reported a 23 percent drop in the population.";
    const result = findSentenceEnd(body, claim);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("fuzzy");
    const offset = result!.insertionOffset;
    expect(body.slice(0, offset).endsWith("population.")).toBe(true);
  });

  it("returns null when no sentence clears the Jaccard threshold", () => {
    const body = "The cat sat on the mat. Apples are fruit.";
    const claim = "Quantum chromodynamics predicts confinement of quarks.";
    expect(findSentenceEnd(body, claim)).toBeNull();
  });
});

describe("findSentenceEnd — German abbreviations", () => {
  it("does not split a sentence on 'Müller, S. 12.'", () => {
    // The boundary regex requires whitespace + capital letter after `.`,
    // so internal abbreviations like "S. 12" don't terminate the sentence.
    const body =
      "Empirische Studien (vgl. Müller, S. 12) zeigen eine Verbesserung. "
      + "Weiterführend gilt: andere Effekte sind bekannt.";
    const claim =
      "Empirische Studien (vgl. Müller, S. 12) zeigen eine Verbesserung.";
    const result = findSentenceEnd(body, claim);
    expect(result?.tier).toBe("exact");
    const offset = result!.insertionOffset;
    expect(body.slice(0, offset).endsWith("Verbesserung.")).toBe(true);
  });
});

describe("findSentenceEnd — edge cases", () => {
  it("returns null on an empty claim", () => {
    expect(findSentenceEnd("any body text", "")).toBeNull();
  });

  it("returns null on whitespace-only claim", () => {
    expect(findSentenceEnd("any body text", "   \n  ")).toBeNull();
  });

  it("handles a body identical to the claim", () => {
    const body = "Single claim sentence.";
    const result = findSentenceEnd(body, "Single claim sentence.");
    expect(result?.tier).toBe("exact");
    expect(result?.insertionOffset).toBe(body.length);
  });
});
