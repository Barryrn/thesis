/// Central document compilation module.
/// Takes all thesis data and produces a structured intermediate representation
/// that can be rendered as HTML (preview) or inform the .docx export.

import { parseCitations } from "./citationUtils";
import { parseFormulas } from "./formulaUtils";
import { parseFigureMarkers, computeFigureNumbers } from "./figureUtils";
import type { Doc } from "../../convex/_generated/dataModel";
import katex from "katex";

// ── Layout Settings ─────────────────────────────────────────────────

/// User-configurable document layout settings.
/// All values have HKA-compliant defaults; the architecture generalises
/// so other university presets can be added later.
export interface LayoutSettings {
  fontSize: number;     // pt (8–16)
  lineSpacing: number;  // multiplier (0.8–3.0)
  margins: { top: number; bottom: number; left: number; right: number }; // cm
  pageNumbering: {
    position: "header" | "footer";
    format: "automatic" | "allArabic" | "allRoman";
    startPage: number;
  };
}

/// HKA Wirtschaftswissenschaften default layout.
export const DEFAULT_LAYOUT: LayoutSettings = {
  fontSize: 12,
  lineSpacing: 1.5,
  margins: { top: 2.5, bottom: 2.5, left: 3, right: 2.5 },
  pageNumbering: { position: "header", format: "automatic", startPage: 1 },
};

// ── Citation Settings ───────────────────────────────────────────────

/// User-configurable citation style and bibliography ordering.
export interface CitationSettings {
  style: "hkaFootnote" | "numbered" | "authorYear";
  ordering: "alphabetical" | "appearance";
}

/// HKA Kürzel footnote style with alphabetical bibliography ordering.
export const DEFAULT_CITATION: CitationSettings = {
  style: "hkaFootnote",
  ordering: "alphabetical",
};

/// Named margin presets for the settings panel dropdown.
export const MARGIN_PRESETS: Record<string, LayoutSettings["margins"]> = {
  "HKA Standard": { top: 2.5, bottom: 2.5, left: 3, right: 2.5 },
  Narrow: { top: 2, bottom: 2, left: 2, right: 2 },
  Normal: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
  Wide: { top: 3, bottom: 3, left: 3.5, right: 3 },
};

// ── Types ────────────────────────────────────────────────────────────

export interface DocumentData {
  metadata: ThesisMetadata | null;
  sections: OutlineSectionDoc[];
  sectionContents: Map<string, string>;
  figures: Map<string, FigureDoc[]>;
  figureUrls: Map<string, string>;
  sources: Doc<"sources">[];
  papers: Map<string, PaperDoc>;
}

export interface ThesisMetadata {
  studentName: string;
  studentAddress?: string;
  studentEmail?: string;
  universityEmail?: string;
  matrikelnummer?: string;
  titleDE: string;
  titleEN?: string;
  subtitleDE?: string;
  subtitleEN?: string;
  studiengang?: string;
  erstpruefer?: string;
  zweitpruefer?: string;
  abgabedatum?: string;
  abstractDE?: string;
  abstractEN?: string;
  keywordsDE?: string[];
  keywordsEN?: string[];
  layoutSettings?: LayoutSettings;
  citationSettings?: CitationSettings;
}

export interface OutlineSectionDoc {
  _id: string;
  title: string;
  orderNumber: string;
  depth: number;
  parentId?: string;
}

export interface FigureDoc {
  _id: string;
  sectionId: string;
  storageId: string;
  caption: string;
  orderIndex: number;
}

export interface PaperDoc {
  _id: string;
  title: string;
  authors: string[];
  year?: number;
}

export interface CompiledDocument {
  titlePage: TitlePageData;
  abstractDE: string;
  abstractEN: string;
  keywordsDE: string[];
  keywordsEN: string[];
  tableOfContents: TOCEntry[];
  listOfFigures: FigureListEntry[];
  mainSections: CompiledSection[];
  bibliography: BibliographyEntry[];
  declarationText: string;
  /// Resolved layout settings (never undefined — defaults merged in).
  layoutSettings: LayoutSettings;
  /// Resolved citation settings (never undefined — defaults merged in).
  citationSettings: CitationSettings;
}

