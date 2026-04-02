import type { PaperId } from "./types";

/// Regex matching {{cite:PAPER_ID::Label}} markers in body text.
const CITE_REGEX = /\{\{cite:([^:]+)::([^}]+)\}\}/g;

/// Extracts unique paper IDs from all citation markers in the body.
export function extractCitationIds(body: string): PaperId[] {
  const ids = new Set<string>();
  let match;
  const re = new RegExp(CITE_REGEX.source, "g");
  while ((match = re.exec(body)) !== null) {
    ids.add(match[1]);
  }
  return [...ids] as PaperId[];
}

/// Replaces the @query text at cursorPos with a citation marker.
/// Returns the updated body string and new cursor position.
export function insertCitationMarker(
  body: string,
  atStartPos: number,
  cursorPos: number,
  paperId: string,
  label: string
): { newBody: string; newCursorPos: number } {
  const marker = `{{cite:${paperId}::${label}}}`;
  const before = body.slice(0, atStartPos);
  const after = body.slice(cursorPos);
  const newBody = before + marker + after;
  return { newBody, newCursorPos: before.length + marker.length };
}

/// Replaces citation markers with APA-style (Author, Year) text.
export function renderCitationsApa(
  body: string,
  paperMap: Map<string, { authors: string[]; year?: number }>
): string {
  return body.replace(
    new RegExp(CITE_REGEX.source, "g"),
    (_match, paperId: string, fallbackLabel: string) => {
      const paper = paperMap.get(paperId);
      if (!paper) return `(${fallbackLabel})`;

      const authorPart = formatAuthorsApa(paper.authors);
      const yearPart = paper.year ? `, ${paper.year}` : "";
      return `(${authorPart}${yearPart})`;
    }
  );
}

/// Replaces citation markers with IEEE-style [N] references.
/// orderMap maps paperId to its sequential citation number.
export function renderCitationsIeee(
  body: string,
  orderMap: Map<string, number>
): string {
  return body.replace(
    new RegExp(CITE_REGEX.source, "g"),
    (_match, paperId: string, fallbackLabel: string) => {
      const num = orderMap.get(paperId);
      if (num === undefined) return `[${fallbackLabel}]`;
      return `[${num}]`;
    }
  );
}

/// Builds an IEEE citation order map from body text.
/// Papers are numbered in the order they first appear.
export function buildIeeeOrderMap(body: string): Map<string, number> {
  const order = new Map<string, number>();
  let counter = 1;
  let match;
  const re = new RegExp(CITE_REGEX.source, "g");
  while ((match = re.exec(body)) !== null) {
    const paperId = match[1];
    if (!order.has(paperId)) {
      order.set(paperId, counter++);
    }
  }
  return order;
}

/// Detects whether the cursor is inside an @-trigger and returns context.
/// Returns null if no active trigger.
export function getAtTriggerContext(
  body: string,
  cursorPos: number
): { query: string; startPos: number } | null {
  // Walk backwards from cursor to find @ that starts the trigger
  const textBeforeCursor = body.slice(0, cursorPos);
  const lastAt = textBeforeCursor.lastIndexOf("@");
  if (lastAt === -1) return null;

  // The @ must be at start of input or preceded by whitespace/newline
  if (lastAt > 0 && !/\s/.test(body[lastAt - 1])) return null;

  const query = textBeforeCursor.slice(lastAt + 1);

  // Dismiss if query contains newline (user moved past the trigger)
  if (query.includes("\n")) return null;

  return { query, startPos: lastAt };
}

