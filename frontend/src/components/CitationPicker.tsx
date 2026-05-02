import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "convex/react";
import { Search, ArrowLeft } from "lucide-react";
import type { CitationType, SectionMatch } from "@/lib/types";
import {
  collectExistingCitations,
  type ExistingCitation,
} from "@/lib/citationUtils";
import { api } from "../../convex/_generated/api";

/// Props for the two-stage citation picker dropdown.
interface CitationPickerProps {
  /// Papers linked to the current section.
  matches: SectionMatch[];
  /// Current search query (text after @).
  query: string;
  /// Pixel position relative to the textarea container.
  anchor: { top: number; left: number };
  /// Fires when the user confirms the citation with all details.
  /// `excerptText` is the cited passage entered by the user. Required for
  /// direct quotes (`citationType === "direct"`) and optional for indirect
  /// (Vgl.) citations — the picker enforces this gate before calling.
  onSelect: (
    paperId: string,
    citationType: CitationType,
    pageRef: string,
    secondaryPaperId?: string,
    secondaryPageRef?: string,
    excerptText?: string
  ) => void;
  /// Fires when the picker should close.
  onDismiss: () => void;
  /// When set, the picker skips Stage 1 and renders Stage 2 with this paper
  /// preselected. Used by the highlight-to-cite flow, which has already chosen
  /// the paper from the recommender results — Stage 1's filterable list would
  /// be redundant. The paper must exist in `matches`; the parent is responsible
  /// for calling `addMatch` first when surfacing a paper outside the section.
  initialPaperId?: string;
}

