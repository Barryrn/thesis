/// Bidirectional mapping between raw marker text and a contentEditable DOM.
/// Renders `{{cite:...}}`, `$$...$$`, `$...$`, and `{{fig:...}}` markers as
/// styled inline elements while keeping the raw text as the source of truth.
/// The `data-marker` attribute on each decorated element stores the exact raw
/// marker so reconstruction is lossless.

// ── Regex patterns (mirrored from citationUtils / formulaUtils / figureUtils) ──

/// Matches any resolved citation marker: {{cite:...}}.
/// Negative lookahead `(?!Needed)` keeps `{{citeNeeded:...}}` placeholders
/// out of this branch so they render as their own chip, not a footnote sup.
const CITE_ANY_RE = /\{\{cite:(?!Needed)[^}]+\}\}/;

/// Matches unresolved auto-citation placeholders: {{citeNeeded:ID::REASON}}.
const CITE_NEEDED_RE = /\{\{citeNeeded:[a-z0-9]+::[^}]*\}\}/;

/// Matches figure markers: {{fig:...}}
const FIG_MARKER_RE = /\{\{fig:[^}]+\}\}/;

/// Matches display math: $$...$$
const DISPLAY_MATH_RE = /\$\$([^$]+?)\$\$/;

/// Matches inline math: $...$ (not inside $$...$$)
const INLINE_MATH_RE = /(?<!\$)\$(?!\$)(\S[^$]*?\S|\S)\$(?!\$)/;

/// Combined splitting regex — captures all marker types so `split` retains them.
/// `{{citeNeeded:...}}` appears before `{{cite:...}}` so JS's left-to-right
/// alternation picks the more specific token first (although the resolved
/// branch's `(?!Needed)` lookahead also prevents collision).
const ALL_MARKERS_RE =
  /(\{\{citeNeeded:[a-z0-9]+::[^}]*\}\}|\{\{cite:(?!Needed)[^}]+\}\}|\{\{fig:[^}]+\}\}|\$\$[^$]+?\$\$|(?<!\$)\$(?!\$)(?:\S[^$]*?\S|\S)\$(?!\$))/;

// ── HTML escaping ───────────────────────────────────────────────────

/// Escapes HTML-special characters for safe insertion into innerHTML.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── rawTextToDecoratedHtml ──────────────────────────────────────────

/// Converts raw body text containing markers into decorated HTML suitable for
/// a contentEditable div. Each marker becomes a styled, non-editable inline
/// element carrying the raw marker in a `data-marker` attribute.
///
/// `sourceMap` is used only to resolve kuerzel for citations — callers that
/// don't need kuerzel display can pass an empty map.
///
/// `footnoteNumber` is an optional callback that maps a zero-based citation
/// index to the displayed footnote number. When omitted, a simple 1-based
/// sequential counter is used.
export function rawTextToDecoratedHtml(
  body: string,
  sourceMap: Map<string, { kuerzel?: string }>,
  footnoteNumber?: (index: number) => number
): string {
  if (!body) return "";

  // Split the body into alternating plain-text / marker parts.
  // Captured groups are retained in the result array.
  const parts = body.split(ALL_MARKERS_RE);
  let html = "";
  let citationIndex = 0;

  for (const part of parts) {
    if (!part) continue;

    if (CITE_ANY_RE.test(part)) {
      // Citation marker. The marker grammar may carry a trailing
      // `::origin:ai|user` segment; only `ai` gets the visual tint. Markers
      // without an explicit origin are treated as user (legacy default).
      const num = footnoteNumber
        ? footnoteNumber(citationIndex)
        : citationIndex + 1;
      citationIndex++;
      const isAi = /::origin:ai\}\}$/.test(part);
      const classAttr = isAi ? "ce-citation ce-citation--ai" : "ce-citation";
      const originAttr = isAi ? ` data-origin="ai"` : "";
      html +=
        `<span class="${classAttr}" data-marker="${escapeHtml(part)}"${originAttr} contenteditable="false">` +
        `<sup>${num}</sup></span>`;
    } else if (CITE_NEEDED_RE.test(part)) {
      // Unresolved auto-citation placeholder. Render as a yellow striped chip
      // with a `?` superscript. The `data-placeholder-id` attribute lets the
      // editor wire click handlers (popover + jump-from-TODO) without parsing
      // the marker again. Reason is decoded into `title` for hover tooltip.
      const inner = part.slice("{{citeNeeded:".length, -2);
      const sepIdx = inner.indexOf("::");
      const idStr = sepIdx >= 0 ? inner.slice(0, sepIdx) : inner;
      const encodedReason = sepIdx >= 0 ? inner.slice(sepIdx + 2) : "";
      let decodedReason = encodedReason;
      try {
        decodedReason = decodeURIComponent(encodedReason);
      } catch {
        // Malformed `%XX` — fall back to the encoded form.
      }
      html +=
        `<span class="ce-cite-needed" ` +
        `data-marker="${escapeHtml(part)}" ` +
        `data-placeholder-id="${escapeHtml(idStr)}" ` +
        `title="${escapeHtml(decodedReason)}" ` +
        `contenteditable="false">` +
        `<sup>?</sup></span>`;
    } else if (DISPLAY_MATH_RE.test(part) && part.startsWith("$$")) {
      // Display formula — render as editable styled text so the user can
      // click into, edit, and delete formula content directly.
      html +=
        `<div class="ce-formula-display">${escapeHtml(part)}</div>`;
    } else if (FIG_MARKER_RE.test(part)) {
      // Figure marker
      html +=
        `<span class="ce-figure" data-marker="${escapeHtml(part)}" contenteditable="false">` +
        `[Figure]</span>`;
    } else if (INLINE_MATH_RE.test(part) && !part.startsWith("$$")) {
      // Inline formula — render as editable styled text so the user can
      // click into, edit, and delete formula content directly.
      html +=
        `<span class="ce-formula-inline">${escapeHtml(part)}</span>`;
    } else {
      // Plain text — escape and convert newlines to <br>
      html += escapeHtml(part).replace(/\n/g, "<br>");
    }
  }

  return html;
}