/// Computes pixel coordinates of a caret position inside a textarea.
/// Uses the mirror-div technique: clones textarea styles into a hidden div
/// and measures the position of a marker span.
export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number
): { top: number; left: number } {
  const div = document.createElement("div");
  const style = getComputedStyle(textarea);

  // Copy relevant styles from textarea to mirror div
  const properties = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "wordSpacing",
    "textIndent",
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderWidth",
    "boxSizing",
    "width",
    "wordWrap",
    "overflowWrap",
    "whiteSpace",
  ] as const;

  for (const prop of properties) {
    (div.style as any)[prop] = style.getPropertyValue(
      prop.replace(/([A-Z])/g, "-$1").toLowerCase()
    );
  }

  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.overflow = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";

  // Insert text content up to the caret, then a marker span
  const textBefore = textarea.value.slice(0, position);
  div.textContent = textBefore;

  const span = document.createElement("span");
  span.textContent = textarea.value.slice(position) || ".";
  div.appendChild(span);

  document.body.appendChild(div);

  const spanRect = span.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();

  // Account for scroll offset
  const top =
    spanRect.top -
    textareaRect.top +
    textarea.scrollTop -
    textarea.scrollTop +
    span.offsetTop;
  const left = span.offsetLeft;

  document.body.removeChild(div);

  return {
    top: span.offsetTop - textarea.scrollTop,
    left: span.offsetLeft,
  };
}

/// Formats an author list for APA-style citations.
function formatAuthorsApa(authors: string[]): string {
  if (authors.length === 0) return "Unknown";
  // Extract surname (last word) from first author
  const surname = extractSurname(authors[0]);
  if (authors.length === 1) return surname;
  if (authors.length === 2) return `${surname} & ${extractSurname(authors[1])}`;
  return `${surname} et al.`;
}

/// Extracts the surname (last word) from a full name string.
function extractSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/// Builds a display label for a paper to use in citation markers.
export function buildCitationLabel(
  authors: string[],
  year?: number
): string {
  const authorPart = formatAuthorsApa(authors);
  return year ? `${authorPart}, ${year}` : authorPart;
}

// ── Optimize-mode placeholder utilities ─────────────────────────────────

/// Replaces all {{cite:ID::Label}} markers with numbered [REF1], [REF2], etc.
/// Returns the cleaned text and a map to restore the original markers later.
/// Used before sending text to the AI optimizer so citations are never mangled.
export function replaceCitationsWithPlaceholders(text: string): {
  cleaned: string;
  placeholders: Map<string, string>;
} {
  const placeholders = new Map<string, string>();
  let counter = 1;
  // Map each unique full marker to a placeholder.
  const markerToRef = new Map<string, string>();

  const cleaned = text.replace(
    new RegExp(CITE_REGEX.source, "g"),
    (fullMatch) => {
      if (markerToRef.has(fullMatch)) {
        return markerToRef.get(fullMatch)!;
      }
      const ref = `[REF${counter}]`;
      counter++;
      markerToRef.set(fullMatch, ref);
      placeholders.set(ref, fullMatch);
      return ref;
    }
  );

  return { cleaned, placeholders };
}

/// Restores [REFN] placeholders back to their original {{cite:...}} markers.
/// Returns the restored text and a list of any refs that were missing
/// (indicating the AI dropped a citation — the caller should show an error).
export function restorePlaceholders(
  text: string,
  placeholders: Map<string, string>
): { restoredText: string; missingRefs: string[] } {
  let restoredText = text;
  const missingRefs: string[] = [];

  // Iterate in reverse numeric order to avoid [REF1] matching inside [REF10].
  const entries = [...placeholders.entries()].sort((a, b) => {
    const numA = parseInt(a[0].match(/\d+/)![0], 10);
    const numB = parseInt(b[0].match(/\d+/)![0], 10);
    return numB - numA;
  });

  for (const [ref, original] of entries) {
    if (!restoredText.includes(ref)) {
      missingRefs.push(ref);
      continue;
    }
    restoredText = restoredText.replaceAll(ref, original);
  }

  return { restoredText, missingRefs };
}

/// Replaces {{cite:ID::Label}} markers with their human-readable label text.
/// Used to produce clean context for the AI optimizer (e.g., "(Smith et al., 2023)").
export function stripCitationMarkersToLabels(text: string): string {
  return text.replace(
    new RegExp(CITE_REGEX.source, "g"),
    (_match, _paperId: string, label: string) => `(${label})`
  );
}
