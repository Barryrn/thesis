import { useState } from "react";
import { useQuery } from "convex/react";
import { useDroppable } from "@dnd-kit/core";
import { api } from "../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import SectionPapers from "./SectionPapers";
import type { SectionTreeNode } from "@/lib/types";

interface SectionNodeProps {
  node: SectionTreeNode;
  depth: number;
}

export default function SectionNode({ node, depth }: SectionNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const matches = useQuery(api.matches.getMatchesBySection, {
    sectionId: node._id,
  });

  const { setNodeRef, isOver } = useDroppable({
    id: `section-${node._id}`,
    data: { sectionId: node._id },
  });

  const paperCount = matches?.length ?? 0;
  const hasChildren = node.children.length > 0 || paperCount > 0;

  return (
    <div ref={setNodeRef} style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer transition-colors ${
          isOver
            ? "bg-primary/10 ring-2 ring-primary"
            : "hover:bg-muted/50"
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="w-4 text-center text-muted-foreground text-xs">
          {hasChildren ? (expanded ? "\u25BC" : "\u25B6") : ""}
        </span>
        <span className="text-sm text-muted-foreground font-mono">
          {node.orderNumber}
        </span>
        <span className="text-sm font-medium flex-1">{node.title}</span>
        {node.notes && (
          <span
            className="text-[10px] text-amber-dim/50 italic shrink-0"
            title={node.notes}
          >
            (notes)
          </span>
        )}
        {paperCount > 0 && (
          <Badge variant="secondary" className="text-xs">
            {paperCount}
          </Badge>
        )}
      </div>

      {expanded && (
        <>
          <SectionPapers sectionId={node._id} />
          {node.children.map((child) => (
            <SectionNode key={child._id} node={child} depth={depth + 1} />
          ))}
        </>
      )}
    </div>
  );
}
