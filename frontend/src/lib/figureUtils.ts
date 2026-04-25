/// Utilities for parsing, inserting, and numbering figure markers
/// stored inline in section body text as `{{fig:figureId}}`.

// ── Types ────────────────────────────────────────────────────────────

export interface ParsedFigureMarker {
  fullMatch: string;
  figureId: string;
  startIndex: number;
  endIndex: number;
}

export interface FigureNumberInput {
  orderNumber: string;
  figures: { _id: string; orderIndex: number }[];
}

// ── Regex ────────────────────────────────────────────────────────────

/// Matches figure markers in the form {{fig:FIGURE_ID}}.
const FIGURE_MARKER_REGEX = /\{\{fig:([^}]+)\}\}/g;

// ── Parsing ──────────────────────────────────────────────────────────

/// Extracts all figure markers from body text in order of appearance.
export function parseFigureMarkers(body: string): ParsedFigureMarker[] {
  const results: ParsedFigureMarker[] = [];
  const re = new RegExp(FIGURE_MARKER_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = re.exec(body)) !== null) {
    results.push({
      fullMatch: match[0],
      figureId: match[1],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return results;
}

// ── Insertion ────────────────────────────────────────────────────────

/// Inserts a figure marker at the cursor position.
export function insertFigureMarker(
  body: string,
  cursorPos: number,
  figureId: string
): { newBody: string; newCursorPos: number } {
  const marker = `{{fig:${figureId}}}`;
  const before = body.slice(0, cursorPos);
  const after = body.slice(cursorPos);
  const newBody = before + marker + after;
  return { newBody, newCursorPos: cursorPos + marker.length };
}

// ── Numbering ────────────────────────────────────────────────────────

/// Computes global figure numbers across the entire document.
/// Sections are sorted by orderNumber, figures within each section
/// by orderIndex. Returns a map from figureId to sequential number.
export function computeFigureNumbers(
  sections: FigureNumberInput[]
): Map<string, number> {
  const result = new Map<string, number>();
  let counter = 1;

  // Sort sections by orderNumber (lexicographic works for "1", "1.1", "2", etc.)
  const sorted = [...sections].sort((a, b) =>
    a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true })
  );

  for (const section of sorted) {
    // Sort figures within section by orderIndex
    const orderedFigs = [...section.figures].sort(
      (a, b) => a.orderIndex - b.orderIndex
    );
    for (const fig of orderedFigs) {
      result.set(fig._id, counter++);
    }
  }

  return result;
}

// ── Orphan detection ─────────────────────────────────────────────────

/// Finds figure markers in the body whose IDs don't match any known figure.
export function findOrphanedMarkers(
  body: string,
  knownFigureIds: Set<string>
): string[] {
  return parseFigureMarkers(body)
    .filter((m) => !knownFigureIds.has(m.figureId))
    .map((m) => m.figureId);
}

// ── Placeholder swapping for AI optimize ─────────────────────────────

/// Replaces all figure markers with [FIG1], [FIG2], etc.
export function replaceFigureMarkersWithPlaceholders(text: string): {
  cleaned: string;
  placeholders: Map<string, string>;
} {
  const placeholders = new Map<string, string>();
  let counter = 1;

  const cleaned = text.replace(
    new RegExp(FIGURE_MARKER_REGEX.source, "g"),
    (fullMatch) => {
      const ref = `[FIG${counter}]`;
      counter++;
      placeholders.set(ref, fullMatch);
      return ref;
    }
  );

  return { cleaned, placeholders };
}

/// Restores [FIGN] placeholders back to their original {{fig:...}} markers.
export function restoreFigurePlaceholders(
  text: string,
  placeholders: Map<string, string>
): { restored: string; missing: string[] } {
  let restored = text;
  const missing: string[] = [];

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
    restored = restored.split(ref).join(original);
  }

  return { restored, missing };
}
