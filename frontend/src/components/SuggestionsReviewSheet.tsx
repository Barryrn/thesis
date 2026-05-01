/// Right-side drawer that lists pending AI group suggestions. Defaults to
/// every suggestion across the library (opened from the GroupsSection
/// header badge); pass `groupId` to scope it to one group's suggestions
/// (opened from the per-group "See suggested papers" menu entry).
///
/// Suggestions are grouped by paper. Papers with a single pending suggestion
/// render as the original single-row layout (paper info + group pill + ✓/✗).
/// Papers with multiple pending suggestions render as a combined card: the
/// paper title/authors appear once, each suggested group lists below with
/// its own ✓/✗, and accept-all / decline-all bulk controls sit at the
/// bottom. The per-row buttons remain authoritative; bulk buttons are a
/// convenience that fans out to the same per-suggestion mutations.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "convex/react";
import { Check, X, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "../../convex/_generated/api";
import type { GroupId, PaperId, SuggestionId } from "@/lib/types";

interface SuggestionsReviewSheetProps {
  /// Called when the user dismisses the sheet (close button or backdrop).
  onClose: () => void;
  /// Restricts the listing to one group. When omitted, every pending
  /// suggestion in the library is shown.
  groupId?: GroupId;
  /// Optional group name to render in the sheet title when scoped.
  groupName?: string;
}

/// Shape of one row returned by `listPendingSuggestions` after server-side
/// denormalization. Declared locally so the grouped helpers below can be
/// typed without re-deriving it from the Convex API types.
type SuggestionRow = {
  _id: SuggestionId;
  paperId: PaperId;
  groupId: GroupId;
  confidence?: number;
  reason?: string;
  createdAt: number;
  paperTitle: string;
  paperAuthors: string[];
  groupName: string;
  groupColor: string;
};

/// One paper plus all of its pending suggestions. Built by `useMemo` from
/// the flat query result — see grouping logic inside the component.
interface PaperGroupedSuggestions {
  paperId: PaperId;
  paperTitle: string;
  paperAuthors: string[];
  suggestions: SuggestionRow[];
}

/// Color-tinted pill identifying the suggested group. Extracted so the
/// single-row layout and the multi-suggestion sub-rows render an identical
/// visual.
function GroupPill({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border max-w-[160px]"
      style={{
        backgroundColor: `${color}20`,
        borderColor: `${color}55`,
        color,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

/// Compact ✓/✗ pair shared by both layouts. `vertical` stacks them (single
/// layout, where they live in a side column) vs lays them inline (combined
/// layout, where each sub-row is one horizontal line).
function AcceptDeclineButtons({
  onAccept,
  onDecline,
  vertical,
}: {
  onAccept: () => void;
  onDecline: () => void;
  vertical: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={vertical ? "flex flex-col gap-1 shrink-0" : "flex items-center gap-1 shrink-0"}>
      <button
        type="button"
        aria-label={t("groups.suggestion.accept")}
        title={t("groups.suggestion.accept")}
        onClick={onAccept}
        className="p-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 transition-colors"
      >
        <Check className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={t("groups.suggestion.decline")}
        title={t("groups.suggestion.decline")}
        onClick={onDecline}
        className="p-1 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export default function SuggestionsReviewSheet({
  onClose,
  groupId,
  groupName,
}: SuggestionsReviewSheetProps) {
  const { t } = useTranslation();
  // listPendingSuggestions denormalizes paper/group fields server-side so
  // each row renders without further queries. Passing `groupId` scopes
  // the query to one group via the by_group index.
  const rows = useQuery(
    api.groups.listPendingSuggestions,
    groupId ? { groupId } : {}
  ) as SuggestionRow[] | undefined;
  const accept = useMutation(api.groups.acceptSuggestion);
  const decline = useMutation(api.groups.declineSuggestion);

  // Group rows by paperId so a paper proposed for several groups collapses
  // into one card. First-seen order is preserved (Map insertion order)
  // which keeps the list stable as the underlying query refreshes.
  const grouped = useMemo<PaperGroupedSuggestions[] | undefined>(() => {
    if (!rows) return undefined;
    const map = new Map<PaperId, PaperGroupedSuggestions>();
    for (const s of rows) {
      const existing = map.get(s.paperId);
      if (existing) {
        existing.suggestions.push(s);
      } else {
        map.set(s.paperId, {
          paperId: s.paperId,
          paperTitle: s.paperTitle,
          paperAuthors: s.paperAuthors,
          suggestions: [s],
        });
      }
    }
    return Array.from(map.values());
  }, [rows]);

  // Scoped sheet shows the group name in the title; library-wide sheet
  // uses the generic "AI suggestions" label.
  const title =
    groupId && groupName
      ? t("groups.suggestions.titleForGroup", { name: groupName })
      : t("groups.suggestions.title");

  /// Renders the paper's title + author byline, shared by both layouts.
  function PaperHeader({ paper }: { paper: PaperGroupedSuggestions }) {
    return (
      <div className="space-y-1">
        <p
          className="text-sm font-medium text-foreground truncate"
          title={paper.paperTitle}
        >
          {paper.paperTitle}
        </p>
        {paper.paperAuthors.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">
            {paper.paperAuthors.slice(0, 2).join(", ")}
            {paper.paperAuthors.length > 2 ? " et al." : ""}
          </p>
        )}
      </div>
    );
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber" />
            {title}
          </SheetTitle>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-2">
          {grouped === undefined ? null : grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {t("groups.suggestions.empty")}
            </p>
          ) : (
            grouped.map((paper) => {
              // Single-suggestion case keeps the original side-by-side
              // layout (paper info on the left, ✓/✗ stacked on the right)
              // so the dominant case looks identical to before.
              if (paper.suggestions.length === 1) {
                const s = paper.suggestions[0];
                return (
                  <div
                    key={paper.paperId}
                    className="flex items-start gap-2 rounded-md border border-border/50 bg-card p-3"
                  >
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <PaperHeader paper={paper} />
                      <GroupPill name={s.groupName} color={s.groupColor} />
                      {s.reason && (
                        <p className="text-[11px] text-muted-foreground italic">
                          “{s.reason}”
                        </p>
                      )}
                    </div>
                    <AcceptDeclineButtons
                      vertical
                      onAccept={() => void accept({ suggestionId: s._id })}
                      onDecline={() => void decline({ suggestionId: s._id })}
                    />
                  </div>
                );
              }

              // Combined card: paper info renders once, each suggestion is
              // its own sub-row with inline ✓/✗, and the bulk buttons fan
              // out to the per-suggestion mutations.
              return (
                <div
                  key={paper.paperId}
                  className="rounded-md border border-border/50 bg-card p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <PaperHeader paper={paper} />
                    </div>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                      {t("groups.suggestions.countForPaper", { count: paper.suggestions.length })}
                    </span>
                  </div>

                  <ul className="space-y-1.5">
                    {paper.suggestions.map((s) => (
                      <li
                        key={s._id}
                        className="flex items-start gap-2 rounded-sm bg-muted/20 px-2 py-1.5"
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <GroupPill name={s.groupName} color={s.groupColor} />
                          {s.reason && (
                            <p className="text-[11px] text-muted-foreground italic line-clamp-2">
                              “{s.reason}”
                            </p>
                          )}
                        </div>
                        <AcceptDeclineButtons
                          vertical={false}
                          onAccept={() => void accept({ suggestionId: s._id })}
                          onDecline={() => void decline({ suggestionId: s._id })}
                        />
                      </li>
                    ))}
                  </ul>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/40">
                    <button
                      type="button"
                      onClick={() =>
                        void Promise.all(
                          paper.suggestions.map((s) =>
                            decline({ suggestionId: s._id })
                          )
                        )
                      }
                      className="text-[11px] px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      {t("groups.suggestions.declineAll")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void Promise.all(
                          paper.suggestions.map((s) =>
                            accept({ suggestionId: s._id })
                          )
                        )
                      }
                      className="text-[11px] px-2 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 transition-colors inline-flex items-center gap-1"
                    >
                      <Check className="size-3" />
                      {t("groups.suggestions.acceptAll")}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
