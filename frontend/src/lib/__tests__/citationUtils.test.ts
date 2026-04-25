/// Baseline tests for citation utility functions.
/// Ensures existing parsing, footnote building, and placeholder logic
/// remains correct as we add formula and figure marker support.
import { describe, it, expect } from "vitest";
import {
  parseCitations,
  extractCitationIds,
  insertCitationMarker,
  buildFootnotes,
  renderFootnoteText,
  generateKuerzel,
  replaceCitationsWithPlaceholders,
  restorePlaceholders,
  stripCitationMarkers,
  getAtTriggerContext,
} from "../citationUtils";
import type { FootnoteEntry } from "../types";

// ── parseCitations ──────────────────────────────────────────────────

describe("parseCitations", () => {
  it("parses a primary direct citation", () => {
    const body = "Text {{cite:abc123::direct::S. 42}} more text.";
    const result = parseCitations(body);
    expect(result).toHaveLength(1);
    expect(result[0].paperId).toBe("abc123");
    expect(result[0].citationType).toBe("direct");
    expect(result[0].pageRef).toBe("S. 42");
    expect(result[0].secondaryPaperId).toBeUndefined();
  });

  it("parses a primary indirect citation", () => {
    const body = "{{cite:def456::indirect::S. 3-5}}";
    const result = parseCitations(body);
    expect(result).toHaveLength(1);
    expect(result[0].citationType).toBe("indirect");
    expect(result[0].pageRef).toBe("S. 3-5");
  });

  it("parses a secondary source citation", () => {
    const body = "{{cite:abc::direct::S. 185::via:def::S. 149}}";
    const result = parseCitations(body);
    expect(result).toHaveLength(1);
    expect(result[0].paperId).toBe("abc");
    expect(result[0].pageRef).toBe("S. 185");
    expect(result[0].secondaryPaperId).toBe("def");
    expect(result[0].secondaryPageRef).toBe("S. 149");
  });

  it("parses multiple citations in order", () => {
    const body =
      "A {{cite:p1::direct::S. 1}} B {{cite:p2::indirect::S. 2}} C";
    const result = parseCitations(body);
    expect(result).toHaveLength(2);
    expect(result[0].paperId).toBe("p1");
    expect(result[1].paperId).toBe("p2");
  });

  it("returns empty array for text with no citations", () => {
    expect(parseCitations("No citations here.")).toHaveLength(0);
  });
});

// ── extractCitationIds ──────────────────────────────────────────────

describe("extractCitationIds", () => {
  it("extracts unique paper IDs including secondary sources", () => {
    const body =
      "{{cite:p1::direct::S. 1}} {{cite:p2::indirect::S. 2::via:p3::S. 3}} {{cite:p1::direct::S. 4}}";
    const ids = extractCitationIds(body);
    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
    expect(ids).toContain("p3");
    // p1 appears twice but should be deduplicated
    expect(ids.filter((id) => id === "p1")).toHaveLength(1);
  });

  it("returns empty array for text without citations", () => {
    expect(extractCitationIds("plain text")).toEqual([]);
  });
});

// ── insertCitationMarker ────────────────────────────────────────────

describe("insertCitationMarker", () => {
  it("inserts a primary citation marker at cursor position", () => {
    const body = "Hello @world";
    const { newBody, newCursorPos } = insertCitationMarker(
      body, 6, 12, "paper1", "indirect", "S. 42"
    );
    expect(newBody).toBe("Hello {{cite:paper1::indirect::S. 42}}");
    expect(newCursorPos).toBe(newBody.length);
  });

  it("inserts a secondary citation marker", () => {
    const body = "Text @";
    const { newBody } = insertCitationMarker(
      body, 5, 6, "p1", "direct", "S. 10", "p2", "S. 20"
    );
    expect(newBody).toBe(
      "Text {{cite:p1::direct::S. 10::via:p2::S. 20}}"
    );
  });
});

// ── buildFootnotes + renderFootnoteText ─────────────────────────────

describe("buildFootnotes", () => {
  it("builds numbered footnotes with Kürzel lookup", () => {
    const body =
      "A{{cite:p1::indirect::S. 3}}B{{cite:p2::direct::S. 141}}";
    const sourceMap = new Map<string, any>([
      ["p1", { kuerzel: "KR09" }],
      ["p2", { kuerzel: "MU23" }],
    ]);

    const footnotes = buildFootnotes(body, sourceMap);
    expect(footnotes).toHaveLength(2);
    expect(footnotes[0].number).toBe(1);
    expect(footnotes[0].kuerzel).toBe("KR09");
    expect(footnotes[1].number).toBe(2);
    expect(footnotes[1].kuerzel).toBe("MU23");
  });

  it("uses ?? for missing sources", () => {
    const body = "{{cite:unknown::direct::S. 1}}";
    const footnotes = buildFootnotes(body, new Map());
    expect(footnotes[0].kuerzel).toBe("??");
  });
});