/// Floating two-stage citation picker positioned near the cursor.
/// Stage 1: filterable paper list. Stage 2: citation details form.
export default function CitationPicker({
  matches,
  query,
  anchor,
  onSelect,
  onDismiss,
  initialPaperId,
}: CitationPickerProps) {
  // ── Stage 1 state ──
  const [selectedIndex, setSelectedIndex] = useState(0);

  // ── Stage 2 state ──
  const [selectedPaper, setSelectedPaper] = useState<SectionMatch | null>(null);
  const [citationType, setCitationType] = useState<CitationType>("indirect");
  const [pageRef, setPageRef] = useState("");
  const [showSecondary, setShowSecondary] = useState(false);
  const [secondaryPaper, setSecondaryPaper] = useState<SectionMatch | null>(
    null
  );
  const [secondaryPageRef, setSecondaryPageRef] = useState("");
  /// Cited passage entered by the user. Required for direct quotes (so the
  /// thesis later carries the exact text being quoted under the footnote);
  /// optional for indirect/Vgl. citations where the cite is paraphrastic.
  const [excerptText, setExcerptText] = useState("");
  /// Keyboard-highlighted index for the secondary paper sub-list.
  const [secondaryPickerOpen, setSecondaryPickerOpen] = useState(false);
  const [secondarySelectedIndex, setSecondarySelectedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pageRefInputRef = useRef<HTMLInputElement>(null);

  // Fetch every authored section body so we can derive prior citations of
  // the selected paper. The query is cached per session by Convex; the result
  // is parsed on the client to share `parseCitations` with the editor.
  const allSectionBodies = useQuery(api.sectionContent.listAllSectionBodies);

  /// Supporting excerpts already collected for the selected paper, across all
  /// sections. Each excerpt carries `excerptText` + `pageNumber`, so reusing
  /// one fills the entire Stage 2 form (page ref + cited passage) in a click.
  /// The query is gated on `selectedPaper` to avoid fetching for every paper
  /// in the matches list.
  const paperExcerpts = useQuery(
    api.matches.getExcerptsByPaperIds,
    selectedPaper ? { paperIds: [selectedPaper.paperId] } : "skip",
  );

  /// Prior citation tuples (type, pageRef, secondary*) for the selected paper,
  /// extracted from authored section bodies. Used as a *fallback* surface
  /// alongside `paperExcerpts` so previously-inserted citations that have no
  /// stored excerpt are still reusable.
  const existingCitations = useMemo<ExistingCitation[]>(() => {
    if (!selectedPaper || !allSectionBodies) return [];
    const bodies = allSectionBodies.map((r) => r.body);
    return collectExistingCitations(bodies, selectedPaper.paperId);
  }, [selectedPaper, allSectionBodies]);

  /// Pre-fills Stage 2 form fields from a previously-entered citation. The
  /// user can press Insert immediately or tweak any field — page numbers and
  /// excerpts often vary per use even for the same paper.
  const applyExistingCitation = useCallback(
    (existing: ExistingCitation) => {
      setCitationType(existing.citationType);
      setPageRef(existing.pageRef);
      if (existing.secondaryPaperId && existing.secondaryPageRef) {
        const sec = matches.find(
          (m) => m.paperId === existing.secondaryPaperId,
        );
        if (sec) {
          setShowSecondary(true);
          setSecondaryPaper(sec);
          setSecondaryPageRef(existing.secondaryPageRef);
        }
      } else {
        setShowSecondary(false);
        setSecondaryPaper(null);
        setSecondaryPageRef("");
      }
      // Excerpt stays as the user entered it; reusing a prior tuple says
      // nothing about which passage they're quoting now.
      requestAnimationFrame(() => pageRefInputRef.current?.focus());
    },
    [matches],
  );

  /// Pre-fills Stage 2 from a stored supporting excerpt. The page number is
  /// normalised to the HKA-style `S. <n>` form when it isn't already prefixed,
  /// so the user doesn't need to retype "S." for excerpts ingested from the
  /// AI pipeline (which stores bare page numbers like `268`).
  const applyExcerpt = useCallback(
    (excerpt: {
      excerptText: string;
      pageNumber?: string;
    }) => {
      const raw = (excerpt.pageNumber ?? "").trim();
      const normalised = raw
        ? /^s\.\s*/i.test(raw)
          ? raw
          : `S. ${raw}`
        : "";
      setPageRef(normalised);
      setExcerptText(excerpt.excerptText);
      // Don't touch citationType — the user picks indirect/direct themselves.
      // Don't touch secondary state — excerpts are always primary-source.
      requestAnimationFrame(() => pageRefInputRef.current?.focus());
    },
    [],
  );

  /// Papers filtered by the current search query (Stage 1).
  const filtered = useMemo(() => {
    if (!query) return matches;
    const lower = query.toLowerCase();
    return matches.filter(
      (m) =>
        m.title.toLowerCase().includes(lower) ||
        m.authors.some((a) => a.toLowerCase().includes(lower)) ||
        (m.year && String(m.year).includes(lower))
    );
  }, [matches, query]);

  /// Whether the insert button should be active. Direct quotes additionally
  /// require an excerpt — without it the thesis would later have no record
  /// of the exact passage being quoted, which is the whole point of the
  /// "self-cite" UX rule the user asked for.
  const canInsert =
    pageRef.trim().length > 0 &&
    (citationType !== "direct" || excerptText.trim().length > 0);

  /// Transitions from Stage 1 to Stage 2 by selecting a paper.
  const handlePaperSelect = useCallback((paper: SectionMatch) => {
    setSelectedPaper(paper);
    setCitationType("indirect");
    setPageRef("");
    setExcerptText("");
    setShowSecondary(false);
    setSecondaryPaper(null);
    setSecondaryPageRef("");
    setSecondaryPickerOpen(false);
  }, []);

  /// Fires the final onSelect callback with all collected citation details.
  const handleInsert = useCallback(() => {
    if (!selectedPaper || !canInsert) return;
    onSelect(
      selectedPaper.paperId,
      citationType,
      pageRef.trim(),
      secondaryPaper?.paperId,
      secondaryPageRef.trim() || undefined,
      excerptText.trim() || undefined
    );
  }, [
    selectedPaper,
    canInsert,
    onSelect,
    citationType,
    pageRef,
    secondaryPaper,
    secondaryPageRef,
    excerptText,
  ]);

  /// Returns to Stage 1 by clearing the selected paper.
  const handleBack = useCallback(() => {
    setSelectedPaper(null);
  }, []);

  // Reset keyboard selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  // Honour `initialPaperId` from the highlight-to-cite flow: skip Stage 1 and
  // jump straight to Stage 2 with the matching SectionMatch preselected. The
  // effect runs once per `initialPaperId` change so reopening the picker with
  // a different paper still works. We deliberately do nothing when the id
  // isn't in `matches` — the parent guarantees it via `addMatch` before open.
  useEffect(() => {
    if (!initialPaperId) return;
    if (selectedPaper && selectedPaper.paperId === initialPaperId) return;
    const match = matches.find((m) => m.paperId === initialPaperId);
    if (match) {
      setSelectedPaper(match);
      setCitationType("indirect");
      setPageRef("");
      setExcerptText("");
      setShowSecondary(false);
      setSecondaryPaper(null);
      setSecondaryPageRef("");
      setSecondaryPickerOpen(false);
    }
  }, [initialPaperId, matches, selectedPaper]);

  // Scroll the active Stage 1 item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list || selectedPaper) return;
    const active = list.children[selectedIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, selectedPaper]);

  // Auto-focus the page reference input when entering Stage 2
  useEffect(() => {
    if (selectedPaper) {
      // Small delay so the DOM has rendered Stage 2 before we focus
      requestAnimationFrame(() => pageRefInputRef.current?.focus());
    }
  }, [selectedPaper]);

  // Global keyboard handler for both stages
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // ── Stage 2 keyboard handling ──
      if (selectedPaper) {
        if (e.key === "Escape") {
          e.preventDefault();
          onDismiss();
        } else if (e.key === "Enter" && !secondaryPickerOpen) {
          // Enter on the page ref input triggers insert
          e.preventDefault();
          handleInsert();
        }
        return;
      }

      // ── Stage 1 keyboard handling ──
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const match = filtered[selectedIndex];
        if (match) handlePaperSelect(match);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    filtered,
    selectedIndex,
    selectedPaper,
    secondaryPickerOpen,
    onDismiss,
    handlePaperSelect,
    handleInsert,
  ]);

  // Close when clicking outside the container
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onDismiss();
      }
    }
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [onDismiss]);

  // ── Empty state ──
  if (matches.length === 0) {
    return (
      <div
        className="absolute z-50 w-72 rounded-lg border border-border/50 bg-card shadow-lg p-3"
        style={{ top: anchor.top + 24, left: anchor.left }}
      >
        <p className="text-xs text-muted-foreground italic">
          No papers linked to this section yet. Assign papers first.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute z-50 w-80 rounded-lg border border-border/50 bg-card shadow-lg overflow-hidden"
      style={{ top: anchor.top + 24, left: Math.min(anchor.left, 200) }}
    >
      {selectedPaper ? (
        <Stage2Details
          selectedPaper={selectedPaper}
          citationType={citationType}
          setCitationType={setCitationType}
          pageRef={pageRef}
          setPageRef={setPageRef}
          pageRefInputRef={pageRefInputRef}
          excerptText={excerptText}
          setExcerptText={setExcerptText}
          showSecondary={showSecondary}
          setShowSecondary={setShowSecondary}
          secondaryPaper={secondaryPaper}
          setSecondaryPaper={setSecondaryPaper}
          secondaryPageRef={secondaryPageRef}
          setSecondaryPageRef={setSecondaryPageRef}
          secondaryPickerOpen={secondaryPickerOpen}
          setSecondaryPickerOpen={setSecondaryPickerOpen}
          secondarySelectedIndex={secondarySelectedIndex}
          setSecondarySelectedIndex={setSecondarySelectedIndex}
          matches={matches}
          canInsert={canInsert}
          existingCitations={existingCitations}
          onApplyExisting={applyExistingCitation}
          paperExcerpts={paperExcerpts ?? []}
          onApplyExcerpt={applyExcerpt}
          onBack={handleBack}
          onInsert={handleInsert}
          onDismiss={onDismiss}
        />
      ) : (
        <Stage1PaperList
          query={query}
          filtered={filtered}
          selectedIndex={selectedIndex}
          listRef={listRef}
          onSelect={handlePaperSelect}
        />
      )}
    </div>
  );
}