// ── decoratedDomToRawText ───────────────────────────────────────────

/// Walks the DOM tree of a contentEditable container and reconstructs the raw
/// text with original markers. Elements carrying a `data-marker` attribute are
/// emitted as their raw marker string; text nodes and `<br>` elements produce
/// plain text and newlines respectively.
export function decoratedDomToRawText(container: HTMLElement): string {
  let result = "";
  walkForRawText(container, container, (text) => {
    result += text;
  });
  // Strip both leading and trailing newlines. Browsers can leave stray <br>
  // / empty <div> blocks at the start (from past serialization bugs that
  // saved a leading "\n" into the body) or at the end (auto-inserted caret
  // landing block). Without this, the saved body grows by one blank line
  // each time the editor mounts → serializes → saves.
  result = result.replace(/^\n+/, "").replace(/\n+$/, "");
  return result;
}

/// Recursive tree walker that emits raw text fragments through `emit`.
/// `root` is the outermost container (used to detect first-child divs).
function walkForRawText(
  node: Node,
  root: Node,
  emit: (text: string) => void
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    emit(node.textContent ?? "");
    return;
  }

  if (!(node instanceof HTMLElement)) return;

  // Marker elements — output the raw marker and skip children
  const marker = node.getAttribute("data-marker");
  if (marker) {
    emit(marker);
    return;
  }

  // <br> → newline
  if (node.tagName === "BR") {
    emit("\n");
    return;
  }

  // <div> without data-marker — browsers wrap lines in divs on Enter.
  // Prepend a newline unless this is the first child of the root container
  // (the first div shouldn't double-add a leading newline). Also skip when
  // `node === root`: the root container itself isn't a "line" — it's the
  // editor host — so emitting a leading newline for it would cause every
  // save to prepend an extra `\n` to the body, which then renders as a blank
  // line at the very top of the editor on the next mount.
  if (node.tagName === "DIV" && node !== root) {
    const isFirstChild = node === root.firstChild;
    if (!isFirstChild) {
      // Only prepend newline if the previous sibling didn't already end with
      // a <br> (avoids double newlines from <div><br></div> patterns).
      const prev = node.previousSibling;
      const prevEndsWithBr =
        prev instanceof HTMLElement && prev.tagName === "BR";
      if (!prevEndsWithBr) {
        emit("\n");
      }
    }
  }

  // Recurse into children
  for (const child of Array.from(node.childNodes)) {
    walkForRawText(child, root, emit);
  }
}

// ── Caret / selection mapping helpers ───────────────────────────────

