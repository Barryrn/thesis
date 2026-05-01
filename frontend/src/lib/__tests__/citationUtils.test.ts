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
  parsePendingCitations,
  extractPendingPlaceholderIds,
  replacePendingMarker,
  stripAllPendingMarkers,
  generatePlaceholderId,
  encodeReason,
  decodeReason,
  buildPendingMarker,
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

// ── Pending placeholder isolation ───────────────────────────────────
//
// Critical regression guard: the resolved-citation regexes use a
// `cite:(?!Needed)` lookahead so that `{{citeNeeded:...}}` is never matched
// as a real citation. A misclassification would let a footnote slip into the
// reading flow before the user has resolved it.

describe("citeNeeded isolation", () => {
  it("parseCitations ignores pending placeholders", () => {
    const body =
      "Claim {{citeNeeded:abc12345::Needs%20support}} continues here.";
    expect(parseCitations(body)).toHaveLength(0);
  });

  it("extractCitationIds ignores pending placeholders", () => {
    const body =
      "{{citeNeeded:abc12345::Reason}} {{cite:p1::direct::S. 1}}";
    expect(extractCitationIds(body)).toEqual(["p1"]);
  });

  it("stripCitationMarkers removes both resolved and pending markers", () => {
    const body =
      "A {{cite:p1::direct::S. 1}} B {{citeNeeded:abc12345::why}} C";
    expect(stripCitationMarkers(body)).toBe("A  B  C");
  });

  it("replaceCitationsWithPlaceholders namespaces pending placeholders as REFCN", () => {
    const original =
      "{{cite:p1::direct::S. 1}} mix {{citeNeeded:abc12345::Reason}}";
    const { cleaned, placeholders } =
      replaceCitationsWithPlaceholders(original);

    expect(cleaned).toContain("[REF1]");
    expect(cleaned).toContain("[REFCN1]");
    expect(cleaned).not.toContain("{{cite");

    const { restoredText, missingRefs } = restorePlaceholders(
      cleaned,
      placeholders
    );
    expect(restoredText).toBe(original);
    expect(missingRefs).toHaveLength(0);
  });
});

// ── parsePendingCitations / extractPendingPlaceholderIds ────────────

describe("parsePendingCitations", () => {
  it("returns id and decoded reason in document order", () => {
    const body =
      "First {{citeNeeded:aaaa1111::Empirical%20claim}} then " +
      "{{citeNeeded:bbbb2222::Theoretical%20ref}} end.";
    const result = parsePendingCitations(body);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "aaaa1111",
      reason: "Empirical claim",
    });
    expect(result[1]).toMatchObject({
      id: "bbbb2222",
      reason: "Theoretical ref",
    });
  });

  it("falls back to encoded form when reason is malformed", () => {
    // A stray `%` not followed by a hex pair makes decodeURIComponent throw.
    const body = "{{citeNeeded:abc12345::bad%ZZreason}}";
    const result = parsePendingCitations(body);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("bad%ZZreason");
  });

  it("survives an empty reason segment", () => {
    const body = "{{citeNeeded:abc12345::}}";
    const result = parsePendingCitations(body);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("abc12345");
    expect(result[0].reason).toBe("");
  });
});

describe("extractPendingPlaceholderIds", () => {
  it("returns ids in document order", () => {
    const body =
      "{{citeNeeded:aaaa1111::r}} text {{citeNeeded:bbbb2222::r}}";
    expect(extractPendingPlaceholderIds(body)).toEqual([
      "aaaa1111",
      "bbbb2222",
    ]);
  });

  it("returns empty for body without pending markers", () => {
    expect(
      extractPendingPlaceholderIds("plain prose {{cite:p1::direct::S. 1}}")
    ).toEqual([]);
  });
});

// ── replacePendingMarker / stripAllPendingMarkers ───────────────────

describe("replacePendingMarker", () => {
  it("replaces only the targeted placeholder", () => {
    const body =
      "{{citeNeeded:aaaa1111::r1}} and {{citeNeeded:bbbb2222::r2}}";
    const result = replacePendingMarker(
      body,
      "aaaa1111",
      "{{cite:p1::indirect::S. 5}}"
    );
    expect(result).toBe(
      "{{cite:p1::indirect::S. 5}} and {{citeNeeded:bbbb2222::r2}}"
    );
  });

  it("returns body unchanged when id is missing", () => {
    const body = "{{citeNeeded:aaaa1111::r}}";
    expect(replacePendingMarker(body, "missing0", "X")).toBe(body);
  });
});

describe("stripAllPendingMarkers", () => {
  it("strips pending markers and leaves resolved citations intact", () => {
    const body =
      "Before {{citeNeeded:aaaa1111::r}} mid {{cite:p1::direct::S. 1}} end";
    expect(stripAllPendingMarkers(body)).toBe(
      "Before  mid {{cite:p1::direct::S. 1}} end"
    );
  });

  it("is a no-op when there are no pending markers", () => {
    const body = "Plain {{cite:p1::direct::S. 1}}";
    expect(stripAllPendingMarkers(body)).toBe(body);
  });
});

// ── generatePlaceholderId / encode / decode / buildPendingMarker ────

describe("generatePlaceholderId", () => {
  it("returns 8-char lowercase alphanumeric ids", () => {
    for (let i = 0; i < 5; i++) {
      const id = generatePlaceholderId();
      expect(id).toMatch(/^[a-z0-9]{8}$/);
    }
  });

  it("produces distinct ids across rapid calls", () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => generatePlaceholderId())
    );
    // Allow a single collision in 100 draws — extraordinarily unlikely with
    // a 48-bit source, but keeps the test from flaking on the cosmic case.
    expect(ids.size).toBeGreaterThanOrEqual(99);
  });
});

describe("encodeReason / decodeReason", () => {
  it("round-trips German umlauts and spaces", () => {
    const raw = "Empirische Aussage über Müller und Schäfer";
    expect(decodeReason(encodeReason(raw))).toBe(raw);
  });

  it("round-trips reserved characters that would break the marker", () => {
    const raw = "Reason with :: and }} and { plus % sign";
    const encoded = encodeReason(raw);
    expect(encoded).not.toContain(":");
    expect(encoded).not.toContain("}");
    expect(decodeReason(encoded)).toBe(raw);
  });

  it("caps encoded length at 240 characters", () => {
    const raw = "x".repeat(1000);
    const encoded = encodeReason(raw);
    expect(encoded.length).toBeLessThanOrEqual(240);
  });
});

describe("buildPendingMarker", () => {
  it("builds a marker that round-trips through parsePendingCitations", () => {
    const marker = buildPendingMarker("abc12345", "Why does this need a cite?");
    const result = parsePendingCitations(`prefix ${marker} suffix`);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("abc12345");
    expect(result[0].reason).toBe("Why does this need a cite?");
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
