import type {
  CitationOrigin,
  CitationType,
  FootnoteEntry,
  ParsedCitation,
} from "./types";
import type { Doc } from "../../convex/_generated/dataModel";

// ── Regex patterns for HKA footnote citation markers ───────────────────
//
// All resolved-citation regexes use a `cite:(?!Needed)` negative lookahead so
// that the unresolved placeholder syntax `{{citeNeeded:...}}` introduced by
// the auto-citation feature is never accidentally classified as a real
// citation. The two grammars share a `{{cite` prefix; only the lookahead
// keeps them distinct without renaming the existing marker format.

/// Primary citation: {{cite:PAPER_ID::direct|indirect::PAGE_REF}}
const CITE_REGEX =
  /\{\{cite:(?!Needed)([^:]+)::(direct|indirect)::([^}]+)\}\}/g;

/// Secondary source: {{cite:PAPER_ID::direct|indirect::PAGE_REF::via:SEC_ID::SEC_PAGE}}
const CITE_SECONDARY_REGEX =
  /\{\{cite:(?!Needed)([^:]+)::(direct|indirect)::([^:]+)::via:([^:]+)::([^}]+)\}\}/g;

/// Combined regex matching both primary and secondary markers.
/// Group layout differs by branch, so we parse with `parseCitations` instead.
const CITE_ANY_REGEX =
  /\{\{cite:(?!Needed)[^}]+\}\}/g;

/// Unresolved auto-citation placeholder: {{citeNeeded:ID::ENCODED_REASON}}.
/// `ID` is an 8+ char [a-z0-9] token; `ENCODED_REASON` is `encodeURIComponent`-
/// encoded so it cannot contain `:` or `}` and is therefore safe to terminate
/// with `}}`. Capture groups: 1 = id, 2 = encoded reason.
const CITE_NEEDED_REGEX = /\{\{citeNeeded:([a-z0-9]+)::([^}]*)\}\}/g;

/// Maximum length of `encodeURIComponent(reason)` stored in the marker.
/// Truncate raw input before encoding to avoid splitting a `%XX` triplet.
const MAX_ENCODED_REASON_LEN = 240;

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

/// Strips an optional trailing `::origin:ai|user` segment from a marker's inner
/// body and returns the parsed origin. Markers without the segment default to
/// `user` so legacy data round-trips unchanged.
///
/// Operates on the inner content (between `{{` and `}}`) to keep the logic
/// orthogonal to the primary/secondary regexes — neither regex tolerates an
/// extra `::origin:...` tail directly because their last group is greedy.
function splitOriginSuffix(inner: string): {
  body: string;
  origin: CitationOrigin;
} {
  const m = inner.match(/^(.*)::origin:(ai|user)$/);
  if (!m) return { body: inner, origin: "user" };
  return { body: m[1], origin: m[2] as CitationOrigin };
}

