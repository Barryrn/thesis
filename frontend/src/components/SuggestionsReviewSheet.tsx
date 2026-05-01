/// Right-side drawer that lists pending AI group suggestions. Defaults to
/// every suggestion across the library (opened from the GroupsSection
/// header badge); pass `groupId` to scope it to one group's suggestions
/// (opened from the per-group "See suggested papers" menu entry). Each row
/// shows the paper title, suggested group pill, AI rationale, and ✓/✗
/// buttons that reuse the same accept/decline mutations as the inline pills.
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "convex/react";
import { Check, X, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "../../convex/_generated/api";
import type { GroupId } from "@/lib/types";

interface SuggestionsReviewSheetProps {
  /// Called when the user dismisses the sheet (close button or backdrop).
  onClose: () => void;
  /// Restricts the listing to one group. When omitted, every pending
  /// suggestion in the library is shown.
  groupId?: GroupId;
  /// Optional group name to render in the sheet title when scoped.
  groupName?: string;
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
  );
  const accept = useMutation(api.groups.acceptSuggestion);
  const decline = useMutation(api.groups.declineSuggestion);

  // Scoped sheet shows the group name in the title; library-wide sheet
  // uses the generic "AI suggestions" label.
  const title =
    groupId && groupName
      ? t("groups.suggestions.titleForGroup", { name: groupName })
      : t("groups.suggestions.title");

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
          {rows === undefined ? null : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {t("groups.suggestions.empty")}
            </p>
          ) : (
            rows.map((s) => (
              <div
                key={s._id}
                className="flex items-start gap-2 rounded-md border border-border/50 bg-card p-3"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <p
                    className="text-sm font-medium text-foreground truncate"
                    title={s.paperTitle}
                  >
                    {s.paperTitle}
                  </p>
                  {s.paperAuthors.length > 0 && (
                    <p className="text-xs text-muted-foreground truncate">
                      {s.paperAuthors.slice(0, 2).join(", ")}
                      {s.paperAuthors.length > 2 ? " et al." : ""}
                    </p>
                  )}
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border"
                    style={{
                      backgroundColor: `${s.groupColor}20`,
                      borderColor: `${s.groupColor}55`,
                      color: s.groupColor,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: s.groupColor }}
                    />
                    {s.groupName}
                  </span>
                  {s.reason && (
                    <p className="text-[11px] text-muted-foreground italic">
                      “{s.reason}”
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label={t("groups.suggestion.accept")}
                    title={t("groups.suggestion.accept")}
                    onClick={() => void accept({ suggestionId: s._id })}
                    className="p-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 transition-colors"
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("groups.suggestion.decline")}
                    title={t("groups.suggestion.decline")}
                    onClick={() => void decline({ suggestionId: s._id })}
                    className="p-1 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
