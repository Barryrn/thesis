/// Command-palette style modal for searching across all collected excerpts.
/// Accessible via Cmd+K / Ctrl+K or the search icon in the Dashboard header.
/// Uses client-side filtering on the full excerpt list fetched from Convex.
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Search, X, FileText, Quote } from "lucide-react";
import type { ActiveSection, SectionId } from "@/lib/types";

interface SearchModalProps {
  onClose: () => void;
  /// Called when the user clicks a search result to navigate to that section.
  onSelectSection: (section: ActiveSection) => void;
}

/// Debounce delay in ms before filtering results.
const DEBOUNCE_MS = 200;

/// Maximum number of visible results before scrolling.
const MAX_VISIBLE = 8;

/// Highlights all occurrences of `query` in `text` by wrapping them in <mark>.
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-amber/25 text-foreground rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export default function SearchModal({ onClose, onSelectSection }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const allExcerpts = useQuery(api.matches.getAllExcerptsWithContext) ?? [];

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Auto-focus the search input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Filter excerpts by search query (case-insensitive substring match)
  const filteredResults = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    const lower = debouncedQuery.toLowerCase();
    return allExcerpts.filter(
      (e) =>
        e.excerptText.toLowerCase().includes(lower) ||
        e.relevanceNote.toLowerCase().includes(lower)
    );
  }, [allExcerpts, debouncedQuery]);

  const handleSelect = useCallback(
    (result: (typeof allExcerpts)[number]) => {
      onSelectSection({
        sectionId: result.sectionId as SectionId,
        title: result.sectionTitle,
        orderNumber: result.sectionOrderNumber,
        depth: result.sectionDepth,
        notes: result.sectionNotes,
      });
      onClose();
    },
    [onSelectSection, onClose]
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-lg bg-card border border-border/50 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search excerpts..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-muted-foreground/60 bg-muted/30 rounded border border-border/30 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[min(400px,50vh)] overflow-y-auto">
          {!debouncedQuery.trim() ? (
            <div className="px-4 py-8 text-center">
              <Quote className="size-5 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground/60">
                Type to search across all excerpts
              </p>
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No excerpts match "{debouncedQuery}"
              </p>
            </div>
          ) : (
            <div className="py-1">
              {filteredResults.slice(0, MAX_VISIBLE * 3).map((result) => (
                <button
                  key={result.excerptId}
                  onClick={() => handleSelect(result)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors border-b border-border/10 last:border-b-0"
                >
                  {/* Section label */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] text-amber-dim font-mono">
                      {result.sectionOrderNumber}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {result.sectionTitle}
                    </span>
                  </div>

                  {/* Excerpt text */}
                  <p className="text-sm text-foreground/90 line-clamp-2 leading-relaxed">
                    <HighlightedText text={result.excerptText} query={debouncedQuery} />
                  </p>

                  {/* Paper attribution */}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <FileText className="size-3 text-muted-foreground/40 shrink-0" />
                    <span className="text-[11px] text-muted-foreground truncate">
                      {result.paperTitle}
                      {result.paperAuthors.length > 0 &&
                        ` — ${result.paperAuthors.slice(0, 2).join(", ")}${result.paperAuthors.length > 2 ? " et al." : ""}`}
                    </span>
                  </div>
                </button>
              ))}
              {filteredResults.length > MAX_VISIBLE * 3 && (
                <div className="px-4 py-2 text-center">
                  <p className="text-[11px] text-muted-foreground/50">
                    {filteredResults.length - MAX_VISIBLE * 3} more results — refine your search
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
