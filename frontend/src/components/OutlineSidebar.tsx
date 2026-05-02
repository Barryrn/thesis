import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { useDroppable } from "@dnd-kit/core";
import { api } from "../../convex/_generated/api";
import { buildSectionTree } from "@/lib/treeBuilder";
import { Badge } from "@/components/ui/badge";
import { Loader2, Pencil, StickyNote, Zap } from "lucide-react";
import type { ActiveSection, SectionId, SectionTreeNode } from "@/lib/types";
import BatchGeneratePanel from "@/components/BatchGeneratePanel";

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
  /// Currently-open batch panel root, or null when no panel is open.
  /// Owned at sidebar level so opening one ⚡ closes any other panel
  /// without each row needing its own state machine.
  const [batchRoot, setBatchRoot] = useState<SectionTreeNode | null>(null);
  const { t } = useTranslation();
  const sections = useQuery(api.outline.listSections) ?? [];
  const tree = useMemo(() => buildSectionTree(sections), [sections]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-sidebar-border flex items-center justify-between">
        <h2 className="heading-serif text-base text-amber">{t("outlineSidebar.outline")}</h2>
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
            <p className="text-sm">{t("outlineSidebar.noOutlineYet")}</p>
            <Link
              to="/upload"
              className="text-xs text-amber hover:underline mt-1 inline-block"
            >
              {t("outlineSidebar.addOutline")}
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
                onBatchGenerate={setBatchRoot}
              />
            ))}
          </div>
        )}
      </div>

      {batchRoot && (
        <BatchGeneratePanel
          rootNode={batchRoot}
          onClose={() => setBatchRoot(null)}
        />
      )}
    </div>
  );
}

interface SidebarSectionNodeProps {
  node: SectionTreeNode;
  depth: number;
  activeSection: ActiveSection | null;
  onSelectSection: (section: ActiveSection | null) => void;
  citingSections: Set<SectionId>;
  /// Open the batch-generate panel rooted at this node. Clicking the ⚡
  /// button on any row routes here so only one panel is ever open.
  onBatchGenerate: (node: SectionTreeNode) => void;
}

function SidebarSectionNode({
  node,
  depth,
  activeSection,
  onSelectSection,
  citingSections,
  onBatchGenerate,
}: SidebarSectionNodeProps) {
  const { t } = useTranslation();
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
    <div ref={setNodeRef} className="group/row relative">
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
        className={`w-full text-left flex items-center gap-1.5 py-1.5 px-2 rounded-md text-sm transition-all ${
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
        {/* ⚡ Generate-subtree affordance — visible on row hover. The
            click handler is on a sibling button overlaying the row's
            right edge so it doesn't trigger the row's onSelectSection. */}
        {/* Spinner shown while /cite is running for this section */}
        {isCiting ? (
          <Loader2 className="size-3 text-amber animate-spin shrink-0" title={t("outlineSidebar.extractingCitations")} />
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

      {/* ⚡ batch-generate trigger. Sibling of the row button so its click
          does not bubble through to onSelectSection. Hidden until the row
          is hovered to keep the sidebar visually quiet at rest. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onBatchGenerate(node);
        }}
        title={`Generate this section${node.children.length > 0 ? " and its subsections" : ""}`}
        aria-label="Generate subtree"
        className="absolute right-1 top-1.5 size-5 rounded flex items-center justify-center text-amber-dim opacity-0 group-hover/row:opacity-100 hover:bg-amber/10 hover:text-amber transition"
      >
        <Zap className="size-3" />
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
              onBatchGenerate={onBatchGenerate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