/// Accumulates the raw-text length of each node before the target anchor,
/// returning the total offset once the anchor node is reached. Returns -1 if
/// the anchor was not found within the subtree.
function rawTextOffsetOf(
  node: Node,
  root: Node,
  anchorNode: Node,
  anchorOffset: number
): { offset: number; found: boolean } {
  if (node === anchorNode) {
    // If the anchor is a text node, the offset is character-based
    if (node.nodeType === Node.TEXT_NODE) {
      return { offset: anchorOffset, found: true };
    }
    // If the anchor is an element, anchorOffset is a child index — walk
    // children up to that index and sum their raw text lengths.
    let acc = 0;
    const children = Array.from(node.childNodes);
    for (let i = 0; i < anchorOffset && i < children.length; i++) {
      acc += rawTextLengthOf(children[i]);
    }
    return { offset: acc, found: true };
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return { offset: (node.textContent ?? "").length, found: false };
  }

  if (!(node instanceof HTMLElement)) {
    return { offset: 0, found: false };
  }

  // Marker span — count full marker length, don't recurse
  const marker = node.getAttribute("data-marker");
  if (marker) {
    return { offset: marker.length, found: false };
  }

  // <br> counts as 1 (newline)
  if (node.tagName === "BR") {
    return { offset: 1, found: false };
  }

  let acc = 0;

  // <div> prepends newline (same logic as walkForRawText). Guard with
  // `node !== root`: the editor host is itself a <div>, but it's the
  // container, not a "line", so it must not contribute a leading newline to
  // the offset arithmetic. Without this, raw-text offsets read off the live
  // caret are 1 too high whenever the editor body is a flat text node (no
  // inner block wrappers), which silently corrupts @-trigger detection
  // (`pickerQuery` includes the next character) and citation insert ranges.
  if (node.tagName === "DIV" && node !== root && node !== root.firstChild) {
    const prev = node.previousSibling;
    const prevEndsWithBr =
      prev instanceof HTMLElement && prev.tagName === "BR";
    if (!prevEndsWithBr) {
      acc += 1;
    }
  }

  for (const child of Array.from(node.childNodes)) {
    const result = rawTextOffsetOf(child, root, anchorNode, anchorOffset);
    acc += result.offset;
    if (result.found) {
      return { offset: acc, found: true };
    }
  }

  return { offset: acc, found: false };
}

/// Returns the raw-text character length represented by a DOM node.
function rawTextLengthOf(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").length;
  }

  if (!(node instanceof HTMLElement)) return 0;

  const marker = node.getAttribute("data-marker");
  if (marker) return marker.length;

  if (node.tagName === "BR") return 1;

  let len = 0;
  for (const child of Array.from(node.childNodes)) {
    len += rawTextLengthOf(child);
  }
  return len;
}

// ── getCaretOffsetInRawText ─────────────────────────────────────────

/// Maps the current DOM caret position inside `container` to a character offset
/// in the raw text string. Returns -1 if no selection exists or the caret is
/// outside the container.
export function getCaretOffsetInRawText(container: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return -1;

  // Verify that the anchor is inside the container
  if (!container.contains(sel.anchorNode)) return -1;

  const result = rawTextOffsetOf(
    container,
    container,
    sel.anchorNode,
    sel.anchorOffset
  );

  return result.found ? result.offset : -1;
}

// ── setCaretFromRawTextOffset ───────────────────────────────────────

