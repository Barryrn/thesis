import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import PaperDetailSheet from "./PaperDetailSheet";
import type { PaperId, SectionId, DragData } from "@/lib/types";

interface PaperCardProps {
  paperId: PaperId;
  title: string;
  authors: string[];
  year?: number;
  relevanceScore: number;
  isManualOverride: boolean;
  isDraggable?: boolean;
  sourceSectionId: SectionId | null;
}

function getScoreBadge(score: number) {
  if (score >= 0.7)
    return {
      label: "Strong",
      className: "bg-green-500 hover:bg-green-500 text-white",
    };
  if (score >= 0.5)
    return {
      label: "Possible",
      className: "bg-yellow-500 hover:bg-yellow-500 text-white",
    };
  return {
    label: "Weak",
    className: "bg-red-500 hover:bg-red-500 text-white",
  };
}

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= 2) return authors.join(", ");
  return `${authors[0]}, ${authors[1]} et al.`;
}

export default function PaperCard({
  paperId,
  title,
  authors,
  year,
  relevanceScore,
  isManualOverride,
  isDraggable: draggable = false,
  sourceSectionId,
}: PaperCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const dragId = `paper-${sourceSectionId ?? "unassigned"}-${paperId}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: dragId,
      data: {
        type: "paper-card",
        paperId,
        sourceSectionId,
        title,
        authors,
        year,
        relevanceScore,
        isManualOverride,
      } satisfies DragData,
      disabled: !draggable,
    });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  const badge = getScoreBadge(relevanceScore);

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <div
        ref={draggable ? setNodeRef : undefined}
        style={style}
        {...(draggable ? { ...attributes, ...listeners } : {})}
        className={`${isDragging ? "opacity-50" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <Card className="mb-2 hover:shadow-md transition-shadow">
          <CardContent className="p-3 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <button
                className="text-left font-semibold text-sm hover:underline truncate block w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  setSheetOpen(true);
                }}
              >
                {title}
              </button>
              <p className="text-xs text-muted-foreground truncate">
                {formatAuthors(authors)}
                {year ? ` (${year})` : ""}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge className={`text-xs ${badge.className}`}>
                {badge.label}
              </Badge>
              {isManualOverride && (
                <span className="text-xs text-muted-foreground">Manual</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      {sheetOpen && (
        <PaperDetailSheet
          paperId={paperId}
          title={title}
          authors={authors}
          year={year}
        />
      )}
    </Sheet>
  );
}
