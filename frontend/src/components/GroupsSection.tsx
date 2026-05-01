/// Collapsible "Groups" section rendered above the filter tabs in DocumentLibrary.
/// Shows all user-defined paper groups with colour dots, paper counts, and
/// controls for creating, renaming, recolouring, and deleting groups.
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useConvex } from "convex/react";
import { runGroupMatcher } from "@/lib/runGroupMatcher";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import {
  ChevronDown,
  Plus,
  MoreHorizontal,
  Check,
  Pencil,
  Trash2,
  Sparkles,
  RefreshCw,
  Loader2,
  AlertCircle,
  ListChecks,
  Square,
} from "lucide-react";
import { GROUP_COLORS } from "@/lib/types";
import type { PaperGroup, GroupId } from "@/lib/types";
import SuggestionsReviewSheet from "./SuggestionsReviewSheet";

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

/// Inline form for creating a new group: name + description + auto-assign + colour.
function CreateGroupForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const createGroup = useMutation(api.groups.createGroup);
  const convex = useConvex();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [autoAssign, setAutoAssign] = useState(false);
  const [color, setColor] = useState<string>(GROUP_COLORS[0].value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const newGroupId = await createGroup({
        name: trimmed,
        color,
        description: description.trim() || undefined,
        autoAssign,
      });
      onDone();
      // Created with auto-assign already on → kick off the matcher so the
      // user sees suggestions without a separate Re-run click.
      if (autoAssign && description.trim().length > 0 && newGroupId) {
        void runGroupMatcher(convex, newGroupId);
      }
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
        placeholder={t("groups.groupName")}
        className="w-full h-7 px-2 text-xs bg-muted/40 border border-border/50 rounded-md text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/40"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("groups.descriptionPlaceholder")}
        rows={2}
        className="w-full px-2 py-1.5 text-xs bg-muted/40 border border-border/50 rounded-md text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/40 resize-none"
      />
      <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={autoAssign}
          onChange={(e) => setAutoAssign(e.target.checked)}
          className="mt-0.5 accent-amber"
        />
        <span className="flex-1">
          <span className="flex items-center gap-1 text-foreground/80">
            <Sparkles className="size-3 text-amber" />
            {t("groups.autoAssign")}
          </span>
          <span className="block text-[10px] text-muted-foreground/70">
            {t("groups.autoAssignHint")}
          </span>
        </span>
      </label>
      <ColorPalette selected={color} onSelect={setColor} />
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex-1 h-7 text-xs rounded-md bg-amber/15 text-amber hover:bg-amber/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("common.create")}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-3 h-7 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