/// Parses a single {{cite:...}} marker string into structured data.
function parseSingleMarker(marker: string): ParsedCitation | null {
  // Strip the outer braces so we can detach an optional origin suffix before
  // running the legacy regexes (which would otherwise swallow the suffix into
  // the last greedy capture group).
  const inner = marker.slice(2, -2);
  const { body, origin } = splitOriginSuffix(inner);
  const stripped = `{{${body}}}`;

  // Try secondary format first (it's more specific)
  const secRe = new RegExp(CITE_SECONDARY_REGEX.source);
  const secMatch = secRe.exec(stripped);
  if (secMatch) {
    return {
      fullMatch: marker,
      paperId: secMatch[1],
      citationType: secMatch[2] as CitationType,
      pageRef: secMatch[3],
      secondaryPaperId: secMatch[4],
      secondaryPageRef: secMatch[5],
      origin,
    };
  }

  // Try primary format
  const priRe = new RegExp(CITE_REGEX.source);
  const priMatch = priRe.exec(stripped);
  if (priMatch) {
    return {
      fullMatch: marker,
      paperId: priMatch[1],
      citationType: priMatch[2] as CitationType,
      pageRef: priMatch[3],
      origin,
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

/// A previously-entered citation, deduped by `(citationType, pageRef, secondaryPaperId, secondaryPageRef)`
/// across all section bodies for a given paperId. Surfaced in the citation
/// picker so the user can reuse a prior citation instead of retyping it.
export interface ExistingCitation {
  citationType: CitationType;
  pageRef: string;
  secondaryPaperId?: string;
  secondaryPageRef?: string;
}

/// Collects unique `ExistingCitation`s referencing `paperId` from a list of
/// section bodies. Dedupe key intentionally excludes excerpt text — different
/// uses can quote different passages on the same page; we present the tuple
/// itself for selection and let the user re-enter excerpt as needed.
export function collectExistingCitations(
  bodies: string[],
  paperId: string,
): ExistingCitation[] {
  const seen = new Set<string>();
  const out: ExistingCitation[] = [];
  for (const body of bodies) {
    for (const c of parseCitations(body)) {
      if (c.paperId !== paperId) continue;
      const key = `${c.citationType}|${c.pageRef}|${c.secondaryPaperId ?? ""}|${c.secondaryPageRef ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        citationType: c.citationType,
        pageRef: c.pageRef,
        secondaryPaperId: c.secondaryPaperId,
        secondaryPageRef: c.secondaryPageRef,
      });
    }
  }
  return out;
}

// ── Marker insertion ───────────────────────────────────────────────────

/// Builds a `{{cite:...}}` marker string. Origin segment is **only emitted for
/// `ai`** — the `user` default is implicit so we don't bloat every body with
/// redundant `::origin:user` suffixes, and legacy markers continue to round-trip
/// to `user` via `parseSingleMarker`.
export function buildCitationMarker(args: {
  paperId: string;
  citationType: CitationType;
  pageRef: string;
  secondaryPaperId?: string;
  secondaryPageRef?: string;
  origin: CitationOrigin;
}): string {
  const {
    paperId,
    citationType,
    pageRef,
    secondaryPaperId,
    secondaryPageRef,
    origin,
  } = args;

  const base =
    secondaryPaperId && secondaryPageRef
      ? `cite:${paperId}::${citationType}::${pageRef}::via:${secondaryPaperId}::${secondaryPageRef}`
      : `cite:${paperId}::${citationType}::${pageRef}`;

  const withOrigin = origin === "ai" ? `${base}::origin:ai` : base;
  return `{{${withOrigin}}}`;
}

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
  secondaryPageRef?: string,
  origin: CitationOrigin = "user"
): { newBody: string; newCursorPos: number } {
  const marker = buildCitationMarker({
    paperId,
    citationType,
    pageRef,
    secondaryPaperId,
    secondaryPageRef,
    origin,
  });

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
      origin: c.origin,
      fullMatch: c.fullMatch,
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

/// Walks `body` and ensures every `{{cite:...}}` marker carries an `::origin:ai`
/// suffix. Markers that already declare an origin (`ai` or `user`) are left
/// untouched. Used by the AI section-writer to tag streamed prose without
/// changing the backend prompt format.
export function tagAiOriginInBody(body: string): string {
  return body.replace(new RegExp(CITE_ANY_REGEX.source, "g"), (full) => {
    const inner = full.slice(2, -2);
    if (/::origin:(ai|user)$/.test(inner)) return full;
    return `{{${inner}::origin:ai}}`;
  });
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

/// Replaces all citation markers with numbered [REF1], [REF2], etc., and all
/// unresolved `{{citeNeeded:...}}` placeholders with [REFCN1], [REFCN2], etc.
/// Returns the cleaned text and a map to restore the original markers later.
/// Used before sending text to the AI optimizer so citations are never mangled
/// — both flavors round-trip even when the optimizer rewrites surrounding prose.
export function replaceCitationsWithPlaceholders(text: string): {
  cleaned: string;
  placeholders: Map<string, string>;
} {
  const placeholders = new Map<string, string>();
  const markerToRef = new Map<string, string>();
  let refCounter = 1;
  let cnCounter = 1;

  // Resolved citations first. The CITE_ANY_REGEX uses a (?!Needed) lookahead
  // so it never matches a pending marker — order between the two replaces is
  // therefore safe.
  let cleaned = text.replace(
    new RegExp(CITE_ANY_REGEX.source, "g"),
    (fullMatch) => {
      const cached = markerToRef.get(fullMatch);
      if (cached) return cached;
      const ref = `[REF${refCounter++}]`;
      markerToRef.set(fullMatch, ref);
      placeholders.set(ref, fullMatch);
      return ref;
    }
  );

  // Pending placeholders use the [REFCN…] namespace so they never collide
  // with [REF…]. Sentinel ordering matters at restore time — see
  // `restorePlaceholders` which sorts keys to avoid prefix collisions.
  cleaned = cleaned.replace(
    new RegExp(CITE_NEEDED_REGEX.source, "g"),
    (fullMatch) => {
      const cached = markerToRef.get(fullMatch);
      if (cached) return cached;
      const ref = `[REFCN${cnCounter++}]`;
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
/// Used to produce clean context for the AI optimizer. Strips both resolved
/// `{{cite:...}}` and unresolved `{{citeNeeded:...}}` placeholders so the
/// optimizer never sees raw marker syntax in either form.
export function stripCitationMarkers(text: string): string {
  return text
    .replace(new RegExp(CITE_ANY_REGEX.source, "g"), "")
    .replace(new RegExp(CITE_NEEDED_REGEX.source, "g"), "");
}

// ── Pending citation (auto-cite) helpers ───────────────────────────────

/// Parsed pending placeholder. The `reason` field is already URI-decoded; the
/// `fullMatch` round-trips via `String#replace` for in-place rewrites.
export interface ParsedPendingCitation {
  fullMatch: string;
  id: string;
  reason: string;
}

/// Walks the body for `{{citeNeeded:...}}` markers in document order and
/// returns the decoded reason for each. Order is stable and matches the
/// order of the chips the editor renders.
export function parsePendingCitations(body: string): ParsedPendingCitation[] {
  const out: ParsedPendingCitation[] = [];
  const re = new RegExp(CITE_NEEDED_REGEX.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push({
      fullMatch: m[0],
      id: m[1],
      reason: decodeReason(m[2]),
    });
  }
  return out;
}

/// Returns the placeholderIds present in `body`, in document order. Used by
/// the saveSectionContent cascade to detect orphaned auto-citation TODOs.
export function extractPendingPlaceholderIds(body: string): string[] {
  return parsePendingCitations(body).map((p) => p.id);
}

/// Replaces a single `{{citeNeeded:<id>::...}}` marker with `replacement`.
/// `placeholderId` is unique within a body, so an exact-string replace is safe.
/// Returns the original body unchanged when the placeholder is not present.
export function replacePendingMarker(
  body: string,
  placeholderId: string,
  replacement: string
): string {
  const re = new RegExp(
    `\\{\\{citeNeeded:${placeholderId}::[^}]*\\}\\}`,
    "g"
  );
  return body.replace(re, replacement);
}

/// Strips every `{{citeNeeded:...}}` marker from `body`, leaving resolved
/// `{{cite:...}}` markers untouched. Powers the "Clear pending citations"
/// toolbar escape hatch.
export function stripAllPendingMarkers(body: string): string {
  return body.replace(new RegExp(CITE_NEEDED_REGEX.source, "g"), "");
}

/// Generates a placeholder id: 8-char lowercase alphanumeric. Uses the Web
/// Crypto API for entropy; collision probability inside one section is
/// astronomically low. Callers should still de-dupe against the live body.
export function generatePlaceholderId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  // Base36 over 6 bytes ≈ 9-10 chars; slice to 8 for stable width.
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n.toString(36).padStart(8, "0").slice(0, 8);
}

/// URI-encodes a free-text reason, capping the encoded length so the marker
/// stays compact. Truncation happens on the raw string first to avoid
/// splitting a `%XX` triplet. Output is always `decodeURIComponent`-safe.
export function encodeReason(raw: string): string {
  let encoded = encodeURIComponent(raw);
  if (encoded.length <= MAX_ENCODED_REASON_LEN) return encoded;

  // Truncate raw progressively until the encoded form fits. Most reasons are
  // short — this loop runs at most a handful of times.
  let truncated = raw;
  while (
    encoded.length > MAX_ENCODED_REASON_LEN &&
    truncated.length > 0
  ) {
    truncated = truncated.slice(0, Math.max(0, truncated.length - 8));
    encoded = encodeURIComponent(truncated);
  }
  return encoded;
}

/// Decodes a reason string from a `{{citeNeeded:...}}` marker. Falls back to
/// the raw input if decoding throws (e.g. malformed `%XX`), so a corrupt
/// marker never breaks rendering.
export function decodeReason(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/// Builds a `{{citeNeeded:<id>::<encodedReason>}}` marker from raw inputs.
export function buildPendingMarker(id: string, reason: string): string {
  return `{{citeNeeded:${id}::${encodeReason(reason)}}}`;
}

// ── Highlight-to-cite helpers ──────────────────────────────────────────

/// Maximum length of `paragraphText` returned by `extractEnclosingParagraph`.
/// Beyond this we truncate symmetrically around the selection so the LLM
/// payload stays bounded even when the user writes one giant block.
const MAX_PARAGRAPH_TEXT_LEN = 4000;

/// Extracts the enclosing paragraph(s) for a selection in `body`. Paragraphs
/// are split on blank lines (`\n\n`); a multi-paragraph selection returns the
/// union spanning from the start of the first touched paragraph to the end of
/// the last. Long results are truncated symmetrically around the selection.
///
/// Returned offsets reference the *original* `body`, not the (possibly
/// truncated) text. Callers send `text` to the LLM and use `start`/`end` only
/// for UI debugging.
export function extractEnclosingParagraph(
  body: string,
  start: number,
  end: number
): { text: string; start: number; end: number } {
  const len = body.length;
  const safeStart = Math.max(0, Math.min(start, len));
  const safeEnd = Math.max(safeStart, Math.min(end, len));

  // Walk back to the previous blank line (or 0).
  let pStart = 0;
  const before = body.lastIndexOf("\n\n", Math.max(0, safeStart - 1));
  if (before !== -1) pStart = before + 2;

  // Walk forward to the next blank line (or end).
  let pEnd = len;
  const after = body.indexOf("\n\n", safeEnd);
  if (after !== -1) pEnd = after;

  const fullText = body.slice(pStart, pEnd);
  if (fullText.length <= MAX_PARAGRAPH_TEXT_LEN) {
    return { text: fullText, start: pStart, end: pEnd };
  }

  // Symmetric truncation around the selection. Anchor on the selection center
  // so both edges of the paragraph collapse evenly when the block is huge.
  const selCenter = Math.floor((safeStart + safeEnd) / 2) - pStart;
  const half = Math.floor(MAX_PARAGRAPH_TEXT_LEN / 2);
  const sliceStart = Math.max(0, selCenter - half);
  const sliceEnd = Math.min(fullText.length, sliceStart + MAX_PARAGRAPH_TEXT_LEN);
  return {
    text: fullText.slice(sliceStart, sliceEnd),
    start: pStart + sliceStart,
    end: pStart + sliceEnd,
  };
}

/// Returns the offset where a citation marker should be spliced for the
/// highlight-to-cite flow. Currently always returns `selectionEnd` — the
/// marker lands directly after the selection regardless of punctuation. The
/// helper exists so future locale-specific tweaks (e.g. German closing quote
/// `"` should pull the marker before the quote) live in one place.
export function computeInsertPos(
  _body: string,
  selectionEnd: number
): number {
  return selectionEnd;
}
