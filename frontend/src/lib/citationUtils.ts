import type { CitationType, FootnoteEntry, ParsedCitation } from "./types";
import type { Doc } from "../../convex/_generated/dataModel";

// ── Regex patterns for HKA footnote citation markers ───────────────────

/// Primary citation: {{cite:PAPER_ID::direct|indirect::PAGE_REF}}
const CITE_REGEX =
  /\{\{cite:([^:]+)::(direct|indirect)::([^}]+)\}\}/g;

/// Secondary source: {{cite:PAPER_ID::direct|indirect::PAGE_REF::via:SEC_ID::SEC_PAGE}}
const CITE_SECONDARY_REGEX =
  /\{\{cite:([^:]+)::(direct|indirect)::([^:]+)::via:([^:]+)::([^}]+)\}\}/g;

/// Combined regex matching both primary and secondary markers.
/// Group layout differs by branch, so we parse with `parseCitations` instead.
const CITE_ANY_REGEX =
  /\{\{cite:[^}]+\}\}/g;

// ── Parsing ────────────────────────────────────────────────────────────

/// Parses all citation markers from body text in order of appearance.
export function parseCitations(body: string): ParsedCitation[] {
  const results: ParsedCitation[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(CITE_ANY_REGEX.source, "g");

  while ((match = re.exec(body)) !== null) {
    const full = match[0];
    const parsed = parseSingleMarker(full);
    if (parsed) results.push(parsed);
  }

  return results;
}

/// Parses a single {{cite:...}} marker string into structured data.
function parseSingleMarker(marker: string): ParsedCitation | null {
  // Try secondary format first (it's more specific)
  const secRe = new RegExp(CITE_SECONDARY_REGEX.source);
  const secMatch = secRe.exec(marker);
  if (secMatch) {
    return {
      fullMatch: marker,
      paperId: secMatch[1],
      citationType: secMatch[2] as CitationType,
      pageRef: secMatch[3],
      secondaryPaperId: secMatch[4],
      secondaryPageRef: secMatch[5],
    };
  }

  // Try primary format
  const priRe = new RegExp(CITE_REGEX.source);
  const priMatch = priRe.exec(marker);
  if (priMatch) {
    return {
      fullMatch: marker,
      paperId: priMatch[1],
      citationType: priMatch[2] as CitationType,
      pageRef: priMatch[3],
    };
  }

  return null;
}

/// Extracts unique paper IDs from all citation markers in the body,
/// including secondary source paper IDs.
export function extractCitationIds(body: string): string[] {
  const ids = new Set<string>();
  for (const c of parseCitations(body)) {
    ids.add(c.paperId);
    if (c.secondaryPaperId) ids.add(c.secondaryPaperId);
  }
  return [...ids];
}

// ── Marker insertion ───────────────────────────────────────────────────

/// Replaces the @query text at cursorPos with a citation marker.
/// Returns the updated body string and new cursor position.
export function insertCitationMarker(
  body: string,
  atStartPos: number,
  cursorPos: number,
  paperId: string,
  citationType: CitationType,
  pageRef: string,
  secondaryPaperId?: string,
  secondaryPageRef?: string
): { newBody: string; newCursorPos: number } {
  let marker: string;

  if (secondaryPaperId && secondaryPageRef) {
    marker = `{{cite:${paperId}::${citationType}::${pageRef}::via:${secondaryPaperId}::${secondaryPageRef}}}`;
  } else {
    marker = `{{cite:${paperId}::${citationType}::${pageRef}}}`;
  }

  const before = body.slice(0, atStartPos);
  const after = body.slice(cursorPos);
  const newBody = before + marker + after;
  return { newBody, newCursorPos: before.length + marker.length };
}

// ── Footnote rendering ─────────────────────────────────────────────────

/// Builds numbered footnote entries from body text and a source lookup map.
/// Each unique citation marker gets a sequential footnote number.
export function buildFootnotes(
  body: string,
  sourceMap: Map<string, Doc<"sources">>
): FootnoteEntry[] {
  const citations = parseCitations(body);
  const footnotes: FootnoteEntry[] = [];
  let number = 1;

  for (const c of citations) {
    const source = sourceMap.get(c.paperId);
    const kuerzel = source?.kuerzel ?? "??";

    const entry: FootnoteEntry = {
      number: number++,
      kuerzel,
      pageRef: c.pageRef,
      citationType: c.citationType,
      paperId: c.paperId,
    };

    if (c.secondaryPaperId) {
      const secSource = sourceMap.get(c.secondaryPaperId);
      entry.secondaryKuerzel = secSource?.kuerzel ?? "??";
      entry.secondaryPageRef = c.secondaryPageRef;
    }

    footnotes.push(entry);
  }

  return footnotes;
}

/// Formats a single footnote entry as text per HKA rules.
/// Direct: "KR09, S. 141."
/// Indirect: "Vgl. KR09, S. 3."
/// Secondary: "BE94, S. 185 zitiert nach FR11, S. 149."
export function renderFootnoteText(entry: FootnoteEntry): string {
  const prefix = entry.citationType === "indirect" ? "Vgl. " : "";

  if (entry.secondaryKuerzel && entry.secondaryPageRef) {
    return `${prefix}${entry.kuerzel}, ${entry.pageRef} zitiert nach ${entry.secondaryKuerzel}, ${entry.secondaryPageRef}.`;
  }

  return `${prefix}${entry.kuerzel}, ${entry.pageRef}.`;
}

// ── Kürzel generation ──────────────────────────────────────────────────

/// Extracts the surname (last word) from a full name string.
export function extractSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/// Strips diacritics/umlauts for ASCII-safe Kürzel characters.
function normalizeForKuerzel(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/// Client-side Kürzel generation (mirrors backend logic for preview).
/// Does NOT handle collision detection — that's the backend's job.
export function generateKuerzel(authors: string[], year?: number): string {
  if (authors.length === 0) return "XX" + (year ? String(year).slice(-2) : "");

  const surnames = authors.map((a) => normalizeForKuerzel(extractSurname(a)));
  let prefix: string;

  if (surnames.length === 1) {
    prefix = surnames[0].slice(0, 2).toUpperCase();
  } else {
    prefix = (surnames[0][0] + surnames[1][0]).toUpperCase();
  }

  const yearSuffix = year ? String(year).slice(-2) : "";
  return prefix + yearSuffix;
}

// ── Bibliography formatting ────────────────────────────────────────────

/// Formats a single bibliography entry per HKA rules based on sourceType.
/// Each entry is prefixed with [Kürzel] and follows the type-specific format.
export function formatBibliographyEntry(
  source: Doc<"sources">,
  paper: { title: string; authors: string[]; year?: number }
): string {
  const kuerzel = `[${source.kuerzel}]`;
  const authorStr = formatAuthorsForBibliography(paper.authors);
  const yearStr = paper.year ? `(${paper.year})` : "(o.J.)";
  const title = paper.title;

  switch (source.sourceType) {
    case "book":
      return `${kuerzel} ${authorStr} ${yearStr}. ${title}. ${locationPublisher(source)}`;

    case "bookChapter": {
      const editors = source.editorNames?.length
        ? formatAuthorsForBibliography(source.editorNames)
        : "";
      const bookTitle = source.editorBookTitle ?? "";
      const pages = formatPages(source.pageStart, source.pageEnd);
      return `${kuerzel} ${authorStr} ${yearStr}. ${title}. In ${editors} (Hrsg.), ${bookTitle}. ${locationPublisher(source)}${pages}`;
    }

    case "journalArticle": {
      const journal = source.journalName ?? "";
      const vol = source.volume ? `Jahrgang ${source.volume}` : "";
      const iss = source.issue ? `, Heft ${source.issue}` : "";
      const pages = formatPages(source.pageStart, source.pageEnd);
      return `${kuerzel} ${authorStr} ${yearStr}. ${title}. ${journal}. ${vol}${iss}.${pages}`;
    }

    case "newspaperArticle": {
      const newspaper = source.newspaperName ?? "";
      const pubDate = source.publishDate
        ? `Ausgabe vom ${source.publishDate}`
        : "";
      const pages = formatPages(source.pageStart, source.pageEnd);
      return `${kuerzel} ${authorStr} ${yearStr}. ${title}. ${newspaper}. ${pubDate}.${pages}`;
    }

    case "internetSource": {
      const accessStr = source.accessDate
        ? `Abgerufen am ${source.accessDate}`
        : "";
      const urlStr = source.url ? `von ${source.url}` : "";
      return `${kuerzel} ${authorStr} ${yearStr}. ${title}. ${accessStr} ${urlStr}.`;
    }

    default:
      return `${kuerzel} ${authorStr} ${yearStr}. ${title}.`;
  }
}

/// Formats an author list for bibliography entries.
/// "Nachname, Initial." for first author, "und Nachname, Initial." for second.
function formatAuthorsForBibliography(authors: string[]): string {
  if (authors.length === 0) return "Unbekannt";

  const formatted = authors.map((a) => {
    const parts = a.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const surname = parts[parts.length - 1];
    const initials = parts
      .slice(0, -1)
      .map((p) => p[0] + ".")
      .join(" ");
    return `${surname}, ${initials}`;
  });

  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]} und ${formatted[1]}`;
  return formatted.slice(0, -1).join(", ") + " und " + formatted[formatted.length - 1];
}

/// Formats publisher location and name.
function locationPublisher(source: Doc<"sources">): string {
  const loc = source.publisherLocation ?? "";
  const pub = source.publisher ?? "";
  if (loc && pub) return `${loc}: ${pub}.`;
  if (pub) return `${pub}.`;
  if (loc) return `${loc}.`;
  return "";
}

/// Formats page range as " S. X-Y." or " S. X." or empty.
function formatPages(pageStart?: string, pageEnd?: string): string {
  if (!pageStart) return "";
  if (pageEnd) return ` S. ${pageStart}-${pageEnd}.`;
  return ` S. ${pageStart}.`;
}

// ── @-trigger detection (unchanged logic) ──────────────────────────────

/// Detects whether the cursor is inside an @-trigger and returns context.
/// Returns null if no active trigger.
export function getAtTriggerContext(
  body: string,
  cursorPos: number
): { query: string; startPos: number } | null {
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

/// @deprecated Use `getCaretPixelPosition` from `contentEditableUtils.ts` instead.
/// This was used for the textarea-based editor and is no longer called.
///
/// Computes pixel coordinates of a caret position inside a textarea.
/// Uses the mirror-div technique: clones textarea styles into a hidden div
/// and measures the position of a marker span.
export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number
): { top: number; left: number } {
  const div = document.createElement("div");
  const style = getComputedStyle(textarea);

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

  const textBefore = textarea.value.slice(0, position);
  div.textContent = textBefore;

  const span = document.createElement("span");
  span.textContent = textarea.value.slice(position) || ".";
  div.appendChild(span);

  document.body.appendChild(div);

  document.body.removeChild(div);

  return {
    top: span.offsetTop - textarea.scrollTop,
    left: span.offsetLeft,
  };
}

// ── AI optimize placeholder utilities ──────────────────────────────────

/// Replaces all citation markers with numbered [REF1], [REF2], etc.
/// Returns the cleaned text and a map to restore the original markers later.
/// Used before sending text to the AI optimizer so citations are never mangled.
export function replaceCitationsWithPlaceholders(text: string): {
  cleaned: string;
  placeholders: Map<string, string>;
} {
  const placeholders = new Map<string, string>();
  let counter = 1;
  const markerToRef = new Map<string, string>();

  const cleaned = text.replace(
    new RegExp(CITE_ANY_REGEX.source, "g"),
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

/// Removes all citation markers from text, leaving clean prose.
/// Used to produce clean context for the AI optimizer.
export function stripCitationMarkers(text: string): string {
  return text.replace(new RegExp(CITE_ANY_REGEX.source, "g"), "");
}
