/// Popover that lists every group with a checkbox per row, letting the user
/// toggle this paper's membership in each group. Shared by LibraryPaperCard
/// (right panel) and PaperSummaryCard (middle panel) via GroupPillRow.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { Check } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { GroupId, Paper, PaperGroup } from "@/lib/types";

interface GroupMenuProps {
  paperId: Paper["_id"];
  groups: PaperGroup[];
  paperGroupIds: Set<GroupId>;
  onClose: () => void;
  /// Tailwind alignment classes for the absolute popover. Defaults to
  /// `right-0 top-6` (matching the legacy "..."-button anchor); override
  /// when anchoring under a pill row (e.g. `left-0 top-7`).
  anchorClassName?: string;
}

/// Outside-click-to-close, toggle add/remove on each group row. Pure UI —
/// the Convex mutations are the single source of truth for membership state.
export default function GroupMenu({
  paperId,
  groups,
  paperGroupIds,
  onClose,
  anchorClassName = "right-0 top-6",
}: GroupMenuProps) {
  const { t } = useTranslation();
  const addPaperToGroup = useMutation(api.groups.addPaperToGroup);
  const removePaperFromGroup = useMutation(api.groups.removePaperFromGroup);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click. Mousedown (not click) so it fires before any
  // child button's click handler swallows the event.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  async function toggle(groupId: GroupId) {
    if (paperGroupIds.has(groupId)) {
      await removePaperFromGroup({ paperId, groupId });
    } else {
      await addPaperToGroup({ paperId, groupId });
    }
  }

  return (
    <div
      ref={ref}
      className={`absolute ${anchorClassName} z-50 min-w-[180px] rounded-md border border-border/50 bg-popover shadow-md overflow-hidden`}
    >
      <p className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b border-border/30">
        {t("groups.addToGroup")}
      </p>
      {groups.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground/60 italic">
          {t("groups.noGroups")}
        </p>
      ) : (
        groups.map((g) => {
          const inGroup = paperGroupIds.has(g._id);
          return (
            <button
              key={g._id}
              onClick={(e) => {
                e.stopPropagation();
                toggle(g._id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: g.color }}
              />
              <span className="flex-1 text-left truncate">{g.name}</span>
              {inGroup && <Check className="size-3 text-amber shrink-0" />}
            </button>
          );
        })
      )}
    </div>
  );
}
