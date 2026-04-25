import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Search, ArrowLeft } from "lucide-react";
import type { CitationType, SectionMatch } from "@/lib/types";

/// Props for the two-stage citation picker dropdown.
interface CitationPickerProps {
  /// Papers linked to the current section.
  matches: SectionMatch[];
  /// Current search query (text after @).
  query: string;
  /// Pixel position relative to the textarea container.
  anchor: { top: number; left: number };
  /// Fires when the user confirms the citation with all details.
  onSelect: (
    paperId: string,
    citationType: CitationType,
    pageRef: string,
    secondaryPaperId?: string,
    secondaryPageRef?: string
  ) => void;
  /// Fires when the picker should close.
  onDismiss: () => void;
}

/// Floating two-stage citation picker positioned near the cursor.
/// Stage 1: filterable paper list. Stage 2: citation details form.
export default function CitationPicker({
  matches,
  query,
  anchor,
  onSelect,
  onDismiss,
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
  /// Keyboard-highlighted index for the secondary paper sub-list.
  const [secondaryPickerOpen, setSecondaryPickerOpen] = useState(false);
  const [secondarySelectedIndex, setSecondarySelectedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pageRefInputRef = useRef<HTMLInputElement>(null);

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

  /// Whether the insert button should be active.
  const canInsert = pageRef.trim().length > 0;

  /// Transitions from Stage 1 to Stage 2 by selecting a paper.
  const handlePaperSelect = useCallback((paper: SectionMatch) => {
    setSelectedPaper(paper);
    setCitationType("indirect");
    setPageRef("");
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
      secondaryPageRef.trim() || undefined
    );
  }, [
    selectedPaper,
    canInsert,
    onSelect,
    citationType,
    pageRef,
    secondaryPaper,
    secondaryPageRef,
  ]);

  /// Returns to Stage 1 by clearing the selected paper.
  const handleBack = useCallback(() => {
    setSelectedPaper(null);
  }, []);

  // Reset keyboard selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

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
  onBack,
  onInsert,
  onDismiss,
}: Stage2Props) {
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
        {/* Citation type toggle */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Zitattyp</label>
          <div className="flex gap-1.5">
            <button
              onClick={() => setCitationType("indirect")}
              className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                citationType === "indirect"
                  ? "bg-amber/10 text-amber"
                  : "bg-muted/20 text-muted-foreground hover:bg-muted/30"
              }`}
            >
              Indirekt
            </button>
            <button
              onClick={() => setCitationType("direct")}
              className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                citationType === "direct"
                  ? "bg-amber/10 text-amber"
                  : "bg-muted/20 text-muted-foreground hover:bg-muted/30"
              }`}
            >
              Direkt
            </button>
          </div>
        </div>

        {/* Page reference input */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            Seitenverweis
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
            Suffixe: f. (folgende), ff. (fortfolgende)
          </p>
        </div>

        {/* Secondary source toggle */}
        {!showSecondary ? (
          <button
            onClick={() => setShowSecondary(true)}
            className="text-[11px] text-muted-foreground hover:text-amber transition-colors"
          >
            + Sekundärquelle
          </button>
        ) : (
          <div className="space-y-2 pt-1 border-t border-border/20">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted-foreground">
                Sekundärquelle
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
                Entfernen
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
                  Ändern
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
                  Quelle auswählen…
                </button>
                {secondaryPickerOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded border border-border/30 bg-card shadow-md max-h-32 overflow-y-auto z-10">
                    {secondaryCandidates.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground/60 italic px-2 py-1.5">
                        Keine weiteren Quellen verfügbar.
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
            Abbrechen
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
            Einfügen
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
