/// Draggable paper card rendered inside DocumentLibrary. Shows title,
/// authors, status dot, optional "Unassigned" badge, a group-assignment
/// menu ("..."), expand toggle for summary preview, and a delete button.
import { useState, useRef, useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, GripVertical, Trash2, MoreHorizontal, Check } from "lucide-react";
import type { Paper, DragData, PaperGroup, GroupId } from "@/lib/types";

interface LibraryPaperCardProps {
  paper: Paper;
  isUnassigned: boolean;
  onPreview: (paper: Paper) => void;
  sortable?: boolean;
  /// All existing groups (passed from DocumentLibrary to avoid N+1 queries).
  groups: PaperGroup[];
  /// The set of group IDs this specific paper already belongs to.
  paperGroupIds: Set<GroupId>;
}

const statusColors: Record<string, string> = {
  completed: "bg-sage",
  processing: "bg-dusty-blue",
  pending: "bg-dusty-blue/50",
  failed: "bg-destructive",
};

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= 2) return authors.join(", ");
  return `${authors[0]} et al.`;
}

/// Dropdown panel listing all groups with checkboxes to add/remove this paper.
function GroupMenu({
  paperId,
  groups,
  paperGroupIds,
  onClose,
}: {
  paperId: Paper["_id"];
  groups: PaperGroup[];
  paperGroupIds: Set<GroupId>;
  onClose: () => void;
}) {
  const addPaperToGroup = useMutation(api.groups.addPaperToGroup);
  const removePaperFromGroup = useMutation(api.groups.removePaperFromGroup);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
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
      className="absolute right-0 top-6 z-50 min-w-[160px] rounded-md border border-border/50 bg-popover shadow-md overflow-hidden"
    >
      <p className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b border-border/30">
        Add to group
      </p>
      {groups.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground/60 italic">
          No groups yet
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

export default function LibraryPaperCard({
  paper,
  isUnassigned,
  onPreview,
  sortable = false,
  groups,
  paperGroupIds,
}: LibraryPaperCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const deletePaper = useMutation(api.papers.deletePaper);

  const dragData = {
    type: "paper-card",
    paperId: paper._id,
    sourceSectionId: null,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    relevanceScore: 0,
    isManualOverride: false,
  } satisfies DragData;

  const sortableResult = useSortable({
    id: paper._id,
    data: dragData,
    disabled: !sortable,
  });

  const draggableResult = useDraggable({
    id: `paper-library-${paper._id}`,
    data: dragData,
    disabled: sortable,
  });

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = sortable ? sortableResult : draggableResult;

  const style = sortable
    ? {
        transform: CSS.Transform.toString(sortableResult.transform),
        transition: sortableResult.transition ?? undefined,
      }
    : transform
      ? { transform: CSS.Translate.toString(transform) }
      : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!isDragging && paper.status === "completed") {
          onPreview(paper);
        }
      }}
      className={`group/card rounded-md border border-border/30 bg-card/50 hover:border-amber/20 transition-all ${
        isDragging
          ? "opacity-40 cursor-grabbing"
          : paper.status === "completed"
            ? "cursor-pointer"
            : "cursor-grab"
      } active:cursor-grabbing`}
    >
      <div className="p-3 flex items-start gap-2.5">
        {/* Drag hint */}
        <div className="opacity-0 group-hover/card:opacity-100 transition-opacity text-muted-foreground/30 mt-1 shrink-0">
          <GripVertical className="size-3" />
        </div>

        {/* Status dot */}
        <div
          className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${statusColors[paper.status] ?? "bg-muted-foreground"}`}
        />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate leading-snug">
            {paper.title}
          </p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {formatAuthors(paper.authors)}
            {paper.year ? ` (${paper.year})` : ""}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isUnassigned && (
            <Badge
              variant="outline"
              className="text-[10px] h-4 px-1.5 border-amber/20 text-amber-dim"
            >
              Unassigned
            </Badge>
          )}

          {/* Delete button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (window.confirm(`Delete "${paper.title}"? This will remove the paper and all its associated data.`)) {
                deletePaper({ paperId: paper._id });
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="opacity-0 group-hover/card:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5"
          >
            <Trash2 className="size-3.5" />
          </button>

          {/* Group assignment menu ("...") */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setGroupMenuOpen((o) => !o);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="opacity-0 group-hover/card:opacity-100 text-muted-foreground hover:text-foreground transition-all p-0.5"
              title="Add to group"
            >
              <MoreHorizontal className="size-3.5" />
            </button>

            {groupMenuOpen && (
              <GroupMenu
                paperId={paper._id}
                groups={groups}
                paperGroupIds={paperGroupIds}
                onClose={() => setGroupMenuOpen(false)}
              />
            )}
          </div>

          {paper.status === "completed" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setExpanded(!expanded);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Expandable summary preview */}
      {expanded && <ExpandedSummary paperId={paper._id} />}
    </div>
  );
}

function ExpandedSummary({
  paperId,
}: {
  paperId: Paper["_id"];
}) {
  const summary = useQuery(api.summaries.getSummaryByPaper, { paperId });

  if (summary === undefined) {
    return (
      <div className="px-3 pb-3 pt-0">
        <div className="h-2.5 bg-muted/50 rounded animate-pulse w-3/4" />
      </div>
    );
  }

  if (summary === null) {
    return (
      <div className="px-3 pb-3 pt-0">
        <p className="text-xs text-muted-foreground italic">Not processed</p>
      </div>
    );
  }

  return (
    <div className="px-3 pb-3 pt-0 border-t border-border/20 mt-0">
      <div className="pt-2 space-y-2">
        {summary.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {summary.keywords.slice(0, 4).map((kw) => (
              <span
                key={kw}
                className="text-[10px] px-1.5 py-0.5 rounded-full border border-dusty-blue/20 text-dusty-blue"
              >
                {kw}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-foreground/70 leading-relaxed line-clamp-3">
          {summary.researchQuestion}
        </p>
      </div>
    </div>
  );
}
