import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { useDroppable } from "@dnd-kit/core";
import { api } from "../../convex/_generated/api";
import { buildSectionTree } from "@/lib/treeBuilder";
import { Badge } from "@/components/ui/badge";
import { Loader2, Pencil, StickyNote } from "lucide-react";
import type { ActiveSection, SectionId, SectionTreeNode } from "@/lib/types";

interface OutlineSidebarProps {
  activeSection: ActiveSection | null;
  onSelectSection: (section: ActiveSection | null) => void;
  /// Set of section IDs currently being cited via the /cite endpoint.
  citingSections: Set<SectionId>;
}

export default function OutlineSidebar({
  activeSection,
  onSelectSection,
  citingSections,
}: OutlineSidebarProps) {
  const sections = useQuery(api.outline.listSections) ?? [];
  const tree = useMemo(() => buildSectionTree(sections), [sections]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-sidebar-border flex items-center justify-between">
        <h2 className="heading-serif text-base text-amber">Outline</h2>
        <Link
          to="/upload"
          className="text-muted-foreground hover:text-amber transition-colors"
        >
          <Pencil className="size-3.5" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-2">
        {sections.length === 0 ? (
          <div className="text-center py-12 px-4 text-muted-foreground">
            <p className="text-sm">No outline yet</p>
            <Link
              to="/upload"
              className="text-xs text-amber hover:underline mt-1 inline-block"
            >
              Add your thesis outline
            </Link>
          </div>
        ) : (
          <div className="space-y-px">
            {tree.map((node) => (
              <SidebarSectionNode
                key={node._id}
                node={node}
                depth={0}
                activeSection={activeSection}
                onSelectSection={onSelectSection}
                citingSections={citingSections}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface SidebarSectionNodeProps {
  node: SectionTreeNode;
  depth: number;
  activeSection: ActiveSection | null;
  onSelectSection: (section: ActiveSection | null) => void;
  citingSections: Set<SectionId>;
}

function SidebarSectionNode({
  node,
  depth,
  activeSection,
  onSelectSection,
  citingSections,
}: SidebarSectionNodeProps) {
  const matches = useQuery(api.matches.getMatchesBySection, {
    sectionId: node._id,
  });

  const { setNodeRef, isOver } = useDroppable({
    id: `section-${node._id}`,
    // type: "outline-section" tells Dashboard to trigger GPT citation on drop
    // rather than doing a plain manual addMatch.
    data: { type: "outline-section", sectionId: node._id },
  });

  const isCiting = citingSections.has(node._id);

  const paperCount = matches?.length ?? 0;
  const isActive = activeSection?.sectionId === node._id;

  return (
    <div ref={setNodeRef}>
      <button
        onClick={() =>
          onSelectSection(
            isActive
              ? null
              : {
                  sectionId: node._id,
                  title: node.title,
                  orderNumber: node.orderNumber,
                  depth: node.depth,
                  notes: node.notes,
                }
          )
        }
        className={`w-full text-left flex items-center gap-1.5 py-1.5 px-2 rounded-md text-sm transition-all group ${
          isActive
            ? "bg-amber/10 border-l-2 border-amber text-foreground"
            : isOver
              ? "bg-amber/5 ring-1 ring-amber/30"
              : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground border-l-2 border-transparent"
        }`}
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <span className="text-[10px] text-amber-dim font-mono shrink-0 w-6">
          {node.orderNumber}
        </span>
        <span className="truncate flex-1 text-[13px] leading-snug">
          {node.title}
        </span>
        {node.notes && !isCiting && (
          <StickyNote
            className="size-3 text-amber-dim/50 shrink-0"
            title={node.notes}
          />
        )}
        {/* Spinner shown while /cite is running for this section */}
        {isCiting ? (
          <Loader2 className="size-3 text-amber animate-spin shrink-0" title="Extracting citations…" />
        ) : (
          paperCount > 0 && (
            <Badge
              variant="secondary"
              className={`text-[10px] h-4 px-1.5 shrink-0 ${
                isActive
                  ? "bg-amber/20 text-amber"
                  : "bg-sidebar-accent text-muted-foreground"
              }`}
            >
              {paperCount}
            </Badge>
          )
        )}
      </button>

      {node.children.length > 0 && (
        <div className="relative ml-3 border-l border-sidebar-border/50">
          {node.children.map((child) => (
            <SidebarSectionNode
              key={child._id}
              node={child}
              depth={depth + 1}
              activeSection={activeSection}
              onSelectSection={onSelectSection}
              citingSections={citingSections}
            />
          ))}
        </div>
      )}
    </div>
  );
}
