/// DOM-based paginator for the thesis preview.
/// Walks a fully-rendered chapter offscreen, measures every top-level block
/// (and, when needed, every inner block of a section), and packs them
/// greedily into A4-height visual pages. Sections that overflow a page are
/// split across multiple cards while still letting the **trailing** card of
/// a split section share its remaining budget with the next sibling — so
/// e.g. section 1.5 begins underneath the tail of section 1.4.
///
/// Also tracks footnote citations per page: each `<sup class="footnote-ref"
/// data-fn-num="N">` marker placed on a page reserves space for its
/// corresponding footnote line at the bottom of that page, so the rendered
/// footnotes always live on the same page as their citation marker.

const ATOMIC_CLASSES = ["thesis-figure", "formula-display", "hka-footnotes"];
const ATOMIC_TAGS = new Set(["FIGURE", "TABLE", "LI"]);
const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

function isAtomic(el: Element): boolean {
  if (ATOMIC_TAGS.has(el.tagName)) return true;
  for (const cls of ATOMIC_CLASSES) {
    if (el.classList.contains(cls)) return true;
  }
  return false;
}

/// A measurable unit during pagination: either a single Element child OR a
/// run of consecutive non-element siblings (text/comments) measured via
/// `Range.getBoundingClientRect()`.
interface NodeBlock {
  nodes: Node[];
  /// Top relative to the parent's top (px).
  top: number;
  /// Bottom relative to the parent's top (px).
  bottom: number;
  isElement: boolean;
}

/// One paginated page: the visible nodes plus the footnote numbers whose
/// citation markers landed on this page (in marker-encounter order).
export interface PaginatedPage {
  nodes: Node[];
  footnoteNumbers: number[];
}

function groupChildNodes(parent: Node, parentTop: number): NodeBlock[] {
  const blocks: NodeBlock[] = [];
  const children = Array.from(parent.childNodes);

  let runStart = -1;
  let runEnd = -1;
  const flushRun = () => {
    if (runStart < 0) return;
    const range = document.createRange();
    range.setStartBefore(children[runStart]);
    range.setEndAfter(children[runEnd]);
    const rect = range.getBoundingClientRect();
    blocks.push({
      nodes: children.slice(runStart, runEnd + 1),
      top: rect.top - parentTop,
      bottom: rect.bottom - parentTop,
      isElement: false,
    });
    range.detach?.();
    runStart = -1;
    runEnd = -1;
  };

  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.nodeType === Node.ELEMENT_NODE) {
      flushRun();
      const el = node as Element;
      const rect = el.getBoundingClientRect();
      blocks.push({
        nodes: [node],
        top: rect.top - parentTop,
        bottom: rect.bottom - parentTop,
        isElement: true,
      });
    } else {
      if (
        node.nodeType === Node.TEXT_NODE &&
        (node.textContent ?? "").trim() === ""
      ) {
        continue;
      }
      if (runStart < 0) runStart = i;
      runEnd = i;
    }
  }
  flushRun();
  return blocks;
}

/// True if a block is a single heading element (H1–H6). Headings must stay
/// on the same page as their first following block — see keep-with-next
/// logic in `packSection` and the top-level loop.
function isHeading(block: NodeBlock): boolean {
  if (!block.isElement) return false;
  const el = block.nodes[0] as Element;
  return HEADING_TAGS.has(el.tagName);
}

/// True for blocks that don't represent real content — bare `<br>` elements
/// used as paragraph spacers. When deciding whether a heading + "next block"
/// fit together, we must skip these so the lookahead lands on actual prose;
/// otherwise a heading followed by `<br>` trivially passes the keep-with-next
/// check and orphans on the previous page.
function isFiller(block: NodeBlock): boolean {
  if (!block.isElement) return false;
  const el = block.nodes[0] as Element;
  return el.tagName === "BR";
}

/// Find the index of the first non-filler block at or after `from`. Returns
/// -1 when no such block exists.
function nextSubstantive(blocks: NodeBlock[], from: number): number {
  for (let j = from; j < blocks.length; j++) {
    if (!isFiller(blocks[j])) return j;
  }
  return -1;
}

/// Compute the height of an inner-block range [startIdx..endIdx] inclusive,
/// measured in the inner-blocks' coordinate system (origin = parent's top).
/// We use bottom[endIdx] - top[startIdx] as a tight bound that captures
/// inter-block whitespace produced by collapsed margins.
function rangeHeight(blocks: NodeBlock[], startIdx: number, endIdx: number) {
  return blocks[endIdx].bottom - blocks[startIdx].top;
}

