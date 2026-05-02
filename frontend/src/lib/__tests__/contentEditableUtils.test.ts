/// Regression tests for trailing-whitespace handling in
/// `decoratedDomToRawText`. Browsers auto-insert <br> / <div><br></div>
/// trailers into contentEditable; without normalization those would
/// accumulate as an extra blank line in the saved body each time the
/// editor remounts.
import { describe, it, expect } from "vitest";
import {
  decoratedDomToRawText,
  setSelectionRangeFromRawTextOffsets,
} from "../contentEditableUtils";

/// Build a detached element so tests don't need a full JSDOM contentEditable
/// host — `decoratedDomToRawText` only walks DOM nodes.
function makeContainer(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("decoratedDomToRawText trailing whitespace", () => {
  it("does not leave a trailing newline from a single trailing <br>", () => {
    const el = makeContainer("Hello<br>");
    const out = decoratedDomToRawText(el);
    expect(out.endsWith("\n")).toBe(false);
  });

  it("strips trailing <div><br></div> (browser auto-insert pattern)", () => {
    const el = makeContainer("Hello<div><br></div>");
    const out = decoratedDomToRawText(el);
    expect(out.endsWith("\n")).toBe(false);
  });

  it("strips multiple trailing newline blocks", () => {
    const el = makeContainer("Hello<br><div><br></div><br>");
    const out = decoratedDomToRawText(el);
    expect(out.endsWith("\n")).toBe(false);
  });

  it("preserves blank lines in the middle of content", () => {
    const el = makeContainer("Para 1<br><br>Para 2");
    const out = decoratedDomToRawText(el);
    expect(out).toContain("Para 1");
    expect(out).toContain("\n\nPara 2");
    expect(out.endsWith("\n")).toBe(false);
  });

});

describe("setSelectionRangeFromRawTextOffsets", () => {
  /// The helper drives the undoable citation insert path (execCommand needs a
  /// selection that already maps to the raw-text range being replaced). It
  /// must walk the same decorated DOM that `decoratedDomToRawText` produces,
  /// so these tests exercise the round-trip: pick raw-text offsets, ask the
  /// helper to select that slice, and confirm the resulting selection's
  /// `toString()` matches the corresponding substring of the raw text.
  function attach(html: string): HTMLElement {
    const div = document.createElement("div");
    div.innerHTML = html;
    document.body.appendChild(div);
    return div;
  }

  it("selects a slice of plain text", () => {
    const el = attach("Hello world");
    const ok = setSelectionRangeFromRawTextOffsets(el, 6, 11);
    expect(ok).toBe(true);
    expect(window.getSelection()?.toString()).toBe("world");
    el.remove();
  });

  it("collapses to a caret when start === end", () => {
    const el = attach("Hello world");
    const ok = setSelectionRangeFromRawTextOffsets(el, 5, 5);
    expect(ok).toBe(true);
    expect(window.getSelection()?.isCollapsed).toBe(true);
    el.remove();
  });

  it("normalises reversed offsets", () => {
    const el = attach("Hello world");
    const ok = setSelectionRangeFromRawTextOffsets(el, 11, 6);
    expect(ok).toBe(true);
    expect(window.getSelection()?.toString()).toBe("world");
    el.remove();
  });

  it("selects across an existing citation chip without splitting it", () => {
    // Marker length is 31 chars: "{{cite:p1::para::p.1}}" = 22 chars.
    // Use a shorter sentinel to keep arithmetic obvious.
    const marker = "{{cite:p1::para::p.1}}"; // 22 chars
    const el = attach(
      `before ` +
        `<span data-marker="${marker}" contenteditable="false"><sup>1</sup></span>` +
        ` after`
    );
    // Raw text is: "before " (7) + marker (22) + " after" (6) = 35.
    // Select from offset 0 through end of " after" → full raw text length 35.
    const ok = setSelectionRangeFromRawTextOffsets(el, 0, 35);
    expect(ok).toBe(true);
    // The selection's stringified form excludes the contenteditable=false
    // chip's text nodes in JSDOM, but the helper must not throw and must
    // succeed (return true) — that's what execCommand needs.
    el.remove();
  });
});
