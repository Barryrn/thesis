/// Utilities for parsing, inserting, and placeholder-swapping LaTeX formulas
/// stored inline in section body text as `$...$` (inline) or `$$...$$` (display).

// ── Types ────────────────────────────────────────────────────────────

export interface ParsedFormula {
  fullMatch: string;
  latex: string;
  displayMode: boolean;
  startIndex: number;
  endIndex: number;
}

export interface FormulaPreviewEntry {
  index: number;
  latex: string;
  displayMode: boolean;
}

// ── Regex ────────────────────────────────────────────────────────────

/// Matches display math `$$...$$` (non-greedy, must have content).
const DISPLAY_MATH_REGEX = /\$\$([^$]+?)\$\$/g;

/// Matches inline math `$...$` (non-greedy, no space after opening $
/// or before closing $ — avoids false positives with currency like "$5").
/// Negative lookbehind/lookahead ensures we don't match inside `$$...$$`.
const INLINE_MATH_REGEX = /(?<!\$)\$(?!\$)(\S[^$]*?\S|\S)\$(?!\$)/g;

// ── Parsing ──────────────────────────────────────────────────────────

/// Extracts all formulas from body text in order of appearance.
/// Display formulas (`$$...$$`) are parsed first, then inline (`$...$`),
/// then merged and sorted by position.
export function parseFormulas(body: string): ParsedFormula[] {
  const results: ParsedFormula[] = [];

  // 1. Find display math
  let match: RegExpExecArray | null;
  const displayRe = new RegExp(DISPLAY_MATH_REGEX.source, "g");
  while ((match = displayRe.exec(body)) !== null) {
    results.push({
      fullMatch: match[0],
      latex: match[1],
      displayMode: true,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  // 2. Find inline math, skipping positions already covered by display math
  const inlineRe = new RegExp(INLINE_MATH_REGEX.source, "g");
  while ((match = inlineRe.exec(body)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    // Skip if this range overlaps with any display math
    const overlaps = results.some(
      (r) => r.displayMode && start >= r.startIndex && end <= r.endIndex
    );
    if (!overlaps) {
      results.push({
        fullMatch: match[0],
        latex: match[1],
        displayMode: false,
        startIndex: start,
        endIndex: end,
      });
    }
  }

  // Sort by position in text
  results.sort((a, b) => a.startIndex - b.startIndex);
  return results;
}

/// Returns a numbered list of formulas for the preview strip.
export function extractFormulasForPreview(body: string): FormulaPreviewEntry[] {
  return parseFormulas(body).map((f, i) => ({
    index: i + 1,
    latex: f.latex,
    displayMode: f.displayMode,
  }));
}

// ── Insertion ────────────────────────────────────────────────────────

/// Inserts a formula at the cursor position.
/// Returns the updated body and new cursor position (between the delimiters).
export function insertFormulaMarker(
  body: string,
  cursorPos: number,
  latex: string,
  displayMode: boolean
): { newBody: string; newCursorPos: number } {
  const delimiter = displayMode ? "$$" : "$";
  const marker = `${delimiter}${latex}${delimiter}`;
  const before = body.slice(0, cursorPos);
  const after = body.slice(cursorPos);
  const newBody = before + marker + after;
  // Place cursor after the formula
  return { newBody, newCursorPos: cursorPos + marker.length };
}

// ── Placeholder swapping for AI optimize ─────────────────────────────

/// Replaces all formula markers with [MATH1], [MATH2], etc.
/// Used before sending text to the AI optimizer so LaTeX isn't mangled.
export function replaceFormulasWithPlaceholders(text: string): {
  cleaned: string;
  placeholders: Map<string, string>;
} {
  const placeholders = new Map<string, string>();
  const formulas = parseFormulas(text);
  let offset = 0;
  let cleaned = text;

  for (let i = 0; i < formulas.length; i++) {
    const f = formulas[i];
    const ref = `[MATH${i + 1}]`;
    const adjustedStart = f.startIndex + offset;
    const adjustedEnd = f.endIndex + offset;
    cleaned =
      cleaned.slice(0, adjustedStart) + ref + cleaned.slice(adjustedEnd);
    offset += ref.length - f.fullMatch.length;
    placeholders.set(ref, f.fullMatch);
  }

  return { cleaned, placeholders };
}

/// Restores [MATHN] placeholders back to their original formulas.
export function restoreFormulaPlaceholders(
  text: string,
  placeholders: Map<string, string>
): { restored: string; missing: string[] } {
  let restored = text;
  const missing: string[] = [];

  // Restore in reverse numeric order to avoid [MATH1] matching inside [MATH10]
  const entries = [...placeholders.entries()].sort((a, b) => {
    const numA = parseInt(a[0].match(/\d+/)![0], 10);
    const numB = parseInt(b[0].match(/\d+/)![0], 10);
    return numB - numA;
  });

  for (const [ref, original] of entries) {
    if (!restored.includes(ref)) {
      missing.push(ref);
      continue;
    }
    // Use split/join instead of replaceAll to avoid $$ being interpreted
    // as a special replacement pattern in String.prototype.replaceAll.
    restored = restored.split(ref).join(original);
  }

  return { restored, missing };
}