// ── Stage 1: Paper list with search filtering ────────────────────────────

/// Props for the paper list (Stage 1) sub-component.
interface Stage1Props {
  query: string;
  filtered: SectionMatch[];
  selectedIndex: number;
  listRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (paper: SectionMatch) => void;
}

/// Filterable list of papers available for citation.
function Stage1PaperList({
  query,
  filtered,
  selectedIndex,
  listRef,
  onSelect,
}: Stage1Props) {
  return (
    <>
      {/* Search indicator */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
        <Search className="size-3 text-muted-foreground/60" />
        <span className="text-xs text-muted-foreground">
          {query ? `Searching: "${query}"` : "Select a paper to cite"}
        </span>
      </div>

      {/* Results list */}
      <div ref={listRef} className="max-h-48 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 italic px-3 py-2">
            No matching papers found.
          </p>
        ) : (
          filtered.map((m, i) => (
            <button
              key={m.matchId}
              onClick={() => onSelect(m)}
              className={`w-full text-left px-3 py-2 transition-colors ${
                i === selectedIndex
                  ? "bg-amber/10 text-foreground"
                  : "text-foreground/80 hover:bg-muted/30"
              }`}
            >
              <p className="text-sm truncate">{m.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {formatAuthorsShort(m.authors)}
                {m.year ? ` (${m.year})` : ""}
              </p>
            </button>
          ))
        )}
      </div>
    </>
  );
}

