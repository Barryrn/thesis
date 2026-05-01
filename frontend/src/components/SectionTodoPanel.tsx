/// Collapsible TODO drawer pinned below the editor.
///
/// Two row sources:
///   • "user" — free-text items the writer types in. Editable, never
///     auto-deleted.
///   • "auto-citation" — created by the validate phase when a placeholder
///     fails the auto-promote threshold. Linked to a `{{citeNeeded:...}}`
///     marker via `placeholderId` so clicking "Jump to claim" scrolls the
///     editor and flashes the chip. Auto-deleted by the saveSectionContent
///     cascade when the linked chip disappears from the body.
///
/// The drawer defaults to collapsed and shows a badge count of incomplete
/// items so the user always sees the live work-remaining without losing
/// vertical space on the writing surface.
import { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ListTodo,
  Plus,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import type { SectionId, SectionTodo } from "@/lib/types";

interface Props {
  sectionId: SectionId;
  /// Reference to the contentEditable div so "Jump to claim" can find the
  /// chip with `data-placeholder-id="…"` and scroll/flash it.
  editorRef: RefObject<HTMLDivElement | null>;
}

export default function SectionTodoPanel({ sectionId, editorRef }: Props) {
  const { t } = useTranslation();
  const todos =
    useQuery(api.sectionTodos.listForSection, { sectionId }) ?? [];
  const createTodo = useMutation(api.sectionTodos.create);
  const toggleTodo = useMutation(api.sectionTodos.toggle);
  const removeTodo = useMutation(api.sectionTodos.remove);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const incomplete = todos.filter((t) => !t.completed);
  const completed = todos.filter((t) => t.completed);

  /// Submits the free-text input as a new user TODO. Empty input no-ops.
  async function handleAdd() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await createTodo({ sectionId, text, source: "user" });
  }

  /// Locates the chip in the editor DOM and scrolls + flashes it for ~1s.
  /// Auto-citation TODOs are the only kind that have a `placeholderId`.
  function jumpToClaim(placeholderId: string) {
    const editor = editorRef.current;
    if (!editor) return;
    const chip = editor.querySelector<HTMLElement>(
      `[data-placeholder-id="${CSS.escape(placeholderId)}"]`
    );
    if (!chip) return;
    chip.scrollIntoView({ behavior: "smooth", block: "center" });
    chip.classList.remove("flash-highlight");
    // Force reflow so the animation restarts even if the class was just set.
    void chip.offsetWidth;
    chip.classList.add("flash-highlight");
    window.setTimeout(() => {
      chip.classList.remove("flash-highlight");
    }, 1000);
  }

  return (
    <div className="rounded-lg border border-border bg-muted/10 overflow-hidden">
      {/* Drawer header — always visible, click to toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-muted/20 transition-colors"
      >
        <span className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {open ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          <ListTodo className="size-3" />
          {t("sectionTodoPanel.title")}
          {incomplete.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber/15 text-amber-dim font-mono normal-case tracking-normal">
              {incomplete.length}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {/* Add-row */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder={t("sectionTodoPanel.addPlaceholder")}
              className="flex-1 text-[11px] px-2 py-1 rounded-md border border-border bg-background"
            />
            <button
              onClick={handleAdd}
              className="text-[11px] px-2 py-1 rounded-md bg-amber/15 hover:bg-amber/25 text-amber-dim transition-colors flex items-center gap-1"
            >
              <Plus className="size-3" />
              {t("sectionTodoPanel.add")}
            </button>
          </div>

          {/* Empty state */}
          {todos.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic py-2">
              {t("sectionTodoPanel.empty")}
            </p>
          )}

          {/* Incomplete list */}
          {incomplete.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {t("sectionTodoPanel.incompleteHeading")}
              </p>
              <ul className="space-y-1">
                {incomplete.map((todo) => (
                  <TodoRow
                    key={todo._id}
                    todo={todo}
                    onToggle={(id) => toggleTodo({ todoId: id })}
                    onRemove={(id) => removeTodo({ todoId: id })}
                    onJump={jumpToClaim}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* Completed list */}
          {completed.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {t("sectionTodoPanel.completedHeading")}
              </p>
              <ul className="space-y-1">
                {completed.map((todo) => (
                  <TodoRow
                    key={todo._id}
                    todo={todo}
                    onToggle={(id) => toggleTodo({ todoId: id })}
                    onRemove={(id) => removeTodo({ todoId: id })}
                    onJump={jumpToClaim}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/// One row in the TODO list. Extracted to keep the parent's render readable
/// and to avoid prop drilling through children.
function TodoRow({
  todo,
  onToggle,
  onRemove,
  onJump,
}: {
  todo: SectionTodo;
  onToggle: (id: Id<"sectionTodos">) => void;
  onRemove: (id: Id<"sectionTodos">) => void;
  onJump: (placeholderId: string) => void;
}) {
  const { t } = useTranslation();
  const isAuto = todo.source === "auto-citation";

  return (
    <li className="flex items-center gap-2 group">
      <button
        type="button"
        onClick={() => onToggle(todo._id)}
        className={`size-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
          todo.completed
            ? "bg-amber/30 border-amber/50"
            : "border-border hover:border-amber/50"
        }`}
        aria-label={todo.completed ? "Mark incomplete" : "Mark complete"}
      >
        {todo.completed && <Check className="size-3 text-amber-dim" />}
      </button>
      <span
        className={`text-[11px] flex-1 ${
          todo.completed ? "line-through text-muted-foreground" : ""
        }`}
      >
        {todo.text}
      </span>
      {isAuto && (
        <span
          className="text-[9px] px-1 py-0.5 rounded-sm bg-amber/10 text-amber-dim flex items-center gap-0.5"
          title={t("sectionTodoPanel.autoBadge")}
        >
          <Sparkles className="size-2.5" />
          AI
        </span>
      )}
      {isAuto && todo.placeholderId && (
        <button
          type="button"
          onClick={() => onJump(todo.placeholderId!)}
          className="text-[10px] text-muted-foreground hover:text-amber-dim opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5"
          title={t("sectionTodoPanel.jumpToClaim")}
        >
          <Target className="size-3" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onRemove(todo._id)}
        className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Delete"
      >
        <Trash2 className="size-3" />
      </button>
    </li>
  );
}
