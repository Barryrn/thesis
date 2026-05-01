import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { paginate } from "@/lib/paginateChapter";
import type { CompiledSection, CitationSettings, LayoutSettings } from "@/lib/documentCompiler";

interface ChapterPagesProps {
  /// All sections in this top-level chapter, depth-ordered.
  group: CompiledSection[];
  /// Minimum depth across all main sections (used to map depth to heading tag).
  minDepth: number;
  /// Citation style — controls whether footnote blocks render.
  citationStyle: CitationSettings["style"];
  /// First arabic page number for this chapter.
  startPageNum: number;
  /// Function that formats a page number for display (arabic/roman).
  formatPageNum: (num: number) => string;
  /// Layout settings — used to compute the usable A4 height in pixels.
  layout: LayoutSettings;
  /// Notifies parent how many visual pages this chapter consumed so the
  /// parent can advance its running page counter for the next chapter.
  onPageCountResolved: (count: number) => void;
}

/// Converts a CSS cm value to pixels by reading a 1cm reference element.
function cmToPx(cm: number, refEl: HTMLElement): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;width:1cm;height:1cm;";
  refEl.appendChild(probe);
  const px = probe.getBoundingClientRect().width;
  refEl.removeChild(probe);
  return cm * px;
}

/// One paginated page as rendered by this component: the section/body HTML
/// for the page plus the footnote entries whose citation markers landed on
/// it (in marker order). Footnotes are rendered as a separate block at the
/// bottom of each page card so they sit beneath the citation that triggered
/// them, not on the page after.
interface PageData {
  html: string;
  footnotes: { number: number; text: string }[];
}

/// Renders one top-level chapter as one or more A4 page cards. Long chapters
/// are split into multiple cards via measurement-based pagination so the
/// preview matches the eventual .docx export.
export default function ChapterPages({
  group,
  minDepth,
  citationStyle,
  startPageNum,
  formatPageNum,
  layout,
  onPageCountResolved,
}: ChapterPagesProps) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PageData[] | null>(null);

  /// Lookup table: footnote number → footnote text. Used to materialize
  /// per-page footnote blocks once the paginator has decided which numbers
  /// belong on which page. We must look up by number because the paginator
  /// only sees the markers, not the text.
  const footnoteMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of group) {
      for (const fn of s.footnotes) m.set(fn.number, fn.text);
    }
    return m;
  }, [group]);

  /// Build the chapter's full body HTML once. Body only — no footnote block
  /// here, since footnotes are placed per visual page after pagination.
  /// `data-fn-num` on each `<sup>` lets the paginator attribute markers to
  /// pages without parsing their text content.
  const fullHtml = group
    .map((section) => {
      const headingLevel = Math.min(section.depth - minDepth + 1, 4);
      return `<div data-section="${section.orderNumber}"><h${headingLevel}>${section.orderNumber} ${section.title}</h${headingLevel}>${
        section.renderedBody ?? ""
      }</div>`;
    })
    .join("");

  useLayoutEffect(() => {
    let cancelled = false;

    const run = async () => {
      const host = measureRef.current;
      if (!host) return;

      // Wait for fonts and images so heights are stable.
      try {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
        const imgs = Array.from(host.querySelectorAll("img"));
        await Promise.all(
          imgs.map((img) =>
            img.complete ? Promise.resolve() : (img as HTMLImageElement).decode().catch(() => undefined)
          )
        );
      } catch {
        // Best-effort; proceed even if font/image waiting fails.
      }

      if (cancelled) return;

      try {
        const a4HeightCm = 29.7 - layout.margins.top - layout.margins.bottom;
        // Reserve ~12px slack (~one body line) so sub-pixel rounding never
        // pushes a section past the visible card boundary.
        const SAFETY_PX = 12;
        const maxHeightPx = cmToPx(a4HeightCm, host) - SAFETY_PX;
        const inner = host.querySelector(".hka-preview") as HTMLElement | null;
        if (!inner) throw new Error("measure host missing inner .hka-preview");

        const slices = paginate(inner, maxHeightPx);
        // Build per-page payload: HTML for the body nodes plus the
        // footnotes whose citation markers landed on this page.
        const showFootnotes = citationStyle === "hkaFootnote";
        const built: PageData[] = slices.map((slice) => {
          const wrap = document.createElement("div");
          for (const n of slice.nodes) wrap.appendChild(n);
          const footnotes = showFootnotes
            ? slice.footnoteNumbers
                .map((n) => ({ number: n, text: footnoteMap.get(n) ?? "" }))
                .filter((fn) => fn.text.length > 0)
            : [];
          return { html: wrap.innerHTML, footnotes };
        });

        if (!cancelled) {
          setPages(built);
          onPageCountResolved(Math.max(built.length, 1));
        }
      } catch (err) {
        // Fall back to a single tall card containing the whole chapter.
        debugPrintError(err);
        if (!cancelled) {
          // Aggregate every footnote onto the fallback page so nothing is
          // lost — we can't paginate, but we mustn't drop citations.
          const allFootnotes =
            citationStyle === "hkaFootnote"
              ? Array.from(footnoteMap.entries()).map(([number, text]) => ({
                  number,
                  text,
                }))
              : [];
          setPages([{ html: fullHtml, footnotes: allFootnotes }]);
          onPageCountResolved(1);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullHtml, layout.margins.top, layout.margins.bottom, citationStyle]);

  /// Re-paginate when the measuring container's width changes (modal resize).
  useEffect(() => {
    const host = measureRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      // Force re-run by clearing cached pages; the layout effect above
      // will re-execute on next render because its dependencies are stable
      // — so trigger it via a state bump.
      setPages((prev) => (prev ? [...prev] : prev));
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  /// After the visible cards mount, warn if any preview content overflows
  /// its card. This catches future regressions where the paginator packs
  /// too tightly and content gets clipped.
  const visibleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pages) return;
    const root = visibleRef.current;
    if (!root) return;
    const cards = root.querySelectorAll<HTMLElement>(".hka-page .hka-preview");
    cards.forEach((el, i) => {
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow > 1) {
        // eslint-disable-next-line no-console
        console.warn(`[PREVIEW] page ${startPageNum + i} overflow: ${overflow}px`);
      }
    });
  }, [pages, startPageNum]);

  return (
    <>
      {/* Offscreen measurer — renders the chapter as a single block */}
      <div ref={measureRef} className="hka-page hka-page--measure" aria-hidden="true">
        <div className="hka-preview" dangerouslySetInnerHTML={{ __html: fullHtml }} />
      </div>

      {/* Visible A4 page cards. While pages is null we render nothing
          (would flash a tall card otherwise). */}
      <div ref={visibleRef} style={{ display: "contents" }}>
        {pages?.map((page, idx) => (
          <div key={idx} className="hka-page">
            <div className="hka-page-number">{formatPageNum(startPageNum + idx)}</div>
            <div className="hka-preview">
              <div
                className="hka-page-body"
                dangerouslySetInnerHTML={{ __html: page.html }}
              />
              {page.footnotes.length > 0 && (
                <div className="hka-footnotes">
                  <ol style={{ listStyle: "none", padding: 0 }}>
                    {page.footnotes.map((fn) => (
                      <li key={fn.number}>
                        <sup>{fn.number}</sup> {fn.text}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/// Wrapper to keep debugPrint usage simple and tagged.
function debugPrintError(err: unknown) {
  // eslint-disable-next-line no-console
  console.error("[ERROR][PREVIEW] pagination failed", err);
}
