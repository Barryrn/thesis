/// Dedicated bibliography (Literaturverzeichnis) page that auto-generates
/// formatted bibliography entries from all registered sources.
/// Respects the active citation style and ordering from thesis metadata.
/// Provides CRUD management of sources via a slide-in sheet.
import { useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { ArrowLeft, Copy, BookOpen, Check, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { formatBibliographyEntry } from "@/lib/citationUtils";
import { DEFAULT_CITATION } from "@/lib/documentCompiler";
import type { CitationSettings } from "@/lib/documentCompiler";
import SourceEditSheet from "./SourceEditSheet";
import type { Doc } from "../../convex/_generated/dataModel";

/// Joined source + paper data type (mirrors listAllSources return).
type SourceWithPaper = Doc<"sources"> & {
  title: string;
  authors: string[];
  year?: number;
  zoteroItemKey?: string;
};

/// Extracts the surname (last whitespace-delimited token) from a full name,
/// used for alphabetical sorting of bibliography entries.
function sortSurname(fullName: string): string {
  return fullName.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
}

/// Renders the full bibliography view with sorted, formatted source entries.
export default function BibliographyPage() {
  const { t } = useTranslation();
  const allSources = useQuery(api.sources.listAllSources) ?? [];
  const metadata = useQuery(api.thesisMetadata.getMetadata);
  const citationSettings: CitationSettings = {
    ...DEFAULT_CITATION,
    ...metadata?.citationSettings,
  };
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<SourceWithPaper | null>(null);

  /// Opens the edit sheet for an existing source.
  const handleEdit = useCallback((source: SourceWithPaper) => {
    setEditingSource(source);
    setSheetOpen(true);
  }, []);

  /// Opens the sheet in create mode.
  const handleAddNew = useCallback(() => {
    setEditingSource(null);
    setSheetOpen(true);
  }, []);

  // Sort sources based on the active ordering preference.
  // "alphabetical" sorts by first author surname; "appearance" is a best-effort
  // order by paper upload date (true appearance order requires section content
  // scanning which is done by the compiler at preview time).
  const sorted = useMemo(() => {
    const copy = [...allSources];
    if (citationSettings.ordering === "appearance") {
      // Approximate appearance order: older papers appear first
      copy.sort((a, b) => {
        const surnameA = a.authors[0] ? sortSurname(a.authors[0]) : "";
        const surnameB = b.authors[0] ? sortSurname(b.authors[0]) : "";
        return surnameA.localeCompare(surnameB, "de");
      });
    } else {
      copy.sort((a, b) => {
        const surnameA = a.authors[0] ? sortSurname(a.authors[0]) : "";
        const surnameB = b.authors[0] ? sortSurname(b.authors[0]) : "";
        return surnameA.localeCompare(surnameB, "de");
      });
    }
    return copy;
  }, [allSources, citationSettings.ordering]);

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
    toast.success(t("bibliography.copiedToClipboard"));
  }, [sorted]);

  /// Copies a single formatted bibliography entry to the clipboard.
  const handleCopySingle = useCallback(
    (sourceId: string, formattedText: string) => {
      navigator.clipboard.writeText(formattedText);
      setCopiedId(sourceId);
      toast.success(t("bibliography.entryCopied"));
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
              title={t("bibliography.backToOverview")}
            >
              <ArrowLeft className="size-5" />
            </button>
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-amber" />
            <h1 className="heading-serif text-xl text-amber">
              {t("bibliography.title")}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            {t("bibliography.sourceCount", { count: sorted.length })}
            {" · "}
            {citationSettings.style === "hkaFootnote"
              ? t("bibliography.formatHka")
              : citationSettings.style === "numbered"
                ? t("bibliography.formatNumbered")
                : t("bibliography.formatAuthorYear")}
          </span>
          <button
            onClick={handleCopyAll}
            disabled={sorted.length === 0}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-border/30 text-muted-foreground hover:text-foreground hover:border-border/50 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Copy className="size-3.5" />
            {t("bibliography.copyAll")}
          </button>
          <button
            onClick={handleAddNew}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-amber text-background hover:bg-amber/90 transition-colors flex items-center gap-1.5 font-medium"
          >
            <Plus className="size-3.5" />
            {t("bibliography.newSource")}
          </button>
        </div>
      </header>

      {/* Bibliography entries */}
      <div className="max-w-4xl mx-auto p-8">
        {sorted.length > 0 ? (
          <div className="space-y-1">
            {sorted.map((source, index) => {
              const entry = formatBibliographyEntry(source, {
                title: source.title,
                authors: source.authors,
                year: source.year,
              });
              // Strip the [Kürzel] prefix from the formatted text for the body display
              const bodyText = entry.replace(`[${source.kuerzel}] `, "");

              // Badge label depends on active citation style
              const badgeLabel =
                citationSettings.style === "numbered"
                  ? String(index + 1)
                  : source.kuerzel;

              return (
                <div
                  key={source._id}
                  className="group flex gap-3 py-3 px-3 rounded-lg hover:bg-muted/10 transition-colors cursor-default"
                >
                  {/* Badge: Kürzel for HKA, number for numbered, hidden for Author-Year */}
                  {citationSettings.style !== "authorYear" && (
                    <span className="font-mono text-[11px] text-amber bg-amber/10 px-2 py-0.5 rounded h-fit whitespace-nowrap shrink-0 mt-0.5">
                      [{badgeLabel}]
                    </span>
                  )}

                  {/* Origin badge */}
                  {source.zoteroItemKey ? (
                    <span className="text-[10px] bg-blue-500/20 text-blue-600 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                      Zotero
                    </span>
                  ) : (
                    <span className="text-[10px] bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                      {t("bibliography.manualBadge")}
                    </span>
                  )}

                  {/* Formatted entry body */}
                  <p className="text-sm text-foreground/80 leading-relaxed flex-1 min-w-0">
                    {bodyText}
                  </p>

                  {/* Action buttons (visible on hover) */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0 self-start">
                    <button
                      onClick={() => handleEdit(source as SourceWithPaper)}
                      className="text-muted-foreground hover:text-amber p-1 rounded-md hover:bg-muted/20"
                      title={t("bibliography.editSource")}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => handleCopySingle(source._id, entry)}
                      className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted/20"
                      title={t("bibliography.copyEntry")}
                    >
                      {copiedId === source._id ? (
                        <Check className="size-3.5 text-green-500" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Empty state */
          <div className="text-center py-20">
            <BookOpen className="size-10 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground text-sm">
              {t("bibliography.emptyTitle")}
            </p>
            <p className="text-muted-foreground/60 text-[11px] mt-1">
              {t("bibliography.emptyDescription")}
            </p>
            <button
              onClick={handleAddNew}
              className="mt-4 text-sm px-4 py-2 rounded-lg bg-amber text-background hover:bg-amber/90 transition-colors inline-flex items-center gap-1.5 font-medium"
            >
              <Plus className="size-4" />
              {t("bibliography.addNewSource")}
            </button>
          </div>
        )}
      </div>

      {/* Source create/edit sheet */}
      <SourceEditSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        source={editingSource}
      />
    </div>
  );
}