/// Sets the browser caret inside `container` at the position corresponding to
/// `offset` characters in the raw text. If the offset falls within a marker
/// element, the caret is placed immediately after that element.
export function setCaretFromRawTextOffset(
  container: HTMLElement,
  offset: number
): void {
  const sel = window.getSelection();
  if (!sel) return;

  const target = findNodeAtRawOffset(container, container, offset);
  if (!target) return;

  const range = document.createRange();
  range.setStart(target.node, target.offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/// Result of finding a DOM position for a given raw-text offset.
interface NodePosition {
  node: Node;
  offset: number;
}

/// Walks the DOM tree accumulating raw-text length until the target offset is
/// reached, then returns the DOM node and offset to place the caret at.
function findNodeAtRawOffset(
  node: Node,
  root: Node,
  remaining: number
): NodePosition | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const len = (node.textContent ?? "").length;
    if (remaining <= len) {
      return { node, offset: remaining };
    }
    return null;
  }

  if (!(node instanceof HTMLElement)) return null;

  const marker = node.getAttribute("data-marker");
  if (marker) {
    // If offset falls within or at the end of a marker, place caret after it
    if (remaining <= marker.length) {
      const parent = node.parentNode;
      if (parent) {
        const idx = Array.from(parent.childNodes).indexOf(node as ChildNode);
        return { node: parent, offset: idx + 1 };
      }
    }
    return null;
  }

  if (node.tagName === "BR") {
    if (remaining <= 1) {
      const parent = node.parentNode;
      if (parent) {
        const idx = Array.from(parent.childNodes).indexOf(node as ChildNode);
        return { node: parent, offset: idx + 1 };
      }
    }
    return null;
  }

  // <div> may contribute a leading newline. Mirror the `node !== root` guard
  // used in `walkForRawText` — the editor host is a <div> too, but it doesn't
  // count as a "line" itself; without this guard offsets shift by one when
  // the editor hasn't yet been split into <div> child blocks (e.g. a single
  // unwrapped text node).
  if (node.tagName === "DIV" && node !== root && node !== root.firstChild) {
    const prev = node.previousSibling;
    const prevEndsWithBr =
      prev instanceof HTMLElement && prev.tagName === "BR";
    if (!prevEndsWithBr) {
      if (remaining === 0) {
        return { node, offset: 0 };
      }
      remaining -= 1;
    }
  }

  for (const child of Array.from(node.childNodes)) {
    const childLen = rawTextLengthOf(child);
    if (remaining <= childLen) {
      const result = findNodeAtRawOffset(child, root, remaining);
      if (result) return result;
    }
    remaining -= childLen;
  }

  return null;
}

// ── getCaretPixelPosition ───────────────────────────────────────────

/// Returns pixel coordinates of the current caret relative to `container`,
/// accounting for scroll position. Falls back to `{ top: 0, left: 0 }` if no
/// selection exists.
export function getCaretPixelPosition(
  container: HTMLElement
): { top: number; left: number } {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return { top: 0, left: 0 };
  }

  const range = sel.getRangeAt(0);
  const rangeRect = range.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  return {
    top: rangeRect.top - containerRect.top + container.scrollTop,
    left: rangeRect.left - containerRect.left,
  };
}

// ── setSelectionRangeFromRawTextOffsets ─────────────────────────────

/// Selects the DOM range corresponding to the raw-text offsets `[start, end]`.
/// Used by undo-preserving citation insertion: the caller selects the slice
/// of text being replaced, then issues `document.execCommand("insertHTML", …)`
/// so the browser records the swap as a single undoable step.
/// Returns true iff both endpoints resolved to a DOM position.
export function setSelectionRangeFromRawTextOffsets(
  container: HTMLElement,
  start: number,
  end: number
): boolean {
  const sel = window.getSelection();
  if (!sel) return false;

  const a = Math.min(start, end);
  const b = Math.max(start, end);

  const startPos = findNodeAtRawOffset(container, container, a);
  const endPos = findNodeAtRawOffset(container, container, b);
  if (!startPos || !endPos) return false;

  const range = document.createRange();
  try {
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
  } catch {
    // Endpoints can fall on nodes that are no longer mounted under `container`
    // if the DOM mutated between resolution and `setStart` (rare, but the
    // browser will throw `InvalidNodeTypeError`). Bail out so the caller can
    // fall back to a non-undoable rerender path.
    return false;
  }
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

// ── getSelectionRangeInRawText ──────────────────────────────────────

/// Maps the current DOM selection range to start/end offsets in the raw text.
/// Returns `null` if the selection is collapsed (just a caret) or doesn't exist.
export function getSelectionRangeInRawText(
  container: HTMLElement
): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  if (!sel.anchorNode || !sel.focusNode) return null;

  // Verify both endpoints are inside the container
  if (
    !container.contains(sel.anchorNode) ||
    !container.contains(sel.focusNode)
  ) {
    return null;
  }

  const anchorResult = rawTextOffsetOf(
    container,
    container,
    sel.anchorNode,
    sel.anchorOffset
  );
  const focusResult = rawTextOffsetOf(
    container,
    container,
    sel.focusNode,
    sel.focusOffset
  );

  if (!anchorResult.found || !focusResult.found) return null;

  const a = anchorResult.offset;
  const b = focusResult.offset;

  return { start: Math.min(a, b), end: Math.max(a, b) };
}
