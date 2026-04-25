import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Loader2, Settings, Sparkles } from "lucide-react";
import { compileDocument, DEFAULT_LAYOUT, DEFAULT_CITATION } from "@/lib/documentCompiler";
import type { FigureDoc, PaperDoc, LayoutSettings, CitationSettings } from "@/lib/documentCompiler";
import type { AiPromptSettings } from "@/lib/types";
import LayoutSettingsPanel from "./LayoutSettingsPanel";
import AiPromptsSettingsPanel from "./AiPromptsSettingsPanel";
import { useBaselinePrompts } from "@/hooks/useBaselinePrompts";
import "@/styles/hka-preview.css";
import "katex/dist/katex.min.css";

interface ThesisPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/// Converts an integer to lowercase roman numerals (1→i, 2→ii, etc.)
function toRoman(num: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"];
  let result = "";
  for (let i = 0; i < vals.length; i++) {
    while (num >= vals[i]) {
      result += syms[i];
      num -= vals[i];
    }
  }
  return result;
}

/// Formats a page number according to the chosen numbering format.
/// `section` indicates whether this is a "front" (front matter) or "main" (body) page.
function formatPageNum(
  num: number,
  format: LayoutSettings["pageNumbering"]["format"],
  section: "front" | "main"
): string {
  switch (format) {
    case "allArabic":
      return String(num);
    case "allRoman":
      return toRoman(num);
    case "automatic":
    default:
      return section === "front" ? toRoman(num) : String(num);
  }
}