/// Collect the `data-fn-num` values from every `sup.footnote-ref` inside the
/// given root node (or sub-tree of nodes). Returns numbers in document order.
function collectFootnoteNums(nodes: Node[]): number[] {
  const out: number[] = [];
  for (const n of nodes) {
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const root = n as Element;
    // The block itself might be a sup (rare, but handle).
    if (root.matches?.("sup.footnote-ref[data-fn-num]")) {
      const v = Number(root.getAttribute("data-fn-num"));
      if (Number.isFinite(v)) out.push(v);
    }
    const sups = root.querySelectorAll?.("sup.footnote-ref[data-fn-num]");
    if (sups) {
      sups.forEach((sup) => {
        const v = Number(sup.getAttribute("data-fn-num"));
        if (Number.isFinite(v)) out.push(v);
      });
    }
  }
  return out;
}

/// Measure once at pagination start: how tall is one footnote `<li>` line
/// and how much fixed overhead does the `.hka-footnotes` block itself add
/// (margin-top + padding-top + border-top). We append a probe to the same
/// container that holds the offscreen measurer so it inherits typography.
function measureFootnoteMetrics(measureEl: HTMLElement): {
  linePx: number;
  blockOverheadPx: number;
} {
  const probe = document.createElement("div");
  probe.className = "hka-footnotes";
  probe.style.position = "absolute";
  probe.style.left = "-9999px";
  probe.style.top = "0";
  probe.style.visibility = "hidden";
  probe.innerHTML =
    '<ol style="list-style:none;padding:0;margin:0;"><li><sup>1</sup> probe</li></ol>';
  // Insert as a sibling of the measurer's parent card so it picks up the
  // same width/typography context. Falls back to body if no parent.
  const host = measureEl.parentElement ?? document.body;
  host.appendChild(probe);

  const blockRect = probe.getBoundingClientRect();
  const li = probe.querySelector("li") as HTMLElement | null;
  const liRect = li?.getBoundingClientRect();

  // Line height = the probed <li> height; safe lower bound is its bounding
  // box height. If <li> not found, fall back to ~14px.
  const linePx = liRect ? liRect.height : 14;
  // Block overhead = total height − one line. Captures margin-top (1cm),
  // padding-top (0.5cm), and the 1px top border. We measure rather than
  // hardcode so future CSS tweaks don't drift.
  const blockOverheadPx = Math.max(blockRect.height - linePx, 0);

  host.removeChild(probe);
  return { linePx, blockOverheadPx };
}