// ── Stage 2: Citation details form ───────────────────────────────────────

/// Props for the citation details form (Stage 2) sub-component.
interface Stage2Props {
  selectedPaper: SectionMatch;
  citationType: CitationType;
  setCitationType: (type: CitationType) => void;
  pageRef: string;
  setPageRef: (value: string) => void;
  pageRefInputRef: React.RefObject<HTMLInputElement | null>;
  excerptText: string;
  setExcerptText: (value: string) => void;
  showSecondary: boolean;
  setShowSecondary: (show: boolean) => void;
  secondaryPaper: SectionMatch | null;
  setSecondaryPaper: (paper: SectionMatch | null) => void;
  secondaryPageRef: string;
  setSecondaryPageRef: (value: string) => void;
  secondaryPickerOpen: boolean;
  setSecondaryPickerOpen: (open: boolean) => void;
  secondarySelectedIndex: number;
  setSecondarySelectedIndex: (index: number | ((i: number) => number)) => void;
  matches: SectionMatch[];
  canInsert: boolean;
  /// Prior citations of the selected paper. When non-empty, Stage 2 renders
  /// a "Reuse existing" list above the form so the user can pre-fill fields.
  existingCitations: ExistingCitation[];
  onApplyExisting: (existing: ExistingCitation) => void;
  /// Supporting excerpts collected for the selected paper across all sections.
  /// Each entry pre-fills both the page reference and the cited passage when
  /// the user clicks it — the highest-fidelity reuse surface, since these are
  /// the verbatim quotes already verified for this paper.
  paperExcerpts: Array<{
    _id: string;
    excerptText: string;
    pageNumber?: string;
    relevanceNote?: string;
  }>;
  onApplyExcerpt: (excerpt: { excerptText: string; pageNumber?: string }) => void;
  onBack: () => void;
  onInsert: () => void;
  onDismiss: () => void;
}

