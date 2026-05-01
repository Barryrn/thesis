/// Always-visible row of colored group pills under a paper card's byline.
/// Shows up to `maxVisible` named pills (sorted by group creation order for
/// stable positioning), an overflow "+N" pill when the paper is in more
/// groups, or a dashed "+ Add to group" pill when the paper has none.
/// AI-suggested groups appear inline as dashed translucent pills with
/// inline ✓/✗ buttons. Any pill click opens the shared GroupMenu.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { Check, X } from "lucide-react";
import GroupMenu from "./GroupMenu";
import { api } from "../../convex/_generated/api";
import type {
  GroupId,
  Paper,
  PaperGroup,
  PaperGroupSuggestion,
} from "@/lib/types";

interface GroupPillRowProps {
  paperId: Paper["_id"];
  /// All existing groups (passed from the parent to avoid N+1 queries).
  groups: PaperGroup[];
  /// Group IDs this specific paper belongs to.
  paperGroupIds: Set<GroupId>;
  /// Pending AI suggestions for this paper — rendered as dashed pills with
  /// inline accept/decline. Defaults to empty so existing callers compile.
  suggestions?: PaperGroupSuggestion[];
  /// Maximum named pills before collapsing to "+N". Defaults to 2 — the
  /// middle/right paper cards are dense, so any more crowds the byline.
  maxVisible?: number;
}

/// Base pill geometry shared by all variants. Color/background is layered on
/// top per-variant so the layout stays uniform.
const PILL_BASE =
  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] leading-tight transition-colors cursor-pointer shrink-0 max-w-[140px]";

/// One AI-proposed group, rendered as a dashed translucent pill with two
/// inline icon buttons. Lives inside GroupPillRow so it can share PILL_BASE
/// and the parent's pointer-event handling.
function SuggestionPill({
  group,
  suggestion,
}: {
  group: PaperGroup;
  suggestion: PaperGroupSuggestion;
}) {
  const { t } = useTranslation();
  const accept = useMutation(api.groups.acceptSuggestion);
  const decline = useMutation(api.groups.declineSuggestion);

  return (
    <span
      // Title carries both the AI's reason and the localized label so screen
      // readers and hover both expose the same context.
      title={`${t("groups.suggestion.reason")}: ${suggestion.reason}`}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        borderColor: `${group.color}80`,
        color: group.color,
      }}
      className={`${PILL_BASE} border border-dashed bg-transparent opacity-80 hover:opacity-100`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: group.color }}
      />
      <span className="truncate">{group.name}</span>
      <button
        type="button"
        aria-label={t("groups.suggestion.accept")}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          void accept({ suggestionId: suggestion._id });
        }}
        className="p-0.5 rounded-full hover:bg-emerald-500/20 text-emerald-500 transition-colors"
      >
        <Check className="size-2.5" />
      </button>
      <button
        type="button"
        aria-label={t("groups.suggestion.decline")}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          void decline({ suggestionId: suggestion._id });
        }}
        className="p-0.5 rounded-full hover:bg-muted/60 text-muted-foreground transition-colors"
      >
        <X className="size-2.5" />
      </button>
    </span>
  );
}

export default function GroupPillRow({
  paperId,
  groups,
  paperGroupIds,
  suggestions = [],
  maxVisible = 2,
}: GroupPillRowProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Stable sort by group creation order — keeps a paper's pill positions
  // consistent across renames, recolors, and membership toggles. The user
  // builds spatial memory ("the green pill is always second"), and we don't
  // want to break that just because a different group was edited elsewhere.
  const memberGroups = groups
    .filter((g) => paperGroupIds.has(g._id))
    .sort((a, b) => a.createdAt - b.createdAt);

  const visible = memberGroups.slice(0, maxVisible);
  const hiddenCount = Math.max(0, memberGroups.length - maxVisible);

  // Filter to pending suggestions whose group is still resolvable. A group
  // could have been deleted between the query and render — guard that case.
  const groupById = new Map(groups.map((g) => [g._id, g]));
  const pending = suggestions.filter(
    (s) => s.status === "pending" && groupById.has(s.groupId)
  );

  // Single click handler for every pill: opens the menu where the user can
  // see every group and toggle membership. No separate "..." affordance.
  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setMenuOpen((o) => !o);
  }

  // Drag listeners on parent cards swallow pointerdown events, so we stop
  // propagation here too — otherwise clicking a pill starts a drag.
  function stopPointer(e: React.PointerEvent) {
    e.stopPropagation();
  }

  const hasMembers = memberGroups.length > 0;

  return (
    <div className="relative flex items-center gap-1.5 flex-wrap">
      {!hasMembers && pending.length === 0 ? (
        // Empty-state pill — dashed border, muted, but always present so the
        // affordance is discoverable without hovering.
        <button
          type="button"
          onClick={openMenu}
          onPointerDown={stopPointer}
          aria-label={t("groups.addPillAria")}
          className={`${PILL_BASE} border border-dashed border-border/50 text-muted-foreground hover:text-amber hover:border-amber/40`}
        >
          <span className="text-[13px] leading-none -mt-px">+</span>
          <span className="truncate">{t("groups.addToGroup")}</span>
        </button>
      ) : (
        <>
          {visible.map((g) => (
            <button
              key={g._id}
              type="button"
              onClick={openMenu}
              onPointerDown={stopPointer}
              aria-label={t("groups.pillAria", { name: g.name })}
              // Low-opacity color fill (`${color}20` ≈ 12% alpha) keeps the
              // pill quiet against the card while preserving the group's
              // identity color. Border at ~40% alpha sharpens the shape.
              style={{
                backgroundColor: `${g.color}20`,
                borderColor: `${g.color}55`,
                color: g.color,
              }}
              className={`${PILL_BASE} border hover:brightness-110`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: g.color }}
              />
              <span className="truncate">{g.name}</span>
            </button>
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={openMenu}
              onPointerDown={stopPointer}
              aria-label={t("groups.addToGroup")}
              className={`${PILL_BASE} bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60`}
            >
              +{hiddenCount}
            </button>
          )}
          {pending.map((s) => (
            <SuggestionPill
              key={s._id}
              group={groupById.get(s.groupId)!}
              suggestion={s}
            />
          ))}
        </>
      )}

      {menuOpen && (
        <GroupMenu
          paperId={paperId}
          groups={groups}
          paperGroupIds={paperGroupIds}
          onClose={() => setMenuOpen(false)}
          anchorClassName="left-0 top-7"
        />
      )}
    </div>
  );
}