export interface TitlePageData {
  studentName: string;
  studentAddress: string;
  studentEmail: string;
  universityEmail: string;
  matrikelnummer: string;
  titleDE: string;
  titleEN: string;
  subtitleDE: string;
  subtitleEN: string;
  studiengang: string;
  erstpruefer: string;
  zweitpruefer: string;
  abgabedatum: string;
}

export interface TOCEntry {
  orderNumber: string;
  title: string;
  depth: number;
}

export interface FigureListEntry {
  figureNumber: number;
  caption: string;
  sectionOrderNumber: string;
}

export interface CompiledSection {
  sectionId: string;
  title: string;
  orderNumber: string;
  depth: number;
  renderedBody: string;
  footnotes: FootnoteRenderEntry[];
}

export interface FootnoteRenderEntry {
  number: number;
  text: string;
}

export interface BibliographyEntry {
  kuerzel: string;
  formattedText: string;
  /// Paper ID used for appearance-order lookups and numbered-style mapping.
  paperId: string;
}

// ── HKA Eidesstattliche Erklärung ────────────────────────────────────

const DECLARATION_TEXT = `Hiermit erkläre ich, dass ich die vorliegende Arbeit selbstständig und nur unter Benutzung der angegebenen Quellen und Hilfsmittel angefertigt habe. Alle Textstellen, die wörtlich oder sinngemäß aus veröffentlichten oder nicht veröffentlichten Quellen entnommen wurden, sind als solche kenntlich gemacht. Die Arbeit hat in gleicher oder ähnlicher Form keiner anderen Prüfungsbehörde vorgelegen.`;

// ── Main compiler ────────────────────────────────────────────────────

