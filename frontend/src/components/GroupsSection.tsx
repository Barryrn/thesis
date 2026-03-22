/// Collapsible "Groups" section rendered above the filter tabs in DocumentLibrary.
/// Shows all user-defined paper groups with colour dots, paper counts, and
/// controls for creating, renaming, recolouring, and deleting groups.
import { useState, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  ChevronDown,
  Plus,
  MoreHorizontal,
  Check,
  Pencil,
  Trash2,
} from "lucide-react";
import { GROUP_COLORS } from "@/lib/types";
import type { PaperGroup, GroupId } from "@/lib/types";

interface GroupsSectionProps {
  /// All existing groups from Convex.
  groups: PaperGroup[];
  /// Maps groupId → number of papers in that group.
  membershipsByGroup: Map<GroupId, number>;
  /// The currently active group filter (null = no group filter).
  selectedGroupId: GroupId | null;
  /// Called when the user clicks a group row to toggle the filter.
  onSelectGroup: (id: GroupId | null) => void;
}

/// Colour swatch grid used when creating or recolouring a group.
function ColorPalette({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 p-1">
      {GROUP_COLORS.map((c) => (
        <button
          key={c.value}
          title={c.label}
          onClick={() => onSelect(c.value)}
          className="w-5 h-5 rounded-full transition-transform hover:scale-110 relative"
          style={{ backgroundColor: c.value }}
        >
          {selected === c.value && (
            <Check className="absolute inset-0 m-auto size-3 text-white drop-shadow" />
          )}
        </button>
      ))}
    </div>
  );
}

/// Inline form for creating a new group (name + colour picker).
function CreateGroupForm({ onDone }: { onDone: () => void }) {
  const createGroup = useMutation(api.groups.createGroup);
  const [name, setName] = useState("");
  const [color, setColor] = useState(GROUP_COLORS[0].value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await createGroup({ name: trimmed, color });
      onDone();
    } catch {
      // Name collision — keep form open so user can rename.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2 px-1">
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Group name…"
        className="w-full h-7 px-2 text-xs bg-muted/40 border border-border/50 rounded-md text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/40"
      />
      <ColorPalette selected={color} onSelect={setColor} />
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex-1 h-7 text-xs rounded-md bg-amber/15 text-amber hover:bg-amber/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-3 h-7 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/// Per-group row with colour dot, name, count badge, and a "..." context menu.
function GroupRow({
  group,
  count,
  isSelected,
  onSelect,
}: {
  group: PaperGroup;
  count: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const updateGroup = useMutation(api.groups.updateGroup);
  const deleteGroup = useMutation(api.groups.deleteGroup);

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [recoloring, setRecoloring] = useState(false);
  const [draftName, setDraftName] = useState(group.name);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside.
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setRecoloring(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  async function commitRename() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== group.name) {
      await updateGroup({ groupId: group._id, name: trimmed });
    } else {
      setDraftName(group.name);
    }
    setRenaming(false);
  }

  async function handleDelete() {
    setMenuOpen(false);
    if (window.confirm(`Delete group "${group.name}"? Papers will not be deleted.`)) {
      await deleteGroup({ groupId: group._id });
    }
  }

  return (
    <div
      className={`group/row flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        isSelected
          ? "bg-amber/10 text-amber"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
      }`}
      onClick={() => !renaming && onSelect()}
    >
      {/* Colour dot */}
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: group.color }}
      />

      {/* Name — editable inline */}
      {renaming ? (
        <input
          ref={renameInputRef}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") { setDraftName(group.name); setRenaming(false); }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 h-5 px-1 text-xs bg-muted/40 border border-amber/30 rounded text-foreground focus:outline-none"
        />
      ) : (
        <span className="flex-1 min-w-0 text-xs truncate">{group.name}</span>
      )}

      {/* Paper count badge */}
      {count > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground shrink-0">
          {count}
        </span>
      )}

      {/* "..." context menu */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
            setRecoloring(false);
          }}
          className="opacity-0 group-hover/row:opacity-100 p-0.5 rounded hover:bg-muted/60 transition-all"
        >
          <MoreHorizontal className="size-3.5" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-6 z-50 min-w-[140px] rounded-md border border-border/50 bg-popover shadow-md text-xs overflow-hidden">
            {recoloring ? (
              <div className="p-2">
                <ColorPalette
                  selected={group.color}
                  onSelect={async (value) => {
                    await updateGroup({ groupId: group._id, color: value });
                    setMenuOpen(false);
                    setRecoloring(false);
                  }}
                />
              </div>
            ) : (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setRenaming(true);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <Pencil className="size-3 text-muted-foreground" />
                  Rename
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRecoloring(true);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: group.color }}
                  />
                  Recolor
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete();
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 text-destructive transition-colors"
                >
                  <Trash2 className="size-3" />
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/// The top-level collapsible groups panel.
export default function GroupsSection({
  groups,
  membershipsByGroup,
  selectedGroupId,
  onSelectGroup,
}: GroupsSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [creating, setCreating] = useState(false);

  return (
    <div className="border-b border-border/50 pb-2 mb-1">
      {/* Header row */}
      <div className="flex items-center gap-1 px-1 py-1.5">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1 flex-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={`size-3 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
          Groups
          {selectedGroupId && (
            <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber inline-block" />
          )}
        </button>
        {!collapsed && (
          <button
            onClick={() => setCreating((c) => !c)}
            className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            title="Create group"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-1 space-y-0.5">
          {creating && (
            <CreateGroupForm onDone={() => setCreating(false)} />
          )}
          {groups.length === 0 && !creating ? (
            <p className="text-[11px] text-muted-foreground/50 px-2 py-1">
              No groups yet
            </p>
          ) : (
            groups.map((g) => (
              <GroupRow
                key={g._id}
                group={g}
                count={membershipsByGroup.get(g._id) ?? 0}
                isSelected={selectedGroupId === g._id}
                onSelect={() =>
                  onSelectGroup(selectedGroupId === g._id ? null : g._id)
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