/// Greedy single-pass paginator.
///
/// Pages are built up as `Node[][]`. The packer maintains a running
/// `usedHeight` for the current (last) page so that, after splitting a
/// section across pages, the section's trailing shell leaves the current
/// page with its actual partial height — and the next top-level sibling
/// is offered the remaining space.
export function paginate(
  measureEl: HTMLElement,
  maxHeightPx: number
): PaginatedPage[] {
  const parentTop = measureEl.getBoundingClientRect().top;
  const topBlocks = groupChildNodes(measureEl, parentTop);

  const { linePx: FN_LINE_PX, blockOverheadPx: FN_BLOCK_OVERHEAD_PX } =
    measureFootnoteMetrics(measureEl);

  const pages: PaginatedPage[] = [{ nodes: [], footnoteNumbers: [] }];
  let usedHeight = 0;
  let currentEmpty = true;

  /// Per-page footnote bookkeeping. `footnoteOverhead` is the contribution
  /// of footnotes (one-time block overhead + N × line height) already added
  /// to `usedHeight` for the current page. Reset on `openNewPage`.
  let pageFootnoteSet = new Set<number>();
  let footnoteOverhead = 0;

  /// Cost of adding the given footnote numbers to the current page, given
  /// what's already reserved. Skips numbers already on the page.
  const footnoteCost = (nums: number[]): number => {
    if (nums.length === 0) return 0;
    let cost = 0;
    let firstOnPage = pageFootnoteSet.size === 0;
    let added = 0;
    for (const n of nums) {
      if (pageFootnoteSet.has(n)) continue;
      added++;
    }
    if (added === 0) return 0;
    if (firstOnPage) cost += FN_BLOCK_OVERHEAD_PX;
    cost += added * FN_LINE_PX;
    return cost;
  };

  /// Commit footnotes to the current page after their citation block has
  /// been placed. Adds new numbers to the page's set, appends in encounter
  /// order, and grows `usedHeight` + `footnoteOverhead` accordingly.
  const commitFootnotes = (nums: number[]) => {
    if (nums.length === 0) return;
    let added = 0;
    const wasEmpty = pageFootnoteSet.size === 0;
    const page = pages[pages.length - 1];
    for (const n of nums) {
      if (pageFootnoteSet.has(n)) continue;
      pageFootnoteSet.add(n);
      page.footnoteNumbers.push(n);
      added++;
    }
    if (added === 0) return;
    let delta = added * FN_LINE_PX;
    if (wasEmpty) delta += FN_BLOCK_OVERHEAD_PX;
    usedHeight += delta;
    footnoteOverhead += delta;
  };

  /// Append cloned nodes to the current page.
  const appendToCurrent = (nodes: Node[]) => {
    pages[pages.length - 1].nodes.push(...nodes);
    currentEmpty = false;
  };
  /// Open a fresh page.
  const openNewPage = () => {
    pages.push({ nodes: [], footnoteNumbers: [] });
    usedHeight = 0;
    currentEmpty = true;
    pageFootnoteSet = new Set();
    footnoteOverhead = 0;
  };

  /// Place a top-level block whole — used when the block fits.
  const placeWhole = (block: NodeBlock, cloned: Node[]) => {
    appendToCurrent(cloned);
    usedHeight += block.bottom - block.top;
  };

  /// Pack the inner blocks of a single splittable section into the current
  /// page (and subsequent pages as needed). The section's trailing shell
  /// stays on the (new) current page so the next sibling can flow into it.
  const packSection = (
    shellTemplate: HTMLElement,
    innerBlocks: NodeBlock[]
  ) => {
    let sliceStart = 0;
    let cursor = 0;

    /// Per-slice footnote accumulator: numbers found in inner blocks
    /// [sliceStart..cursor) that haven't been committed yet. Reset whenever
    /// `sliceStart` advances. We also track per-inner-block clones so we
    /// don't clone twice.
    const innerClones: Node[][] = innerBlocks.map((b) =>
      b.nodes.map((n) => n.cloneNode(true))
    );
    const innerFootnotes: number[][] = innerClones.map((ns) =>
      collectFootnoteNums(ns)
    );

    /// Footnotes contributed by the pending slice [sliceStart..cursor),
    /// excluding those already committed to the current page.
    const pendingSliceNums = (endExclusive: number): number[] => {
      const seen = new Set<number>();
      const out: number[] = [];
      for (let i = sliceStart; i < endExclusive; i++) {
        for (const n of innerFootnotes[i]) {
          if (pageFootnoteSet.has(n)) continue;
          if (seen.has(n)) continue;
          seen.add(n);
          out.push(n);
        }
      }
      return out;
    };

    /// Emit a slice [sliceStart..end) into a fresh shell on the current
    /// page and commit its footnotes. Returns the slice's height.
    const emitSlice = (end: number): number => {
      const shell = shellTemplate.cloneNode(false) as HTMLElement;
      const sliceFootnotes: number[] = [];
      for (let i = sliceStart; i < end; i++) {
        for (const cn of innerClones[i]) {
          shell.appendChild(cn);
        }
        for (const n of innerFootnotes[i]) sliceFootnotes.push(n);
      }
      const sliceHeight = rangeHeight(innerBlocks, sliceStart, end - 1);
      appendToCurrent([shell]);
      sliceStart = end;
      // Caller updates usedHeight with sliceHeight; we add footnotes here
      // because they're tied to the slice that was just placed.
      commitFootnotes(sliceFootnotes);
      return sliceHeight;
    };

    while (cursor < innerBlocks.length) {
      // Try to extend slice [sliceStart..cursor]. The slice's projected
      // height (against where it begins on the current page) is
      // rangeHeight(sliceStart..cursor). It fits if
      //   rangeHeight + footnoteCost(new footnotes in slice)
      //     ≤ (maxHeightPx − usedHeight)
      // We use `pageStartUsed` captured at the slice's beginning; once
      // the slice fits, we can keep extending until it stops fitting.
      const heightSoFar = rangeHeight(innerBlocks, sliceStart, cursor);
      const pendingNums = pendingSliceNums(cursor + 1);
      const fnCost = footnoteCost(pendingNums);
      const remaining = maxHeightPx - usedHeight;

      if (heightSoFar + fnCost <= remaining) {
        // Keep-with-next: a heading must not be the last visible block on
        // a page. We look ahead for the next *substantive* block (skipping
        // `<br>` spacers, which would trivially fit and defeat the check)
        // and require the heading + that block to fit together. If they
        // don't fit, fall through to overflow handling so the heading is
        // pushed to the next page along with its first body block. Skipped
        // when the page is otherwise empty (degenerate: a single pair too
        // tall for a full page — let it flow as best it can).
        const nextIdx = isHeading(innerBlocks[cursor])
          ? nextSubstantive(innerBlocks, cursor + 1)
          : -1;
        if (nextIdx !== -1 && !currentEmpty) {
          const pairHeight = rangeHeight(innerBlocks, sliceStart, nextIdx);
          const pairFnCost = footnoteCost(pendingSliceNums(nextIdx + 1));
          if (pairHeight + pairFnCost > remaining) {
            // Fall through to overflow handling below — do NOT advance cursor.
          } else {
            cursor++;
            continue;
          }
        } else {
          cursor++;
          continue;
        }
      }

      // Block at cursor pushed slice over budget. Emit slice up to but
      // not including cursor (if non-empty), then move to a new page and
      // retry block at cursor.
      if (cursor > sliceStart) {
        const h = emitSlice(cursor); // sets sliceStart = cursor
        usedHeight += h;
        openNewPage();
        // Re-evaluate cursor on the fresh page.
      } else {
        // sliceStart === cursor: the very first block of this slice
        // doesn't fit. If current page has content, open a new page and
        // retry. Else accept the oversize block alone (degenerate).
        if (!currentEmpty) {
          openNewPage();
        } else {
          const h = emitSlice(cursor + 1); // slice = [cursor..cursor]
          usedHeight += h;
          cursor++;
          openNewPage();
        }
      }
    }

    // Final slice: emit but DO NOT open a new page after — this lets the
    // section's trailing shell share the current page with the next
    // top-level sibling.
    if (sliceStart < innerBlocks.length) {
      const h = emitSlice(innerBlocks.length);
      usedHeight += h;
    }
  };

  for (let bi = 0; bi < topBlocks.length; bi++) {
    const block = topBlocks[bi];
    const blockHeight = block.bottom - block.top;
    // Pre-clone so we can scan for footnote markers without re-walking.
    const cloned = block.nodes.map((n) => n.cloneNode(true));
    const blockFootnotes = collectFootnoteNums(cloned);
    const fnCost = footnoteCost(blockFootnotes);
    const remaining = maxHeightPx - usedHeight;

    if (blockHeight + fnCost <= remaining) {
      // Keep-with-next: never leave a heading orphaned at the bottom of a
      // page. Look ahead past `<br>` fillers to the next substantive block
      // and force a page break if the pair won't fit.
      if (isHeading(block) && !currentEmpty) {
        const nextIdx = nextSubstantive(topBlocks, bi + 1);
        if (nextIdx !== -1) {
          const next = topBlocks[nextIdx];
          const pairHeight = next.bottom - block.top;
          // For the pair fit check, also include footnotes from the next
          // block (since they'd both land on this page).
          const nextNums = collectFootnoteNums(
            next.nodes.map((n) => n.cloneNode(true))
          );
          const pairFnCost = footnoteCost([...blockFootnotes, ...nextNums]);
          if (pairHeight + pairFnCost > remaining) {
            openNewPage();
          }
        }
      }
      placeWhole(block, cloned);
      commitFootnotes(blockFootnotes);
      continue;
    }

    // Doesn't fit. Try to split if it's a splittable element.
    const onlyEl = block.isElement ? (block.nodes[0] as HTMLElement) : null;
    const splittable =
      onlyEl &&
      !isAtomic(onlyEl) &&
      onlyEl.childNodes.length > 1;

    if (splittable) {
      const innerParentTop = onlyEl.getBoundingClientRect().top;
      const innerBlocks = groupChildNodes(onlyEl, innerParentTop);
      if (innerBlocks.length > 0) {
        packSection(onlyEl, innerBlocks);
        continue;
      }
    }

    // Not splittable. Open new page (if needed) and place whole.
    if (!currentEmpty) openNewPage();
    placeWhole(block, cloned);
    commitFootnotes(blockFootnotes);
  }

  // Drop a trailing empty page if any.
  if (pages.length > 1) {
    const last = pages[pages.length - 1];
    if (last.nodes.length === 0 && last.footnoteNumbers.length === 0) {
      pages.pop();
    }
  }

  return pages;
}