/// Inline editor shown when the user picks "Edit description" from the menu.
/// Lets them update the description text and toggle auto-assign in one place.
function GroupSettingsEditor({
  group,
  onDone,
}: {
  group: PaperGroup;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const updateGroup = useMutation(api.groups.updateGroup);
  const convex = useConvex();
  const [description, setDescription] = useState(group.description ?? "");
  const [autoAssign, setAutoAssign] = useState(group.autoAssign === true);

  async function commit() {
    const wasAuto = group.autoAssign === true;
    const descChanged = description !== (group.description ?? "");
    await updateGroup({
      groupId: group._id,
      description,
      autoAssign,
    });
    onDone();

    // Auto-trigger the matcher when the criterion changes meaningfully:
    // toggle flipped on, OR description was edited while auto-assign is on.
    // We fire-and-forget — runGroupMatcher manages its own progress UI via
    // the suggestionRunStatus fields, so the user sees the spinner appear.
    const flippedOn = !wasAuto && autoAssign;
    const editedWhileAuto = wasAuto && autoAssign && descChanged;
    if (autoAssign && description.trim().length > 0 && (flippedOn || editedWhileAuto)) {
      void runGroupMatcher(convex, group._id);
    }
  }

  return (
    <div className="p-2 space-y-2 w-64">
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("groups.descriptionPlaceholder")}
        rows={3}
        className="w-full px-2 py-1.5 text-xs bg-muted/40 border border-border/50 rounded-md text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/40 resize-none"
      />
      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={autoAssign}
          onChange={(e) => setAutoAssign(e.target.checked)}
          className="mt-0.5 accent-amber"
        />
        <span className="flex-1">
          <span className="flex items-center gap-1 text-foreground/80">
            <Sparkles className="size-3 text-amber" />
            {t("groups.autoAssign")}
          </span>
          <span className="block text-[10px] text-muted-foreground/70">
            {t("groups.autoAssignHint")}
          </span>
        </span>
      </label>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={commit}
          className="flex-1 h-7 text-xs rounded-md bg-amber/15 text-amber hover:bg-amber/25 transition-colors"
        >
          {t("common.save")}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-3 h-7 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
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
  const { t } = useTranslation();
  const updateGroup = useMutation(api.groups.updateGroup);
  const deleteGroup = useMutation(api.groups.deleteGroup);
  // The matcher runs in the browser (so it can reach the user's localhost
  // Python service); useConvex gives us the client to drive Convex queries
  // and mutations from the orchestrator.
  const convex = useConvex();

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [recoloring, setRecoloring] = useState(false);
  const [editing, setEditing] = useState(false);
  // Whether the per-group "See suggested papers" sheet is open. Kept
  // separate from the main review sheet (header badge) so a user can have
  // both contexts without clobbering.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [draftName, setDraftName] = useState(group.name);
  // Holds the current run's AbortController so the Stop button can cancel
  // mid-flight. Nulled out after the run finishes (either way). A ref —
  // not state — because aborting doesn't need to trigger a rerender; the
  // server-side suggestionRunStatus already drives the spinner.
  const runAbortRef = useRef<AbortController | null>(null);
  // Set when the user clicks Stop; consumed by the post-run toast effect
  // to suppress the "AI suggestions ready" message. Reset at the start
  // of each new run.
  const userStoppedRef = useRef(false);

  // Starts a matcher run with abort tracking. Replaces any in-flight run
  // for this row — there's only ever one at a time per group.
  async function startRun() {
    runAbortRef.current?.abort();
    userStoppedRef.current = false;
    const ctrl = new AbortController();
    runAbortRef.current = ctrl;
    try {
      await runGroupMatcher(convex, group._id, { signal: ctrl.signal });
    } finally {
      // Only clear if we're still the active controller — a newer run
      // would have replaced the ref already.
      if (runAbortRef.current === ctrl) runAbortRef.current = null;
    }
  }

  // Stop the current run. Idempotent if no run is active. The matcher's
  // `finally` block clears the running status; we surface a confirmation
  // toast immediately so the user knows the click registered (the status
  // patch arrives a tick later via the in-flight mutation).
  function stopRun() {
    if (!runAbortRef.current) return;
    userStoppedRef.current = true;
    runAbortRef.current.abort();
    toast.message(t("groups.suggestions.stopped", { name: group.name }));
  }

  const renameInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Per-group pending count drives the menu entry's badge. Reactive — the
  // number drops as the user accepts/declines from the sheet.
  const groupPendingCount = useQuery(
    api.groups.countPendingSuggestionsForGroup,
    { groupId: group._id }
  );

  // Close menu when clicking outside.
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setRecoloring(false);
        setEditing(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  // Toast when a suggestion run transitions from "running" to a terminal
  // state. Tracks the prior status in a ref so the toast fires exactly once
  // per run (not on every re-render that happens to see a "failed" status).
  const prevStatusRef = useRef(group.suggestionRunStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = group.suggestionRunStatus;
    if (prev === "running" && curr !== "running") {
      if (curr === "failed") {
        toast.error(group.suggestionRunError ?? t("groups.suggestions.failed"));
      } else if (userStoppedRef.current) {
        // User clicked Stop — they already got a "Stopped" toast at click
        // time. Don't double-toast with "ready" on top of it.
        userStoppedRef.current = false;
      } else {
        // Idle (success) — confirm completion. The header badge already
        // shows the new pending count, so we only need a light confirmation.
        toast.success(t("groups.suggestions.ready", { name: group.name }));
      }
    }
    prevStatusRef.current = curr;
  }, [group.suggestionRunStatus, group.suggestionRunError, group.name, t]);

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
    if (window.confirm(t("groups.deleteConfirm", { name: group.name }))) {
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
        <span className="flex-1 min-w-0 text-xs truncate flex items-center gap-1">
          {group.name}
          {/* Indicates the AI matcher is active for this group. */}
          {group.autoAssign && (
            <Sparkles className="size-3 text-amber shrink-0" />
          )}
        </span>
      )}

      {/* AI run state — shown only while a backfill / rerun is in flight,
          or briefly when the last run failed. The pill doubles as a Stop
          button: hover to swap the spinner for a Square (stop) icon, click
          to abort the run mid-flight. */}
      {group.suggestionRunStatus === "running" && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            stopRun();
          }}
          title={t("groups.suggestions.stop")}
          className="group/runpill text-[10px] px-1.5 py-0.5 rounded-full bg-amber/15 text-amber hover:bg-amber/25 hover:text-amber shrink-0 flex items-center gap-1 transition-colors"
        >
          {/* Spinner by default; flips to a stop square on hover. */}
          <Loader2 className="size-2.5 animate-spin group-hover/runpill:hidden" />
          <Square className="size-2.5 hidden group-hover/runpill:inline fill-current" />
          {group.suggestionRunProgress ?? 0}/{group.suggestionRunTotal ?? 0}
        </button>
      )}
      {group.suggestionRunStatus === "failed" && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive shrink-0 flex items-center gap-1"
          title={group.suggestionRunError ?? "Suggestion run failed"}
        >
          <AlertCircle className="size-2.5" />
        </span>
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
            setEditing(false);
          }}
          className="opacity-0 group-hover/row:opacity-100 p-0.5 rounded hover:bg-muted/60 transition-all"
        >
          <MoreHorizontal className="size-3.5" />
        </button>

        {menuOpen && (
          <div
            className="absolute right-0 top-6 z-50 min-w-[140px] rounded-md border border-border/50 bg-popover shadow-md text-xs overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
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
            ) : editing ? (
              <GroupSettingsEditor
                group={group}
                onDone={() => {
                  setEditing(false);
                  setMenuOpen(false);
                }}
              />
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
                  {t("groups.rename")}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(true);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <Sparkles className="size-3 text-amber" />
                  {t("groups.editDescription")}
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
                  {t("groups.recolor")}
                </button>
                {group.autoAssign && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      void startRun();
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <RefreshCw className="size-3 text-muted-foreground" />
                    {t("groups.rerunSuggestions")}
                  </button>
                )}
                {/* See suggested papers — only meaningful when there's at
                    least one pending suggestion for this group. Hidden when
                    the count is zero so the menu doesn't grow needlessly. */}
                {(groupPendingCount ?? 0) > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      setReviewOpen(true);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <ListChecks className="size-3 text-amber" />
                    <span className="flex-1 text-left">
                      {t("groups.seeSuggestedPapers")}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber/15 text-amber shrink-0">
                      {groupPendingCount}
                    </span>
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete();
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 text-destructive transition-colors"
                >
                  <Trash2 className="size-3" />
                  {t("common.delete")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {reviewOpen && (
        <SuggestionsReviewSheet
          groupId={group._id}
          groupName={group.name}
          onClose={() => setReviewOpen(false)}
        />
      )}
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
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const pendingCount = useQuery(api.groups.countPendingSuggestions);

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
          {t("groups.title")}
          {selectedGroupId && (
            <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber inline-block" />
          )}
        </button>
        {!collapsed && pendingCount !== undefined && pendingCount > 0 && (
          <button
            onClick={() => setReviewOpen(true)}
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber/15 text-amber hover:bg-amber/25 transition-colors flex items-center gap-1"
            title={t("groups.suggestions.reviewAll")}
          >
            <Sparkles className="size-2.5" />
            {t("groups.suggestions.pending", { count: pendingCount })}
          </button>
        )}
        {!collapsed && (
          <button
            onClick={() => setCreating((c) => !c)}
            className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            title={t("groups.createGroup")}
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
              {t("groups.noGroups")}
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

      {reviewOpen && (
        <SuggestionsReviewSheet onClose={() => setReviewOpen(false)} />
      )}
    </div>
  );
}
