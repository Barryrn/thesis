/// Tests for formula parsing, insertion, and placeholder round-tripping.
import { describe, it, expect } from "vitest";
import {
  parseFormulas,
  extractFormulasForPreview,
  insertFormulaMarker,
  replaceFormulasWithPlaceholders,
  restoreFormulaPlaceholders,
} from "../formulaUtils";

// ── parseFormulas ───────────────────────────────────────────────────

describe("parseFormulas", () => {
  it("parses an inline formula $x^2$", () => {
    const result = parseFormulas("The value $x^2$ is positive.");
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("x^2");
    expect(result[0].displayMode).toBe(false);
  });

  it("parses a display formula $$\\sum_{i=0}^{n} x_i$$", () => {
    const body = "Result:\n$$\\sum_{i=0}^{n} x_i$$\nEnd.";
    const result = parseFormulas(body);
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("\\sum_{i=0}^{n} x_i");
    expect(result[0].displayMode).toBe(true);
  });

  it("parses both inline and display formulas in correct order", () => {
    const body = "Inline $a+b$ then $$c+d$$ display.";
    const result = parseFormulas(body);
    expect(result).toHaveLength(2);
    expect(result[0].latex).toBe("a+b");
    expect(result[0].displayMode).toBe(false);
    expect(result[1].latex).toBe("c+d");
    expect(result[1].displayMode).toBe(true);
  });

  it("does not match currency-like $ with space after opening", () => {
    const result = parseFormulas("The cost is $ 50 per item.");
    expect(result).toHaveLength(0);
  });

  it("does not match standalone $$ without content", () => {
    const result = parseFormulas("$$$$");
    expect(result).toHaveLength(0);
  });

  it("handles formulas adjacent to citation markers", () => {
    const body = "{{cite:p1::direct::S. 1}} and $\\alpha$";
    const result = parseFormulas(body);
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("\\alpha");
  });

  it("returns empty array for text with no formulas", () => {
    expect(parseFormulas("No formulas here.")).toHaveLength(0);
  });

  it("handles single character inline formula", () => {
    const result = parseFormulas("Variable $x$ is used.");
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("x");
  });
});

// ── extractFormulasForPreview ────────────────────────────────────────

describe("extractFormulasForPreview", () => {
  it("returns numbered formula entries", () => {
    const body = "Inline $a$ display $$b$$";
    const entries = extractFormulasForPreview(body);
    expect(entries).toHaveLength(2);
    expect(entries[0].index).toBe(1);
    expect(entries[0].latex).toBe("a");
    expect(entries[1].index).toBe(2);
    expect(entries[1].latex).toBe("b");
  });
});

// ── insertFormulaMarker ─────────────────────────────────────────────

describe("insertFormulaMarker", () => {
  it("inserts a display formula at cursor position", () => {
    const { newBody, newCursorPos } = insertFormulaMarker(
      "Hello world", 5, "E=mc^2", true
    );
    expect(newBody).toBe("Hello$$E=mc^2$$ world");
    expect(newCursorPos).toBe(5 + "$$E=mc^2$$".length);
  });

  it("inserts an inline formula at cursor position", () => {
    const { newBody } = insertFormulaMarker("text here", 4, "x", false);
    expect(newBody).toBe("text$x$ here");
  });
});

// ── Placeholder round-trip ──────────────────────────────────────────

describe("replaceFormulasWithPlaceholders / restoreFormulaPlaceholders", () => {
  it("round-trips formulas through placeholder replacement", () => {
    const original = "Before $\\alpha$ middle $$\\frac{a}{b}$$ after";
    const { cleaned, placeholders } = replaceFormulasWithPlaceholders(original);

    expect(cleaned).toContain("[MATH1]");
    expect(cleaned).toContain("[MATH2]");
    expect(cleaned).not.toContain("$\\alpha$");
    expect(cleaned).not.toContain("$$\\frac");

    const { restored, missing } = restoreFormulaPlaceholders(
      cleaned,
      placeholders
    );
    expect(restored).toBe(original);
    expect(missing).toHaveLength(0);
  });

  it("reports missing placeholders when AI drops a formula", () => {
    const { placeholders } = replaceFormulasWithPlaceholders("$x^2$");
    const { missing } = restoreFormulaPlaceholders("AI dropped it", placeholders);
    expect(missing).toContain("[MATH1]");
  });

  it("handles mixed citations and formulas independently", () => {
    // Formulas and citations use different placeholder domains ([MATH] vs [REF])
    const text = "Text $a$ and {{cite:p1::direct::S. 1}}";
    const { cleaned, placeholders } = replaceFormulasWithPlaceholders(text);
    // Citations should be left untouched by formula replacement
    expect(cleaned).toContain("{{cite:p1::direct::S. 1}}");
    expect(cleaned).toContain("[MATH1]");
    expect(placeholders.size).toBe(1);
  });
});