/// Compiles all thesis data into a structured document representation.
export function compileDocument(data: DocumentData): CompiledDocument {
  const metadata = data.metadata;

  // Resolve layout settings: deep-merge user overrides over HKA defaults.
  const rawLayout = metadata?.layoutSettings;
  const layoutSettings: LayoutSettings = {
    ...DEFAULT_LAYOUT,
    ...rawLayout,
    margins: { ...DEFAULT_LAYOUT.margins, ...rawLayout?.margins },
    pageNumbering: { ...DEFAULT_LAYOUT.pageNumbering, ...rawLayout?.pageNumbering },
  };

  // Resolve citation settings: merge user overrides over HKA defaults.
  const citationSettings: CitationSettings = {
    ...DEFAULT_CITATION,
    ...metadata?.citationSettings,
  };

  const titlePage: TitlePageData = {
    studentName: metadata?.studentName ?? "",
    studentAddress: metadata?.studentAddress ?? "",
    studentEmail: metadata?.studentEmail ?? "",
    universityEmail: metadata?.universityEmail ?? "",
    matrikelnummer: metadata?.matrikelnummer ?? "",
    titleDE: metadata?.titleDE ?? "",
    titleEN: metadata?.titleEN ?? "",
    subtitleDE: metadata?.subtitleDE ?? "",
    subtitleEN: metadata?.subtitleEN ?? "",
    studiengang: metadata?.studiengang ?? "",
    erstpruefer: metadata?.erstpruefer ?? "",
    zweitpruefer: metadata?.zweitpruefer ?? "",
    abgabedatum: metadata?.abgabedatum ?? "",
  };

  const sortedSections = [...data.sections].sort((a, b) =>
    a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true })
  );

  const toc = generateTOC(sortedSections);
  const listOfFigures = generateListOfFigures(sortedSections, data.figures);

  // Build source map for footnotes
  const sourceMap = new Map<string, Doc<"sources">>();
  for (const src of data.sources) {
    sourceMap.set(src.paperId, src);
  }

  // Compute global figure numbers
  const figNumberInput = sortedSections.map((s) => ({
    orderNumber: s.orderNumber,
    figures: (data.figures.get(s._id) ?? []).map((f) => ({
      _id: f._id,
      orderIndex: f.orderIndex,
    })),
  }));
  const figureNumbers = computeFigureNumbers(figNumberInput);

  // Build figure map for quick lookup
  const allFigures = new Map<string, FigureDoc>();
  for (const figs of data.figures.values()) {
    for (const f of figs) {
      allFigures.set(f._id, f);
    }
  }

  // ── Two-pass compilation ─────────────────────────────────────────────
  // Pass 1: Collect all unique source IDs in order of first appearance
  // (needed for numbered/appearance-ordered citation styles).
  const appearanceOrder = new Map<string, number>();
  let appearanceCounter = 1;
  for (const section of sortedSections) {
    const body = data.sectionContents.get(section._id) ?? "";
    const citations = parseCitations(body);
    for (const c of citations) {
      if (!appearanceOrder.has(c.paperId)) {
        appearanceOrder.set(c.paperId, appearanceCounter++);
      }
      if (c.secondaryPaperId && !appearanceOrder.has(c.secondaryPaperId)) {
        appearanceOrder.set(c.secondaryPaperId, appearanceCounter++);
      }
    }
  }

  // For the numbered style, compute the final paperId→number mapping based
  // on the chosen ordering. When ordering is "alphabetical", numbers are
  // assigned alphabetically so that inline [1] matches bibliography [1].
  let numberedMap = appearanceOrder;
  if (citationSettings.style === "numbered" && citationSettings.ordering === "alphabetical") {
    // Build alphabetically-sorted entries to assign stable numbers
    const alphaEntries: Array<{ paperId: string; sortKey: string }> = [];
    for (const src of data.sources) {
      const paper = data.papers.get(src.paperId);
      if (!paper) continue;
      // Only include sources that are actually cited
      if (!appearanceOrder.has(src.paperId)) continue;
      const authorStr = formatAuthors(paper.authors);
      const yearStr = paper.year ? `(${paper.year})` : "(o.J.)";
      alphaEntries.push({
        paperId: src.paperId,
        sortKey: `${authorStr} ${yearStr}. ${paper.title}`,
      });
    }
    alphaEntries.sort((a, b) =>
      a.sortKey.localeCompare(b.sortKey, "de", { sensitivity: "base" })
    );
    numberedMap = new Map<string, number>();
    alphaEntries.forEach((e, i) => numberedMap.set(e.paperId, i + 1));
  }

  // Pass 2: Compile each section with style-aware rendering, threading
  // a global footnote counter (continuous 1..N) and per-chapter equation
  // counters (e.g. (2.1), (2.2), (3.1)).
  let globalFootnoteCounter = 1;
  const equationCounters = new Map<string, number>();
  const mainSections = sortedSections.map((section) => {
    const body = data.sectionContents.get(section._id) ?? "";
    const chapterNum = section.orderNumber.split(".")[0];
    const eqStart = equationCounters.get(chapterNum) ?? 1;
    const { html, footnotes, nextFootnoteNumber, nextEquationNumber } = renderSectionToHtml(
      body,
      sourceMap,
      allFigures,
      figureNumbers,
      data.figureUrls,
      data.papers,
      citationSettings,
      numberedMap,
      globalFootnoteCounter,
      section.orderNumber,
      eqStart
    );
    globalFootnoteCounter = nextFootnoteNumber;
    equationCounters.set(chapterNum, nextEquationNumber);

    return {
      sectionId: section._id,
      title: section.title,
      orderNumber: section.orderNumber,
      depth: section.depth,
      renderedBody: html,
      footnotes,
    };
  });

  const bibliography = generateBibliography(
    data.sources,
    data.papers,
    citationSettings,
    appearanceOrder
  );

  return {
    titlePage,
    abstractDE: metadata?.abstractDE ?? "",
    abstractEN: metadata?.abstractEN ?? "",
    keywordsDE: metadata?.keywordsDE ?? [],
    keywordsEN: metadata?.keywordsEN ?? [],
    tableOfContents: toc,
    listOfFigures,
    mainSections,
    bibliography,
    declarationText: DECLARATION_TEXT,
    layoutSettings,
    citationSettings,
  };
}

// ── TOC generation ───────────────────────────────────────────────────

/// Generates table of contents entries from sorted sections.
export function generateTOC(sections: OutlineSectionDoc[]): TOCEntry[] {
  return sections.map((s) => ({
    orderNumber: s.orderNumber,
    title: s.title,
    depth: s.depth,
  }));
}

// ── List of figures ──────────────────────────────────────────────────

