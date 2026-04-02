import { useState, useEffect, useRef, useMemo } from "react";
import { Search } from "lucide-react";
import { buildCitationLabel } from "@/lib/citationUtils";
import type { SectionMatch } from "@/lib/types";

interface CitationPickerProps {
  /// Papers linked to the current section.
  matches: SectionMatch[];
  /// Current search query (text after @).
  query: string;
  /// Pixel position relative to the textarea container.
  anchor: { top: number; left: number };
  /// Fires when the user selects a paper.
  onSelect: (paperId: string, label: string) => void;
  /// Fires when the picker should close.
  onDismiss: () => void;
}

/// Floating dropdown that shows papers available for citation.
/// Positioned near the cursor, filterable by typing after @.
export default function CitationPicker({
  matches,
  query,
  anchor,
  onSelect,
  onDismiss,
}: CitationPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

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

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.children[selectedIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Global keyboard handler for arrow keys and Enter
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const match = filtered[selectedIndex];
        if (match) {
          const label = buildCitationLabel(match.authors, match.year);
          onSelect(match.paperId, label);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [filtered, selectedIndex, onSelect, onDismiss]);

  // Close when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    }
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [onDismiss]);

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
      className="absolute z-50 w-80 rounded-lg border border-border/50 bg-card shadow-lg overflow-hidden"
      style={{ top: anchor.top + 24, left: Math.min(anchor.left, 200) }}
    >
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
          filtered.map((m, i) => {
            const label = buildCitationLabel(m.authors, m.year);
            return (
              <button
                key={m.matchId}
                onClick={() => onSelect(m.paperId, label)}
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
            );
          })
        )}
      </div>
    </div>
  );
}

/// Formats authors for display in the picker list.
function formatAuthorsShort(authors: string[]): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= 2) return authors.join(", ");
  return `${authors[0]}, ${authors[1]} et al.`;
}
