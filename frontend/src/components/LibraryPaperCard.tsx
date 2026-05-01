/// Draggable paper card rendered inside DocumentLibrary. Shows title,
/// authors, status dot, optional "Unassigned" badge, an always-visible
/// group pill row (click any pill to manage memberships), an expand
/// toggle for summary preview, and a delete button.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, GripVertical, Trash2, Square } from "lucide-react";
import { PROCESSING_STEP_LABELS } from "@/lib/types";
import type { Paper, DragData, PaperGroup, GroupId } from "@/lib/types";
import GroupPillRow from "./GroupPillRow";

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


/// Formats author list for display; accepts a fallback string for empty lists.
function formatAuthors(authors: string[], unknownLabel: string): string {
  if (authors.length === 0) return unknownLabel;
  if (authors.length <= 2) return authors.join(", ");
  return `${authors[0]} et al.`;
}

export default function LibraryPaperCard({
  paper,
  isUnassigned,
  onPreview,
  sortable = false,
  groups,
  paperGroupIds,
}: LibraryPaperCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
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
          {/* Title row with action buttons */}
          <div className="flex items-start gap-1.5">
            <p className="text-sm font-medium text-foreground leading-snug line-clamp-2 flex-1 min-w-0">
              {paper.title}
            </p>

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
              className="opacity-0 group-hover/card:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5 shrink-0 mt-0.5"
            >
              <Trash2 className="size-3.5" />
            </button>

            {paper.status === "completed" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setExpanded(!expanded);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5 shrink-0 mt-0.5"
              >
                <ChevronDown
                  className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
            )}
          </div>

          {/* Subtitle + badges row */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <p className="text-xs text-muted-foreground truncate">
              {formatAuthors(paper.authors, t("libraryCard.unknownAuthors"))}
              {paper.year ? ` (${paper.year})` : ""}
            </p>

            {/* Origin badge */}
            {paper.zoteroItemKey ? (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 border-blue-500/20 text-blue-500"
              >
                {t("common.zotero")}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 border-border/30 text-muted-foreground"
              >
                {t("common.manual")}
              </Badge>
            )}

            {isUnassigned && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 border-amber/20 text-amber-dim"
              >
                {t("libraryCard.unassigned")}
              </Badge>
            )}
          </div>

          {/* Always-visible group pills — single source of truth for
              membership display and editing on this card. Replaces the
              hover-only "..." menu that hid group info from view. */}
          <div className="mt-1.5">
            <GroupPillRow
              paperId={paper._id}
              groups={groups}
              paperGroupIds={paperGroupIds}
            />
          </div>

          {paper.status === "processing" && paper.processingStep && (
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[10px] text-dusty-blue animate-pulse">
                {PROCESSING_STEP_LABELS[paper.processingStep] ?? t("libraryCard.processing")}
              </p>
              {/* Stop button — hard-deletes the paper and any partial Convex state.
                  Python detects the deletion at its next stage boundary and exits. */}
              <button
                type="button"
                aria-label={t("libraryCard.stopProcessing")}
                title={t("libraryCard.stopProcessing")}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(t("libraryCard.stopProcessingConfirm", { title: paper.title }))) {
                    deletePaper({ paperId: paper._id });
                  }
                }}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <Square className="w-3 h-3" />
              </button>
            </div>
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
  const { t } = useTranslation();
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
        <p className="text-xs text-muted-foreground italic">{t("libraryCard.notProcessed")}</p>
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