describe("renderFootnoteText", () => {
  it("renders indirect citation with Vgl. prefix", () => {
    const entry: FootnoteEntry = {
      number: 1,
      kuerzel: "KR09",
      pageRef: "S. 3",
      citationType: "indirect",
      paperId: "p1",
    };
    expect(renderFootnoteText(entry)).toBe("Vgl. KR09, S. 3.");
  });

  it("renders direct citation without prefix", () => {
    const entry: FootnoteEntry = {
      number: 1,
      kuerzel: "MU23",
      pageRef: "S. 141",
      citationType: "direct",
      paperId: "p1",
    };
    expect(renderFootnoteText(entry)).toBe("MU23, S. 141.");
  });

  it("renders secondary source citation", () => {
    const entry: FootnoteEntry = {
      number: 1,
      kuerzel: "BE94",
      pageRef: "S. 185",
      citationType: "direct",
      paperId: "p1",
      secondaryKuerzel: "FR11",
      secondaryPageRef: "S. 149",
    };
    expect(renderFootnoteText(entry)).toBe(
      "BE94, S. 185 zitiert nach FR11, S. 149."
    );
  });
});

// ── generateKuerzel ─────────────────────────────────────────────────

describe("generateKuerzel", () => {
  it("generates Kürzel for single author", () => {
    expect(generateKuerzel(["Max Krämer"], 2009)).toBe("KR09");
  });

  it("generates Kürzel for two authors", () => {
    expect(generateKuerzel(["Anna Müller", "Bob Schmidt"], 2023)).toBe("MS23");
  });

  it("handles no authors", () => {
    expect(generateKuerzel([], 2020)).toBe("XX20");
  });

  it("handles missing year", () => {
    expect(generateKuerzel(["Jane Doe"])).toBe("DO");
  });
});

// ── Placeholder round-trip ──────────────────────────────────────────

describe("replaceCitationsWithPlaceholders / restorePlaceholders", () => {
  it("round-trips citations through placeholder replacement", () => {
    const original =
      "Before {{cite:p1::indirect::S. 5}} middle {{cite:p2::direct::S. 10}} after";
    const { cleaned, placeholders } =
      replaceCitationsWithPlaceholders(original);

    expect(cleaned).toContain("[REF1]");
    expect(cleaned).toContain("[REF2]");
    expect(cleaned).not.toContain("{{cite:");

    const { restoredText, missingRefs } = restorePlaceholders(
      cleaned,
      placeholders
    );
    expect(restoredText).toBe(original);
    expect(missingRefs).toHaveLength(0);
  });

  it("deduplicates identical citation markers", () => {
    const body =
      "{{cite:p1::direct::S. 1}} and again {{cite:p1::direct::S. 1}}";
    const { cleaned, placeholders } =
      replaceCitationsWithPlaceholders(body);
    // Both should map to the same REF
    expect(placeholders.size).toBe(1);
    expect(cleaned.match(/\[REF1\]/g)).toHaveLength(2);
  });

  it("reports missing refs when AI drops a citation", () => {
    const { placeholders } = replaceCitationsWithPlaceholders(
      "{{cite:p1::direct::S. 1}}"
    );
    // Simulate AI returning text without the placeholder
    const { missingRefs } = restorePlaceholders("AI dropped it", placeholders);
    expect(missingRefs).toContain("[REF1]");
  });
});

// ── stripCitationMarkers ────────────────────────────────────────────

describe("stripCitationMarkers", () => {
  it("removes all citation markers from text", () => {
    const body =
      "Before {{cite:p1::direct::S. 1}} after {{cite:p2::indirect::S. 2}} end";
    expect(stripCitationMarkers(body)).toBe("Before  after  end");
  });
});

// ── getAtTriggerContext ─────────────────────────────────────────────

describe("getAtTriggerContext", () => {
  it("detects @ trigger at start of text", () => {
    const result = getAtTriggerContext("@query", 6);
    expect(result).toEqual({ query: "query", startPos: 0 });
  });

  it("detects @ after whitespace", () => {
    const result = getAtTriggerContext("text @kr", 8);
    expect(result).toEqual({ query: "kr", startPos: 5 });
  });

  it("returns null when @ is mid-word", () => {
    const result = getAtTriggerContext("email@test", 10);
    expect(result).toBeNull();
  });

  it("returns null when cursor is before @", () => {
    const result = getAtTriggerContext("text @query", 3);
    expect(result).toBeNull();
  });
});