/// Full-page modal rendering the complete thesis in HKA format.
/// Fetches all data via the batch getThesisData query and compiles
/// the document using documentCompiler. Renders each logical page
/// as a separate A4-sized card with visible page numbers.
export default function ThesisPreviewModal({
  open,
  onOpenChange,
}: ThesisPreviewModalProps) {
  const data = useQuery(api.thesisExport.getThesisData);
  const contentRef = useRef<HTMLDivElement>(null);
  /// Which sidebar panel is active: "none" | "layout" | "ai".
  const [activePanel, setActivePanel] = useState<"none" | "layout" | "ai">("none");
  const updateLayoutMutation = useMutation(api.thesisMetadata.updateLayoutSettings);
  const updateCitationMutation = useMutation(api.thesisMetadata.updateCitationSettings);
  const updateAiPromptsMutation = useMutation(api.thesisMetadata.updateAiPromptSettings);
  const layoutSaveRef = useRef<ReturnType<typeof setTimeout>>();
  const citationSaveRef = useRef<ReturnType<typeof setTimeout>>();
  const aiPromptsSaveRef = useRef<ReturnType<typeof setTimeout>>();
  const { baselines } = useBaselinePrompts();

  /// Clear pending debounce timers on unmount to prevent stale mutations.
  useEffect(() => {
    return () => {
      if (layoutSaveRef.current) clearTimeout(layoutSaveRef.current);
      if (citationSaveRef.current) clearTimeout(citationSaveRef.current);
      if (aiPromptsSaveRef.current) clearTimeout(aiPromptsSaveRef.current);
    };
  }, []);

  /// Debounced auto-save of layout settings to Convex.
  const handleLayoutChange = useCallback(
    (newSettings: LayoutSettings) => {
      if (layoutSaveRef.current) clearTimeout(layoutSaveRef.current);
      layoutSaveRef.current = setTimeout(() => {
        updateLayoutMutation({ layoutSettings: newSettings });
      }, 500);
    },
    [updateLayoutMutation]
  );

  /// Debounced auto-save of citation settings to Convex.
  const handleCitationChange = useCallback(
    (newSettings: CitationSettings) => {
      if (citationSaveRef.current) clearTimeout(citationSaveRef.current);
      citationSaveRef.current = setTimeout(() => {
        updateCitationMutation({ citationSettings: newSettings });
      }, 500);
    },
    [updateCitationMutation]
  );

  /// Debounced auto-save of AI prompt settings to Convex.
  const handleAiPromptsChange = useCallback(
    (newSettings: AiPromptSettings) => {
      if (aiPromptsSaveRef.current) clearTimeout(aiPromptsSaveRef.current);
      aiPromptsSaveRef.current = setTimeout(() => {
        updateAiPromptsMutation({ aiPromptSettings: newSettings });
      }, 500);
    },
    [updateAiPromptsMutation]
  );

  /// Clears all global AI prompt overrides, reverting to baselines.
  const handleAiPromptsReset = useCallback(() => {
    if (aiPromptsSaveRef.current) clearTimeout(aiPromptsSaveRef.current);
    updateAiPromptsMutation({
      aiPromptSettings: {},
    });
  }, [updateAiPromptsMutation]);

  /// Resets layout and citation settings to HKA defaults.
  const handleReset = useCallback(() => {
    if (layoutSaveRef.current) clearTimeout(layoutSaveRef.current);
    if (citationSaveRef.current) clearTimeout(citationSaveRef.current);
    updateLayoutMutation({ layoutSettings: DEFAULT_LAYOUT });
    updateCitationMutation({ citationSettings: DEFAULT_CITATION });
  }, [updateLayoutMutation, updateCitationMutation]);

  /// Transform raw Convex data into DocumentData shape for the compiler.
  const compiled = useMemo(() => {
    if (!data) return null;

    const sectionContents = new Map<string, string>();
    for (const [id, body] of Object.entries(data.sectionContents)) {
      sectionContents.set(id, body);
    }

    const figures = new Map<string, FigureDoc[]>();
    const figureUrls = new Map<string, string>();
    for (const fig of data.figures) {
      const list = figures.get(fig.sectionId) ?? [];
      list.push(fig);
      figures.set(fig.sectionId, list);
      if (fig.url) figureUrls.set(fig._id, fig.url);
    }

    const papers = new Map<string, PaperDoc>();
    for (const [id, p] of Object.entries(data.papers)) {
      papers.set(id, p as PaperDoc);
    }

    return compileDocument({
      metadata: data.metadata,
      sections: data.sections,
      sectionContents,
      figures,
      figureUrls,
      sources: data.sources,
      papers,
    });
  }, [data]);

  /// Scrolls the preview to a section by its order number.
  const scrollToSection = (orderNumber: string) => {
    const el = contentRef.current?.querySelector(
      `[data-section="${orderNumber}"]`
    );
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /// Title page info fields — mirrors the DOCX builder's info_fields list.
  /// Only renders fields that have a non-empty value.
  const titleInfoFields = compiled
    ? [
        { label: "Name", value: compiled.titlePage.studentName },
        { label: "Adresse", value: compiled.titlePage.studentAddress },
        { label: "E-Mail (privat)", value: compiled.titlePage.studentEmail },
        { label: "E-Mail (Hochschule)", value: compiled.titlePage.universityEmail },
        { label: "Matrikelnummer", value: compiled.titlePage.matrikelnummer },
        { label: "Studiengang", value: compiled.titlePage.studiengang },
        { label: "Erstprüfer", value: compiled.titlePage.erstpruefer },
        { label: "Zweitprüfer", value: compiled.titlePage.zweitpruefer },
        { label: "Abgabedatum", value: compiled.titlePage.abgabedatum },
      ].filter((f) => f.value)
    : [];

  // Determine the top-level depth dynamically (may be 0 or 1 depending
  // on how the outline was built in the editor).
  const minDepth = compiled
    ? compiled.mainSections.length > 0
      ? Math.min(...compiled.mainSections.map((s) => s.depth))
      : 0
    : 0;

  // Resolved layout settings (never undefined thanks to compileDocument defaults).
  const layout = compiled?.layoutSettings ?? DEFAULT_LAYOUT;

  /// CSS custom properties injected on the preview container so the
  /// stylesheet picks up user-configured values.
  const layoutCssVars = {
    "--thesis-font-size": `${layout.fontSize}pt`,
    "--thesis-line-spacing": layout.lineSpacing,
    "--thesis-margin-top": `${layout.margins.top}cm`,
    "--thesis-margin-bottom": `${layout.margins.bottom}cm`,
    "--thesis-margin-left": `${layout.margins.left}cm`,
    "--thesis-margin-right": `${layout.margins.right}cm`,
    "--thesis-pagenumber-top":
      layout.pageNumbering.position === "header" ? "1cm" : "auto",
    "--thesis-pagenumber-bottom":
      layout.pageNumbering.position === "footer" ? "1cm" : "auto",
  } as React.CSSProperties;

  // Track page numbers: title page has none, front matter uses roman, main uses arabic
  const startPage = layout.pageNumbering.startPage;
  let romanCounter = startPage;
  let arabicCounter = startPage;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-full !max-w-5xl overflow-hidden flex flex-col"
      >
        <SheetHeader className="shrink-0 flex flex-row items-center gap-2 pr-12">
          <SheetTitle>Thesis Preview</SheetTitle>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() =>
                setActivePanel((v) => (v === "ai" ? "none" : "ai"))
              }
              className={`p-1.5 rounded-md transition-colors ${
                activePanel === "ai"
                  ? "bg-amber/20 text-amber"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="AI prompt settings"
            >
              <Sparkles className="size-4" />
            </button>
            <button
              onClick={() =>
                setActivePanel((v) => (v === "layout" ? "none" : "layout"))
              }
              className={`p-1.5 rounded-md transition-colors ${
                activePanel === "layout"
                  ? "bg-amber/20 text-amber"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Layout settings"
            >
              <Settings className="size-4" />
            </button>
          </div>
        </SheetHeader>

        {!compiled ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="size-8 animate-spin text-amber" />
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar: layout settings, AI prompts, or mini-TOC */}
            {activePanel === "layout" ? (
              <LayoutSettingsPanel
                layoutSettings={compiled.layoutSettings}
                citationSettings={compiled.citationSettings ?? DEFAULT_CITATION}
                onChange={handleLayoutChange}
                onCitationChange={handleCitationChange}
                onReset={handleReset}
              />
            ) : activePanel === "ai" ? (
              <AiPromptsSettingsPanel
                aiPromptSettings={data?.metadata?.aiPromptSettings as AiPromptSettings | undefined}
                baselines={baselines}
                onChange={handleAiPromptsChange}
                onReset={handleAiPromptsReset}
              />
            ) : (
              <nav className="w-48 shrink-0 border-r border-border/30 overflow-y-auto p-3 space-y-0.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Navigation
                </p>
                {compiled.tableOfContents.map((entry) => (
                  <button
                    key={entry.orderNumber}
                    onClick={() => scrollToSection(entry.orderNumber)}
                    className="block w-full text-left text-xs text-muted-foreground hover:text-foreground truncate transition-colors"
                    style={{ paddingLeft: `${(entry.depth - minDepth) * 12}px` }}
                  >
                    <span className="text-muted-foreground/60 mr-1">
                      {entry.orderNumber}
                    </span>
                    {entry.title}
                  </button>
                ))}
              </nav>
            )}

            {/* Main preview content — A4 pages with gaps */}
            <div
              ref={contentRef}
              className="flex-1 overflow-y-auto hka-preview-container"
              style={layoutCssVars}
            >
              {/* ── Deckblatt (no page number) ─────────────────────── */}
              <div className="hka-page">
                <div className="hka-preview">
                  <div className="hka-title-page">
                    <div className="thesis-type">Masterarbeit</div>
                    <div className="thesis-title">
                      {compiled.titlePage.titleDE}
                    </div>
                    {compiled.titlePage.subtitleDE && (
                      <div className="thesis-subtitle">
                        {compiled.titlePage.subtitleDE}
                      </div>
                    )}
                    {compiled.titlePage.titleEN && (
                      <div className="thesis-title" style={{ fontSize: "14pt", marginTop: "0.5cm" }}>
                        {compiled.titlePage.titleEN}
                      </div>
                    )}
                    {compiled.titlePage.subtitleEN && (
                      <div className="thesis-subtitle">
                        {compiled.titlePage.subtitleEN}
                      </div>
                    )}
                    <div className="thesis-vorlage">
                      Masterarbeit vorgelegt zur Erlangung des Mastergrades der
                      Hochschule Karlsruhe – Technik und Wirtschaft
                    </div>
                    <div className="thesis-info">
                      {titleInfoFields.map(({ label, value }) => (
                        <div key={label}>
                          <span className="label">{label}:</span> {value}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Front matter pages (roman page numbers) ────────── */}

              {/* Kurzfassung */}
              {compiled.abstractDE && (
                <div className="hka-page">
                  <div className="hka-page-number">{formatPageNum(romanCounter++, layout.pageNumbering.format, "front")}</div>
                  <div className="hka-preview">
                    <div className="hka-abstract">
                      <h1>Kurzfassung</h1>
                      <p>{compiled.abstractDE}</p>
                      {compiled.keywordsDE.length > 0 && (
                        <p className="keywords">
                          <strong>Schlüsselbegriffe:</strong>{" "}
                          {compiled.keywordsDE.join(", ")}
                        </p>
                      )}
                    </div>

                    {compiled.abstractEN && (
                      <div className="hka-abstract" style={{ marginTop: "1cm" }}>
                        <h1>Abstract</h1>
                        <p>{compiled.abstractEN}</p>
                        {compiled.keywordsEN.length > 0 && (
                          <p className="keywords">
                            <strong>Keywords:</strong>{" "}
                            {compiled.keywordsEN.join(", ")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Inhaltsverzeichnis */}
              <div className="hka-page">
                <div className="hka-page-number">{formatPageNum(romanCounter++, layout.pageNumbering.format, "front")}</div>
                <div className="hka-preview">
                  <h1>Inhaltsverzeichnis</h1>
                  <div>
                    {compiled.tableOfContents.map((entry) => (
                      <div
                        key={entry.orderNumber}
                        className={`hka-toc-entry depth-${Math.min(entry.depth - minDepth, 3)}`}
                      >
                        <span className="toc-number">{entry.orderNumber}</span>
                        <span className="toc-title">{entry.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Abbildungsverzeichnis */}
              {compiled.listOfFigures.length > 0 && (
                <div className="hka-page">
                  <div className="hka-page-number">{formatPageNum(romanCounter++, layout.pageNumbering.format, "front")}</div>
                  <div className="hka-preview">
                    <h1>Abbildungsverzeichnis</h1>
                    <div>
                      {compiled.listOfFigures.map((fig) => (
                        <div key={fig.figureNumber} className="hka-toc-entry depth-0">
                          <span className="toc-number">Abb. {fig.figureNumber}</span>
                          <span className="toc-title">{fig.caption}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Main content pages (arabic page numbers) ──────── */}
              {/* Group sections by top-level chapter: each section at the minimum
                  depth starts a new page card, deeper sections flow inside it. */}
              {(() => {
                const chapterGroups: (typeof compiled.mainSections)[] = [];
                for (const section of compiled.mainSections) {
                  if (section.depth === minDepth) {
                    chapterGroups.push([section]);
                  } else if (chapterGroups.length > 0) {
                    chapterGroups[chapterGroups.length - 1].push(section);
                  }
                }
                return chapterGroups.map((group) => {
                  const pageNum = arabicCounter++;
                  return (
                    <div key={group[0].sectionId} className="hka-page">
                      <div className="hka-page-number">{formatPageNum(pageNum, layout.pageNumbering.format, "main")}</div>
                      <div className="hka-preview">
                        {group.map((section) => {
                          const HeadingTag = `h${Math.min(section.depth - minDepth + 1, 4)}` as keyof JSX.IntrinsicElements;
                          return (
                            <div key={section.sectionId} data-section={section.orderNumber}>
                              <HeadingTag>
                                {section.orderNumber} {section.title}
                              </HeadingTag>
                              {section.renderedBody && (
                                <div
                                  className="section-body"
                                  dangerouslySetInnerHTML={{ __html: section.renderedBody }}
                                />
                              )}
                              {/* Footnotes only shown for HKA Kürzel style */}
                              {compiled.citationSettings.style === "hkaFootnote" &&
                                section.footnotes.length > 0 && (
                                <div className="hka-footnotes">
                                  <ol style={{ listStyle: "none", padding: 0 }}>
                                    {section.footnotes.map((fn) => (
                                      <li key={fn.number}>
                                        <sup>{fn.number}</sup> {fn.text}
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}

              {/* ── Literaturverzeichnis ───────────────────────────── */}
              {compiled.bibliography.length > 0 && (
                <div className="hka-page">
                  <div className="hka-page-number">{formatPageNum(arabicCounter++, layout.pageNumbering.format, "main")}</div>
                  <div className="hka-preview">
                    <h1>Literaturverzeichnis</h1>
                    {compiled.bibliography.map((entry, i) => (
                      <div key={i} className="hka-bib-entry">
                        {entry.kuerzel && (
                          <><span className="bib-kuerzel">[{entry.kuerzel}]</span>{" "}</>
                        )}
                        {entry.formattedText}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Eidesstattliche Erklärung ─────────────────────── */}
              <div className="hka-page">
                <div className="hka-page-number">{formatPageNum(arabicCounter++, layout.pageNumbering.format, "main")}</div>
                <div className="hka-preview">
                  <h1>Eidesstattliche Erklärung</h1>
                  <div className="hka-declaration">
                    <p>{compiled.declarationText}</p>
                    <div className="signature-line">
                      <span>Ort, Datum</span>
                      <span>Unterschrift</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