/// Generates the Abbildungsverzeichnis from figures across all sections.
export function generateListOfFigures(
  sections: OutlineSectionDoc[],
  figuresMap: Map<string, FigureDoc[]>
): FigureListEntry[] {
  const figNumberInput = sections.map((s) => ({
    orderNumber: s.orderNumber,
    figures: (figuresMap.get(s._id) ?? []).map((f) => ({
      _id: f._id,
      orderIndex: f.orderIndex,
    })),
  }));
  const numbers = computeFigureNumbers(figNumberInput);

  const entries: FigureListEntry[] = [];
  for (const section of sections) {
    const figs = figuresMap.get(section._id) ?? [];
    const sorted = [...figs].sort((a, b) => a.orderIndex - b.orderIndex);
    for (const fig of sorted) {
      const num = numbers.get(fig._id);
      if (num !== undefined) {
        entries.push({
          figureNumber: num,
          caption: fig.caption,
          sectionOrderNumber: section.orderNumber,
        });
      }
    }
  }

  return entries;
}

// ── Section body rendering ───────────────────────────────────────────

/// Renders a section body to HTML, replacing citation/figure/formula markers.
/// Accepts citation settings to render citations in the selected style (HKA
/// footnotes, numbered [1], or Author-Year). Threads global/per-chapter
/// counters across sections.
export function renderSectionToHtml(
  body: string,
  sourceMap: Map<string, Doc<"sources">>,
  figureMap: Map<string, FigureDoc>,
  figureNumbers: Map<string, number>,
  figureUrls: Map<string, string>,
  papers: Map<string, PaperDoc>,
  citationSettings: CitationSettings,
  appearanceOrder: Map<string, number>,
  startingFootnoteNumber?: number,
  sectionOrderNumber?: string,
  startingEquationNumber?: number
): { html: string; footnotes: FootnoteRenderEntry[]; nextFootnoteNumber: number; nextEquationNumber: number } {
  if (!body.trim()) return { html: "", footnotes: [], nextFootnoteNumber: startingFootnoteNumber ?? 1, nextEquationNumber: startingEquationNumber ?? 1 };

  const footnotes: FootnoteRenderEntry[] = [];
  let footnoteCounter = startingFootnoteNumber ?? 1;
  let equationCounter = startingEquationNumber ?? 1;
  /// Top-level chapter number extracted from orderNumber (e.g. "2" from "2.1.3")
  const chapterNumber = sectionOrderNumber?.split(".")[0] ?? "";

  // We process the body by finding all markers and replacing them in order.
  // Build a list of all replaceable segments.
  interface Segment {
    start: number;
    end: number;
    replacement: string;
    type: "citation" | "figure" | "formula";
  }

  const segments: Segment[] = [];

  // 1. Citations — style-aware rendering
  const citations = parseCitations(body);
  for (const c of citations) {
    // Find the first unclaimed occurrence of this citation marker
    let pos = -1;
    const re = new RegExp(escapeRegex(c.fullMatch), "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const alreadyClaimed = segments.some(
        (s) => m!.index >= s.start && m!.index < s.end
      );
      if (!alreadyClaimed) {
        pos = m.index;
        break;
      }
    }

    if (pos >= 0) {
      const source = sourceMap.get(c.paperId);
      const kuerzel = source?.kuerzel ?? "??";
      const paper = papers.get(c.paperId);
      const prefix = c.citationType === "indirect" ? "Vgl. " : "";
      const vglPrefix = c.citationType === "indirect" ? "vgl. " : "";

      let replacement: string;

      switch (citationSettings.style) {
        case "hkaFootnote": {
          // HKA Kürzel footnote: superscript number → footnote at page bottom
          let footnoteText: string;
          if (c.secondaryPaperId && c.secondaryPageRef) {
            const secSource = sourceMap.get(c.secondaryPaperId);
            const secKuerzel = secSource?.kuerzel ?? "??";
            footnoteText = `${prefix}${kuerzel}, ${c.pageRef} zitiert nach ${secKuerzel}, ${c.secondaryPageRef}.`;
          } else {
            footnoteText = `${prefix}${kuerzel}, ${c.pageRef}.`;
          }
          const num = footnoteCounter++;
          footnotes.push({ number: num, text: footnoteText });
          replacement = `<sup class="footnote-ref">${num}</sup>`;
          break;
        }

        case "numbered": {
          // Numbered [1] style: inline bracket with appearance-order number
          const refNum = appearanceOrder.get(c.paperId) ?? 0;
          let inlineText: string;
          if (c.secondaryPaperId && c.secondaryPageRef) {
            const secNum = appearanceOrder.get(c.secondaryPaperId) ?? 0;
            inlineText = c.citationType === "direct"
              ? `[${refNum}, ${c.pageRef}, zitiert nach ${secNum}]`
              : `[${refNum}, zitiert nach ${secNum}]`;
          } else if (c.citationType === "direct") {
            inlineText = `[${refNum}, ${c.pageRef}]`;
          } else {
            inlineText = `[${refNum}]`;
          }
          replacement = `<span class="citation-numbered">${escapeHtml(inlineText)}</span>`;
          break;
        }

        case "authorYear": {
          // Author-Year (Müller, 2020) style
          const authorSurname = paper?.authors[0]
            ? paper.authors[0].trim().split(/\s+/).pop()
            : "??";
          const yearStr = paper?.year ? String(paper.year) : "o.J.";

          let inlineText: string;
          if (c.secondaryPaperId && c.secondaryPageRef) {
            const secPaper = papers.get(c.secondaryPaperId);
            const secSurname = secPaper?.authors[0]
              ? secPaper.authors[0].trim().split(/\s+/).pop()
              : "??";
            const secYear = secPaper?.year ? String(secPaper.year) : "o.J.";
            inlineText = c.citationType === "direct"
              ? `(${vglPrefix}${authorSurname}, ${yearStr}, ${c.pageRef}, zitiert nach ${secSurname}, ${secYear}, ${c.secondaryPageRef})`
              : `(${vglPrefix}${authorSurname}, ${yearStr}, zitiert nach ${secSurname}, ${secYear}, ${c.secondaryPageRef})`;
          } else if (c.citationType === "direct") {
            inlineText = `(${authorSurname}, ${yearStr}, ${c.pageRef})`;
          } else {
            inlineText = `(${vglPrefix}${authorSurname}, ${yearStr})`;
          }
          replacement = `<span class="citation-author-year">${escapeHtml(inlineText)}</span>`;
          break;
        }
      }

      segments.push({
        start: pos,
        end: pos + c.fullMatch.length,
        replacement,
        type: "citation",
      });
    }
  }

  // 2. Figures
  const figMarkers = parseFigureMarkers(body);
  for (const fm of figMarkers) {
    const alreadyClaimed = segments.some(
      (s) => fm.startIndex >= s.start && fm.startIndex < s.end
    );
    if (!alreadyClaimed) {
      const figure = figureMap.get(fm.figureId);
      const num = figureNumbers.get(fm.figureId);
      const url = figureUrls.get(fm.figureId);

      if (figure && num !== undefined) {
        const imgHtml = url
          ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(figure.caption)}" style="max-width:100%;margin:0 auto;display:block;" />`
          : `<span class="figure-placeholder">[Image not available]</span>`;

        segments.push({
          start: fm.startIndex,
          end: fm.endIndex,
          replacement: `<figure class="thesis-figure"><div class="figure-image">${imgHtml}</div><figcaption>Abbildung ${num}: ${escapeHtml(figure.caption)}</figcaption></figure>`,
          type: "figure",
        });
      } else {
        segments.push({
          start: fm.startIndex,
          end: fm.endIndex,
          replacement: `<span class="orphan-marker">[Missing figure]</span>`,
          type: "figure",
        });
      }
    }
  }

  // 3. Formulas
  const formulas = parseFormulas(body);
  for (const f of formulas) {
    const alreadyClaimed = segments.some(
      (s) => f.startIndex >= s.start && f.startIndex < s.end
    );
    if (!alreadyClaimed) {
      try {
        const rendered = katex.renderToString(f.latex, {
          displayMode: f.displayMode,
          throwOnError: false,
          output: "html",
        });
        let wrapper: string;
        if (f.displayMode) {
          // Display formulas get per-chapter equation numbers like (2.1), (2.2)
          const eqLabel = chapterNumber
            ? `(${chapterNumber}.${equationCounter++})`
            : `(${equationCounter++})`;
          wrapper = `<div class="formula-display"><span class="formula-content">${rendered}</span><span class="formula-number">${eqLabel}</span></div>`;
        } else {
          wrapper = `<span class="formula-inline">${rendered}</span>`;
        }
        segments.push({
          start: f.startIndex,
          end: f.endIndex,
          replacement: wrapper,
          type: "formula",
        });
      } catch {
        segments.push({
          start: f.startIndex,
          end: f.endIndex,
          replacement: `<code class="formula-error">${escapeHtml(f.fullMatch)}</code>`,
          type: "formula",
        });
      }
    }
  }

  // Sort segments by start position and build final HTML
  segments.sort((a, b) => a.start - b.start);

  let html = "";
  let lastEnd = 0;
  for (const seg of segments) {
    // Add plain text between segments, converting newlines to <br>
    html += escapeHtml(body.slice(lastEnd, seg.start)).replace(/\n/g, "<br>");
    html += seg.replacement;
    lastEnd = seg.end;
  }
  // Add remaining text
  html += escapeHtml(body.slice(lastEnd)).replace(/\n/g, "<br>");

  return { html, footnotes, nextFootnoteNumber: footnoteCounter, nextEquationNumber: equationCounter };
}

