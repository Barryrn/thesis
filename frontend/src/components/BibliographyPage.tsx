/// Dedicated bibliography (Literaturverzeichnis) page that auto-generates
/// formatted bibliography entries from all registered sources.
/// Sorts entries alphabetically by first author surname (German locale)
/// and provides a one-click "copy all" action for pasting into the thesis.
import { useMemo, useCallback, useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { ArrowLeft, Copy, BookOpen, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { formatBibliographyEntry } from "@/lib/citationUtils";

/// Extracts the surname (last whitespace-delimited token) from a full name,
/// used for alphabetical sorting of bibliography entries.
function sortSurname(fullName: string): string {
  return fullName.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
}

/// Renders the full bibliography view with sorted, formatted source entries.
export default function BibliographyPage() {
  const allSources = useQuery(api.sources.listAllSources) ?? [];
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sort alphabetically by first author's surname using German locale
  const sorted = useMemo(() => {
    return [...allSources].sort((a, b) => {
      const surnameA = a.authors[0] ? sortSurname(a.authors[0]) : "";
      const surnameB = b.authors[0] ? sortSurname(b.authors[0]) : "";
      return surnameA.localeCompare(surnameB, "de");
    });
  }, [allSources]);

  /// Copies every formatted bibliography entry to the clipboard,
  /// separated by double newlines for easy pasting.
  const handleCopyAll = useCallback(() => {
    const text = sorted
      .map((s) =>
        formatBibliographyEntry(s, {
          title: s.title,
          authors: s.authors,
          year: s.year,
        })
      )
      .join("\n\n");
    navigator.clipboard.writeText(text);
    toast.success("Literaturverzeichnis in die Zwischenablage kopiert");
  }, [sorted]);

  /// Copies a single formatted bibliography entry to the clipboard.
  const handleCopySingle = useCallback(
    (sourceId: string, formattedText: string) => {
      navigator.clipboard.writeText(formattedText);
      setCopiedId(sourceId);
      toast.success("Eintrag kopiert");
      // Reset the copied indicator after a short delay
      setTimeout(() => setCopiedId(null), 2000);
    },
    []
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header bar */}
      <header className="sticky top-0 z-30 h-14 border-b border-border/50 px-5 flex items-center justify-between shrink-0 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link to="/">
            <button
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted/20"
              title="Zurück zur Übersicht"
            >
              <ArrowLeft className="size-5" />
            </button>
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-amber" />
            <h1 className="heading-serif text-xl text-amber">
              Literaturverzeichnis
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            {sorted.length} {sorted.length === 1 ? "Quelle" : "Quellen"}
          </span>
          <button
            onClick={handleCopyAll}
            disabled={sorted.length === 0}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-border/30 text-muted-foreground hover:text-foreground hover:border-border/50 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Copy className="size-3.5" />
            Alle kopieren
          </button>
        </div>
      </header>

      {/* Bibliography entries */}
      <div className="max-w-4xl mx-auto p-8">
        {sorted.length > 0 ? (
          <div className="space-y-1">
            {sorted.map((source) => {
              const entry = formatBibliographyEntry(source, {
                title: source.title,
                authors: source.authors,
                year: source.year,
              });
              // Strip the [Kürzel] prefix from the formatted text for the body display
              const bodyText = entry.replace(`[${source.kuerzel}] `, "");

              return (
                <div
                  key={source._id}
                  className="group flex gap-3 py-3 px-3 rounded-lg hover:bg-muted/10 transition-colors cursor-default"
                >
                  {/* Kürzel badge */}
                  <span className="font-mono text-[11px] text-amber bg-amber/10 px-2 py-0.5 rounded h-fit whitespace-nowrap shrink-0 mt-0.5">
                    [{source.kuerzel}]
                  </span>

                  {/* Formatted entry body */}
                  <p className="text-sm text-foreground/80 leading-relaxed flex-1 min-w-0">
                    {bodyText}
                  </p>

                  {/* Per-entry copy button (visible on hover) */}
                  <button
                    onClick={() => handleCopySingle(source._id, entry)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted/20 shrink-0 self-start"
                    title="Eintrag kopieren"
                  >
                    {copiedId === source._id ? (
                      <Check className="size-3.5 text-green-500" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          /* Empty state */
          <div className="text-center py-20">
            <BookOpen className="size-10 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground text-sm">
              Noch keine Quellen vorhanden.
            </p>
            <p className="text-muted-foreground/60 text-[11px] mt-1">
              Lade Papers hoch und pflege die Bibliographie-Details ein.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