/// Inline form for configuring citation type, page reference, and
/// optional secondary source before inserting the citation marker.
function Stage2Details({
  selectedPaper,
  citationType,
  setCitationType,
  pageRef,
  setPageRef,
  pageRefInputRef,
  excerptText,
  setExcerptText,
  showSecondary,
  setShowSecondary,
  secondaryPaper,
  setSecondaryPaper,
  secondaryPageRef,
  setSecondaryPageRef,
  secondaryPickerOpen,
  setSecondaryPickerOpen,
  secondarySelectedIndex,
  setSecondarySelectedIndex,
  matches,
  canInsert,
  existingCitations,
  onApplyExisting,
  paperExcerpts,
  onApplyExcerpt,
  onBack,
  onInsert,
  onDismiss,
}: Stage2Props) {
  const { t } = useTranslation();

  /// Lookup of secondary papers by id so the reuse list can show titles for
  /// `via:` citations without a second query.
  const matchByPaperId = useMemo(() => {
    const m = new Map<string, SectionMatch>();
    for (const sm of matches) m.set(sm.paperId, sm);
    return m;
  }, [matches]);

  /// Papers available as secondary sources (excludes the primary selection).
  const secondaryCandidates = useMemo(
    () => matches.filter((m) => m.paperId !== selectedPaper.paperId),
    [matches, selectedPaper.paperId]
  );

  /// Selects a secondary source paper and closes the sub-picker.
  const pickSecondary = useCallback(
    (paper: SectionMatch) => {
      setSecondaryPaper(paper);
      setSecondaryPickerOpen(false);
    },
    [setSecondaryPaper, setSecondaryPickerOpen]
  );

  // Keyboard navigation for the secondary paper sub-list
  useEffect(() => {
    if (!secondaryPickerOpen) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSecondarySelectedIndex((i: number) =>
          Math.min(i + 1, secondaryCandidates.length - 1)
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSecondarySelectedIndex((i: number) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const match = secondaryCandidates[secondarySelectedIndex];
        if (match) pickSecondary(match);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSecondaryPickerOpen(false);
      }
    }

    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [
    secondaryPickerOpen,
    secondaryCandidates,
    secondarySelectedIndex,
    setSecondarySelectedIndex,
    setSecondaryPickerOpen,
    pickSecondary,
  ]);

  return (
    <div className="flex flex-col">
      {/* Selected paper header with back button */}
      <div className="flex items-start gap-2 px-3 py-2 border-b border-border/30">
        <button
          onClick={onBack}
          className="mt-0.5 p-0.5 rounded hover:bg-muted/30 text-muted-foreground transition-colors shrink-0"
          aria-label="Back to paper list"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <div className="min-w-0">
          <p className="text-sm truncate text-foreground">
            {selectedPaper.title}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatAuthorsShort(selectedPaper.authors)}
            {selectedPaper.year ? ` (${selectedPaper.year})` : ""}
          </p>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-3">
        {/* Supporting-excerpts list — primary reuse surface. Each entry shows
            a quoted passage + page; clicking pre-fills both the cited passage
            and the page reference, so the user can press Insert in one click.
            These are the AI-collected (or user-added) excerpts for this paper
            across every section, so they show up even when the paper has
            never been cited via @ before. */}
        {paperExcerpts.length > 0 && (
          <div className="space-y-1.5 -mx-1 px-1 pb-2 border-b border-border/20">
            <label className="text-[11px] text-muted-foreground">
              {t("citationPicker.reuseExcerpt", "Reuse a supporting excerpt")}
            </label>
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {paperExcerpts.map((ex) => (
                <button
                  key={ex._id}
                  onClick={() =>
                    onApplyExcerpt({
                      excerptText: ex.excerptText,
                      pageNumber: ex.pageNumber,
                    })
                  }
                  className="text-left rounded px-2 py-1.5 bg-muted/10 hover:bg-amber/10 hover:text-amber transition-colors"
                >
                  <p className="text-[11px] text-foreground/80 line-clamp-2 italic">
                    “{ex.excerptText}”
                  </p>
                  {ex.pageNumber && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {/^s\.\s*/i.test(ex.pageNumber)
                        ? ex.pageNumber
                        : `p. ${ex.pageNumber}`}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Reuse-existing list — fallback when prior `{{cite:...}}` markers
            exist for this paper but the underlying excerpt is not (e.g. older
            citations inserted before excerpt collection). Clicking an entry
            pre-fills citation type + page ref; excerpt stays empty. */}
        {existingCitations.length > 0 && (
          <div className="space-y-1.5 -mx-1 px-1 pb-2 border-b border-border/20">
            <label className="text-[11px] text-muted-foreground">
              {t("citationPicker.reuseExisting", "Reuse existing")}
            </label>
            <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
              {existingCitations.map((ec, i) => {
                const secTitle = ec.secondaryPaperId
                  ? matchByPaperId.get(ec.secondaryPaperId)?.title
                  : undefined;
                return (
                  <button
                    key={`${ec.citationType}-${ec.pageRef}-${ec.secondaryPaperId ?? ""}-${ec.secondaryPageRef ?? ""}-${i}`}
                    onClick={() => onApplyExisting(ec)}
                    className="text-left rounded px-2 py-1 text-[11px] bg-muted/10 hover:bg-amber/10 hover:text-amber transition-colors"
                  >
                    <span className="font-medium">
                      {ec.citationType === "direct"
                        ? t("citationPicker.direct")
                        : t("citationPicker.indirect")}
                    </span>
                    <span className="text-muted-foreground"> — {ec.pageRef}</span>
                    {secTitle && ec.secondaryPageRef && (
                      <span className="text-muted-foreground/70 block truncate">
                        via {secTitle} ({ec.secondaryPageRef})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Citation type toggle */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">{t("citationPicker.citationType")}</label>
          <div className="flex gap-1.5">
            <button
              onClick={() => setCitationType("indirect")}
              className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                citationType === "indirect"
                  ? "bg-amber/10 text-amber"
                  : "bg-muted/20 text-muted-foreground hover:bg-muted/30"
              }`}
            >
              {t("citationPicker.indirect")}
            </button>
            <button
              onClick={() => setCitationType("direct")}
              className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                citationType === "direct"
                  ? "bg-amber/10 text-amber"
                  : "bg-muted/20 text-muted-foreground hover:bg-muted/30"
              }`}
            >
              {t("citationPicker.direct")}
            </button>
          </div>
        </div>

        {/* Page reference input */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            {t("citationPicker.pageReference")}
          </label>
          <input
            ref={pageRefInputRef}
            type="text"
            value={pageRef}
            onChange={(e) => setPageRef(e.target.value)}
            placeholder="S. 141"
            className="w-full bg-transparent border border-border/30 rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-amber/40"
          />
          <p className="text-[10px] text-muted-foreground/60">
            {t("citationPicker.pageSuffixHelp")}
          </p>
        </div>

        {/* Cited passage / excerpt. Required for direct quotes — without it
            we'd lose the verbatim text the citation refers to. Optional for
            indirect (Vgl.) cites where the reference is paraphrastic. */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            {t("citationPicker.citedPassage", "Cited passage")}
            {citationType === "direct" && (
              <span className="text-amber ml-1">*</span>
            )}
          </label>
          <textarea
            value={excerptText}
            onChange={(e) => setExcerptText(e.target.value)}
            placeholder={
              citationType === "direct"
                ? t(
                    "citationPicker.citedPassageRequired",
                    "Paste the exact quoted text"
                  )
                : t(
                    "citationPicker.citedPassageOptional",
                    "Paste the passage you're paraphrasing (optional)"
                  )
            }
            rows={3}
            className="w-full bg-transparent border border-border/30 rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-amber/40 resize-y"
          />
          {citationType === "direct" && excerptText.trim().length === 0 && (
            <p className="text-[10px] text-amber/80">
              {t(
                "citationPicker.citedPassageHint",
                "A direct quote requires the passage being cited."
              )}
            </p>
          )}
        </div>

        {/* Secondary source toggle */}
        {!showSecondary ? (
          <button
            onClick={() => setShowSecondary(true)}
            className="text-[11px] text-muted-foreground hover:text-amber transition-colors"
          >
            {t("citationPicker.addSecondary")}
          </button>
        ) : (
          <div className="space-y-2 pt-1 border-t border-border/20">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted-foreground">
                {t("citationPicker.secondarySource")}
              </label>
              <button
                onClick={() => {
                  setShowSecondary(false);
                  setSecondaryPaper(null);
                  setSecondaryPageRef("");
                  setSecondaryPickerOpen(false);
                }}
                className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                {t("common.remove")}
              </button>
            </div>

            {/* Secondary paper selection */}
            {secondaryPaper ? (
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1 bg-muted/10 rounded px-2 py-1">
                  <p className="text-[11px] truncate text-foreground/80">
                    {secondaryPaper.title}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSecondaryPaper(null);
                    setSecondaryPickerOpen(true);
                    setSecondarySelectedIndex(0);
                  }}
                  className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground shrink-0 transition-colors"
                >
                  {t("common.change")}
                </button>
              </div>
            ) : (
              <div className="relative">
                <button
                  onClick={() => {
                    setSecondaryPickerOpen((prev) => !prev);
                    setSecondarySelectedIndex(0);
                  }}
                  className="w-full text-left bg-transparent border border-border/30 rounded px-2 py-1 text-[11px] text-muted-foreground/60"
                >
                  {t("citationPicker.selectSource")}
                </button>
                {secondaryPickerOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded border border-border/30 bg-card shadow-md max-h-32 overflow-y-auto z-10">
                    {secondaryCandidates.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground/60 italic px-2 py-1.5">
                        {t("citationPicker.noMoreSources")}
                      </p>
                    ) : (
                      secondaryCandidates.map((m, i) => (
                        <button
                          key={m.matchId}
                          onClick={() => pickSecondary(m)}
                          className={`w-full text-left px-2 py-1.5 transition-colors ${
                            i === secondarySelectedIndex
                              ? "bg-amber/10 text-foreground"
                              : "text-foreground/80 hover:bg-muted/30"
                          }`}
                        >
                          <p className="text-[11px] truncate">{m.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatAuthorsShort(m.authors)}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Secondary page reference */}
            {secondaryPaper && (
              <input
                type="text"
                value={secondaryPageRef}
                onChange={(e) => setSecondaryPageRef(e.target.value)}
                placeholder="S. 42"
                className="w-full bg-transparent border border-border/30 rounded px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-amber/40"
              />
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onDismiss}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onInsert}
            disabled={!canInsert}
            className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
              canInsert
                ? "bg-amber/10 text-amber hover:bg-amber/20"
                : "bg-muted/10 text-muted-foreground/40 cursor-not-allowed"
            }`}
          >
            {t("citationPicker.insert")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Formats authors for display in the picker list.
/// Shows up to two names; beyond that uses "et al." suffix.
function formatAuthorsShort(authors: string[]): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= 2) return authors.join(", ");
  return `${authors[0]}, ${authors[1]} et al.`;
}