// ── Bibliography ─────────────────────────────────────────────────────

/// Generates bibliography entries from sources and papers, formatted and
/// ordered according to the active citation settings.
export function generateBibliography(
  sources: Doc<"sources">[],
  papers: Map<string, PaperDoc>,
  citationSettings: CitationSettings,
  appearanceOrder: Map<string, number>
): BibliographyEntry[] {
  const entries: BibliographyEntry[] = [];

  for (const src of sources) {
    const paper = papers.get(src.paperId);
    if (!paper) continue;

    // Only include sources that are actually cited in the thesis content.
    if (!appearanceOrder.has(src.paperId)) continue;

    const authorStr = formatAuthors(paper.authors);
    const yearStr = paper.year ? `(${paper.year})` : "(o.J.)";

    let text = `${authorStr} ${yearStr}. ${paper.title}.`;

    switch (src.sourceType) {
      case "book":
        if (src.publisherLocation && src.publisher) {
          text += ` ${src.publisherLocation}: ${src.publisher}.`;
        }
        break;
      case "bookChapter": {
        const editors = src.editorNames?.length
          ? formatAuthors(src.editorNames)
          : "";
        if (editors) text += ` In ${editors} (Hrsg.),`;
        if (src.editorBookTitle) text += ` ${src.editorBookTitle}.`;
        if (src.publisherLocation && src.publisher) {
          text += ` ${src.publisherLocation}: ${src.publisher}.`;
        }
        if (src.pageStart) {
          text += src.pageEnd
            ? ` S. ${src.pageStart}-${src.pageEnd}.`
            : ` S. ${src.pageStart}.`;
        }
        break;
      }
      case "journalArticle":
        if (src.journalName) text += ` ${src.journalName}.`;
        if (src.volume) text += ` Jahrgang ${src.volume}`;
        if (src.issue) text += `, Heft ${src.issue}`;
        text += ".";
        break;
      case "newspaperArticle":
        if (src.newspaperName) text += ` ${src.newspaperName}.`;
        if (src.publishDate) text += ` Ausgabe vom ${src.publishDate}.`;
        break;
      case "internetSource":
        if (src.accessDate) text += ` Abgerufen am ${src.accessDate}`;
        if (src.url) text += ` von ${src.url}`;
        text += ".";
        break;
    }

    // Kürzel depends on citation style
    let kuerzel: string;
    switch (citationSettings.style) {
      case "hkaFootnote":
        kuerzel = src.kuerzel;
        break;
      case "numbered":
        kuerzel = String(appearanceOrder.get(src.paperId) ?? "?");
        break;
      case "authorYear":
        // Author-Year bibliography has no bracket prefix
        kuerzel = "";
        break;
    }

    entries.push({ kuerzel, formattedText: text, paperId: src.paperId });
  }

  // Sort based on ordering preference
  if (citationSettings.ordering === "appearance") {
    // Sort by first-use order using the appearanceOrder map (works for all styles)
    entries.sort((a, b) => {
      const orderA = appearanceOrder.get(a.paperId) ?? Infinity;
      const orderB = appearanceOrder.get(b.paperId) ?? Infinity;
      return orderA - orderB;
    });
  } else {
    // Alphabetical by formatted text (first author surname)
    entries.sort((a, b) =>
      a.formattedText.localeCompare(b.formattedText, "de", { sensitivity: "base" })
    );
  }

  // For numbered style, assign sequential numbers based on the final sorted order.
  // This ensures bibliography numbers match inline references for both ordering modes.
  if (citationSettings.style === "numbered") {
    entries.forEach((entry, i) => {
      entry.kuerzel = String(i + 1);
    });
  }

  return entries;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatAuthors(authors: string[]): string {
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
