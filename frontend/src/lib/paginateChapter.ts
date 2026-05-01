/// DOM-based paginator for the thesis preview.
/// Walks a fully-rendered chapter offscreen, measures every top-level block
/// (and, when needed, every inner block of a section), and packs them
/// greedily into A4-height visual pages. Sections that overflow a page are
/// split across multiple cards while still letting the **trailing** card of
/// a split section share its remaining budget with the next sibling — so
/// e.g. section 1.5 begins underneath the tail of section 1.4.

const ATOMIC_CLASSES = ["thesis-figure", "formula-display", "hka-footnotes"];
const ATOMIC_TAGS = new Set(["FIGURE", "TABLE", "LI"]);

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

/// Compute the height of an inner-block range [startIdx..endIdx] inclusive,
/// measured in the inner-blocks' coordinate system (origin = parent's top).
/// We use bottom[endIdx] - top[startIdx] as a tight bound that captures
/// inter-block whitespace produced by collapsed margins.
function rangeHeight(blocks: NodeBlock[], startIdx: number, endIdx: number) {
  return blocks[endIdx].bottom - blocks[startIdx].top;
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
): Node[][] {
  const parentTop = measureEl.getBoundingClientRect().top;
  const topBlocks = groupChildNodes(measureEl, parentTop);

  const pages: Node[][] = [[]];
  let usedHeight = 0;
  let currentEmpty = true;

  /// Append cloned nodes to the current page.
  const appendToCurrent = (nodes: Node[]) => {
    pages[pages.length - 1].push(...nodes);
    currentEmpty = false;
  };
  /// Open a fresh page.
  const openNewPage = () => {
    pages.push([]);
    usedHeight = 0;
    currentEmpty = true;
  };

  /// Place a top-level block whole — used when the block fits.
  const placeWhole = (block: NodeBlock) => {
    const cloned = block.nodes.map((n) => n.cloneNode(true));
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

    /// Emit a slice [sliceStart..end) into a fresh shell on the current
    /// page. Returns the slice's height (so caller can update usedHeight).
    const emitSlice = (end: number): number => {
      const shell = shellTemplate.cloneNode(false) as HTMLElement;
      for (let i = sliceStart; i < end; i++) {
        for (const node of innerBlocks[i].nodes) {
          shell.appendChild(node.cloneNode(true));
        }
      }
      const sliceHeight = rangeHeight(innerBlocks, sliceStart, end - 1);
      appendToCurrent([shell]);
      sliceStart = end;
      return sliceHeight;
    };

    while (cursor < innerBlocks.length) {
      // Try to extend slice [sliceStart..cursor]. The slice's projected
      // height (against where it begins on the current page) is
      // rangeHeight(sliceStart..cursor). It fits if
      //   rangeHeight ≤ (maxHeightPx − usedHeight at slice start)
      // We use `pageStartUsed` captured at the slice's beginning; once
      // the slice fits, we can keep extending until it stops fitting.
      const heightSoFar = rangeHeight(innerBlocks, sliceStart, cursor);
      const remaining = maxHeightPx - usedHeight;

      if (heightSoFar <= remaining) {
        cursor++;
        continue;
      }

      // Block at cursor pushed slice over budget. Emit slice up to but
      // not including cursor (if non-empty), then move to a new page and
      // retry block at cursor.
      if (cursor > sliceStart) {
        emitSlice(cursor); // sets sliceStart = cursor
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

  for (const block of topBlocks) {
    const blockHeight = block.bottom - block.top;
    const remaining = maxHeightPx - usedHeight;

    if (blockHeight <= remaining) {
      placeWhole(block);
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
    placeWhole(block);
  }

  // Drop a trailing empty page if any.
  if (pages.length > 1 && pages[pages.length - 1].length === 0) {
    pages.pop();
  }

  return pages;
}
