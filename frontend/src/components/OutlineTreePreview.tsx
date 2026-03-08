import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { List, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import EditableSectionItem from "./EditableSectionItem";
import type { EditableSectionNode } from "@/lib/types";

interface OutlineTreePreviewProps {
  tree: EditableSectionNode[];
  onAddSection: (parentOrderNumber?: string) => void;
  onRemoveSection: (orderNumber: string) => void;
  onRenameSection: (orderNumber: string, newTitle: string) => void;
  onReorder: (newTree: EditableSectionNode[]) => void;
}

export default function OutlineTreePreview({
  tree,
  onAddSection,
  onRemoveSection,
  onRenameSection,
  onReorder,
}: OutlineTreePreviewProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Find which sibling list both items belong to
    const result = findAndReorder(tree, activeId, overId);
    if (result) onReorder(result);
  }

  if (tree.length === 0) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium">Preview</label>
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border border-dashed rounded-lg">
          <List className="size-8 mb-2 opacity-50" />
          <p className="text-sm font-medium">No sections yet</p>
          <p className="text-xs mt-1">Type in the editor or add sections here</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => onAddSection()}
          >
            <Plus className="size-4 mr-1" /> Add Section
          </Button>
        </div>
      </div>
    );
  }

  const allIds = collectIds(tree);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Preview</label>
      <div className="border rounded-lg p-3 space-y-0.5 max-h-[28rem] overflow-y-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
            {tree.map((node) => (
              <EditableSectionItem
                key={node.id}
                node={node}
                depth={0}
                onAdd={onAddSection}
                onRemove={onRemoveSection}
                onRename={onRenameSection}
              />
            ))}
          </SortableContext>
        </DndContext>
        <button
          onClick={() => onAddSection()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1.5 px-2 w-full rounded-md hover:bg-muted/50 transition-colors"
        >
          <Plus className="size-3" /> Add section
        </button>
      </div>
    </div>
  );
}

function collectIds(nodes: EditableSectionNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    ids.push(...collectIds(node.children));
  }
  return ids;
}

function findAndReorder(
  roots: EditableSectionNode[],
  activeId: string,
  overId: string
): EditableSectionNode[] | null {
  // Check if both are at the root level
  const activeIdx = roots.findIndex((n) => n.id === activeId);
  const overIdx = roots.findIndex((n) => n.id === overId);
  if (activeIdx !== -1 && overIdx !== -1) {
    return arrayMove([...roots], activeIdx, overIdx);
  }

  // Check children of each node
  for (let i = 0; i < roots.length; i++) {
    const childActiveIdx = roots[i].children.findIndex(
      (n) => n.id === activeId
    );
    const childOverIdx = roots[i].children.findIndex((n) => n.id === overId);
    if (childActiveIdx !== -1 && childOverIdx !== -1) {
      const newRoots = roots.map((r) => ({ ...r, children: [...r.children] }));
      newRoots[i].children = arrayMove(
        newRoots[i].children,
        childActiveIdx,
        childOverIdx
      );
      return newRoots;
    }

    // Recurse deeper
    const result = findAndReorder(roots[i].children, activeId, overId);
    if (result) {
      const newRoots = roots.map((r) => ({ ...r, children: [...r.children] }));
      newRoots[i].children = result;
      return newRoots;
    }
  }

  return null;
}
