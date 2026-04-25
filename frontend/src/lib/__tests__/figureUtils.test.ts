/// Tests for figure marker parsing, numbering, and placeholder round-tripping.
import { describe, it, expect } from "vitest";
import {
  parseFigureMarkers,
  insertFigureMarker,
  computeFigureNumbers,
  findOrphanedMarkers,
  replaceFigureMarkersWithPlaceholders,
  restoreFigurePlaceholders,
} from "../figureUtils";

// ── parseFigureMarkers ──────────────────────────────────────────────

describe("parseFigureMarkers", () => {
  it("parses a single figure marker", () => {
    const body = "See {{fig:abc123}} below.";
    const result = parseFigureMarkers(body);
    expect(result).toHaveLength(1);
    expect(result[0].figureId).toBe("abc123");
    expect(result[0].startIndex).toBe(4);
  });

  it("parses multiple figure markers in order", () => {
    const body = "{{fig:fig1}} text {{fig:fig2}} more {{fig:fig3}}";
    const result = parseFigureMarkers(body);
    expect(result).toHaveLength(3);
    expect(result[0].figureId).toBe("fig1");
    expect(result[1].figureId).toBe("fig2");
    expect(result[2].figureId).toBe("fig3");
  });

  it("returns empty array for text without figure markers", () => {
    expect(parseFigureMarkers("No figures here.")).toHaveLength(0);
  });

  it("does not confuse figure markers with citation markers", () => {
    const body = "{{cite:p1::direct::S. 1}} {{fig:f1}}";
    const result = parseFigureMarkers(body);
    expect(result).toHaveLength(1);
    expect(result[0].figureId).toBe("f1");
  });
});

// ── insertFigureMarker ──────────────────────────────────────────────

describe("insertFigureMarker", () => {
  it("inserts a figure marker at cursor position", () => {
    const { newBody, newCursorPos } = insertFigureMarker(
      "Hello world", 5, "fig123"
    );
    expect(newBody).toBe("Hello{{fig:fig123}} world");
    expect(newCursorPos).toBe(5 + "{{fig:fig123}}".length);
  });

  it("inserts at beginning of text", () => {
    const { newBody } = insertFigureMarker("text", 0, "f1");
    expect(newBody).toBe("{{fig:f1}}text");
  });

  it("inserts at end of text", () => {
    const { newBody } = insertFigureMarker("text", 4, "f1");
    expect(newBody).toBe("text{{fig:f1}}");
  });
});

// ── computeFigureNumbers ────────────────────────────────────────────

describe("computeFigureNumbers", () => {
  it("numbers figures sequentially across sections", () => {
    const sections = [
      {
        orderNumber: "1",
        figures: [
          { _id: "a", orderIndex: 0 },
          { _id: "b", orderIndex: 1 },
        ],
      },
      {
        orderNumber: "2",
        figures: [{ _id: "c", orderIndex: 0 }],
      },
    ];

    const numbers = computeFigureNumbers(sections);
    expect(numbers.get("a")).toBe(1);
    expect(numbers.get("b")).toBe(2);
    expect(numbers.get("c")).toBe(3);
  });

  it("sorts sections numerically, not lexicographically", () => {
    const sections = [
      { orderNumber: "2", figures: [{ _id: "x", orderIndex: 0 }] },
      { orderNumber: "1", figures: [{ _id: "y", orderIndex: 0 }] },
      { orderNumber: "10", figures: [{ _id: "z", orderIndex: 0 }] },
    ];

    const numbers = computeFigureNumbers(sections);
    expect(numbers.get("y")).toBe(1); // section 1
    expect(numbers.get("x")).toBe(2); // section 2
    expect(numbers.get("z")).toBe(3); // section 10
  });

  it("handles sections with no figures", () => {
    const sections = [
      { orderNumber: "1", figures: [] },
      { orderNumber: "2", figures: [{ _id: "a", orderIndex: 0 }] },
    ];

    const numbers = computeFigureNumbers(sections);
    expect(numbers.size).toBe(1);
    expect(numbers.get("a")).toBe(1);
  });

  it("handles empty input", () => {
    expect(computeFigureNumbers([]).size).toBe(0);
  });
});

// ── findOrphanedMarkers ─────────────────────────────────────────────

describe("findOrphanedMarkers", () => {
  it("finds markers with no matching figure", () => {
    const body = "{{fig:exists}} {{fig:deleted}}";
    const known = new Set(["exists"]);
    const orphans = findOrphanedMarkers(body, known);
    expect(orphans).toEqual(["deleted"]);
  });

  it("returns empty when all markers match", () => {
    const body = "{{fig:f1}} {{fig:f2}}";
    const known = new Set(["f1", "f2"]);
    expect(findOrphanedMarkers(body, known)).toHaveLength(0);
  });
});

// ── Placeholder round-trip ──────────────────────────────────────────

describe("replaceFigureMarkersWithPlaceholders / restoreFigurePlaceholders", () => {
  it("round-trips figure markers through placeholder replacement", () => {
    const original = "Before {{fig:f1}} middle {{fig:f2}} after";
    const { cleaned, placeholders } =
      replaceFigureMarkersWithPlaceholders(original);

    expect(cleaned).toContain("[FIG1]");
    expect(cleaned).toContain("[FIG2]");
    expect(cleaned).not.toContain("{{fig:");

    const { restored, missing } = restoreFigurePlaceholders(
      cleaned,
      placeholders
    );
    expect(restored).toBe(original);
    expect(missing).toHaveLength(0);
  });

  it("reports missing placeholders when AI drops a figure marker", () => {
    const { placeholders } = replaceFigureMarkersWithPlaceholders("{{fig:f1}}");
    const { missing } = restoreFigurePlaceholders("AI dropped it", placeholders);
    expect(missing).toContain("[FIG1]");
  });

  it("does not affect citation or formula markers", () => {
    const text = "{{cite:p1::direct::S. 1}} $x^2$ {{fig:f1}}";
    const { cleaned, placeholders } =
      replaceFigureMarkersWithPlaceholders(text);
    // Citations and formulas should be untouched
    expect(cleaned).toContain("{{cite:p1::direct::S. 1}}");
    expect(cleaned).toContain("$x^2$");
    expect(cleaned).toContain("[FIG1]");
    expect(placeholders.size).toBe(1);
  });
});
