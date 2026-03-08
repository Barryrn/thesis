import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EditableSectionNode } from "@/lib/types";

interface EditableSectionItemProps {
  node: EditableSectionNode;
  depth: number;
  onAdd: (parentOrderNumber?: string) => void;
  onRemove: (orderNumber: string) => void;
  onRename: (orderNumber: string, newTitle: string) => void;
}

export default function EditableSectionItem({
  node,
  depth,
  onAdd,
  onRemove,
  onRename,
}: EditableSectionItemProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(node.title);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  function commitRename() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== node.title) {
      onRename(node.orderNumber, trimmed);
    }
    setEditing(false);
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className="group flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-muted/50"
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        <span
          className="size-4 flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab shrink-0"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </span>
        <span className="text-xs text-muted-foreground font-mono w-8 shrink-0">
          {node.orderNumber}
        </span>
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            className="flex-1 text-sm bg-transparent border-b border-primary outline-none py-0"
          />
        ) : (
          <span
            className="flex-1 text-sm cursor-text"
            onClick={() => {
              setEditing(true);
              setEditValue(node.title);
            }}
          >
            {node.title}
          </span>
        )}
        {node.notes && !editing && (
          <span
            className="text-[10px] text-muted-foreground/50 italic truncate max-w-[120px] shrink-0"
            title={node.notes}
          >
            /* {node.notes.length > 20 ? node.notes.slice(0, 20) + "..." : node.notes} */
          </span>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => onAdd(node.orderNumber)}
            title="Add child section"
          >
            <Plus className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => onRemove(node.orderNumber)}
            title="Remove section"
          >
            <Trash2 className="size-3 text-destructive" />
          </Button>
        </div>
      </div>
      {node.children.map((child) => (
        <EditableSectionItem
          key={child.id}
          node={child}
          depth={depth + 1}
          onAdd={onAdd}
          onRemove={onRemove}
          onRename={onRename}
        />
      ))}
    </div>
  );
}
