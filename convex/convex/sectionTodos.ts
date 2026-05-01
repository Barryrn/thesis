/// Per-section TODO list backing the collapsible drawer below the editor.
/// Two row sources: `"user"` rows are free-text items entered by the writer;
/// `"auto-citation"` rows are created by the auto-cite validate phase when a
/// `{{citeNeeded:...}}` placeholder cannot be resolved automatically. The
/// `placeholderId` column links auto rows to their chip in the body so the
/// "Jump to claim" button can scroll the editor and the saveSectionContent
/// cascade can clean up orphaned rows when the user deletes the chip.
import { v } from "convex/values";
import type { DatabaseWriter } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/// Lists every TODO for a section, ordered by createdAt (oldest first).
/// The drawer UI partitions into incomplete/completed client-side.
export const listForSection = query({
  args: { sectionId: v.id("outlineSections") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("sectionTodos")
      .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
      .collect();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/// Creates a TODO. `source` distinguishes user-typed items from auto-citation
/// rows; only auto rows carry a `placeholderId`. The mutation does not check
/// uniqueness on `placeholderId` — the validate phase calls this once per
/// unresolved placeholder, and re-runs are expected to recreate cleared rows.
export const create = mutation({
  args: {
    sectionId: v.id("outlineSections"),
    text: v.string(),
    source: v.union(v.literal("user"), v.literal("auto-citation")),
    placeholderId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sectionTodos", {
      sectionId: args.sectionId,
      text: args.text,
      completed: false,
      createdAt: Date.now(),
      source: args.source,
      placeholderId: args.placeholderId,
    });
  },
});

/// Flips the completed flag and stamps/clears `completedAt`. Called by the
/// drawer's checkbox; works for both row sources.
export const toggle = mutation({
  args: { todoId: v.id("sectionTodos") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.todoId);
    if (!row) return null;
    const next = !row.completed;
    await ctx.db.patch(args.todoId, {
      completed: next,
      completedAt: next ? Date.now() : undefined,
    });
    return args.todoId;
  },
});

/// Updates the text of a user-source TODO. Auto-citation rows are read-only
/// hints — silently no-op so a stray UI call cannot mutate the AI message.
export const update = mutation({
  args: {
    todoId: v.id("sectionTodos"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.todoId);
    if (!row) return null;
    if (row.source !== "user") return args.todoId;
    await ctx.db.patch(args.todoId, { text: args.text });
    return args.todoId;
  },
});

/// Deletes a TODO row regardless of source. The drawer surfaces a delete
/// button on every row.
export const remove = mutation({
  args: { todoId: v.id("sectionTodos") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.todoId);
    return args.todoId;
  },
});

/// Cascade helper called from `saveSectionContent`. Deletes any
/// `auto-citation` row for `sectionId` whose `placeholderId` is no longer
/// present in `livePlaceholderIds`. User rows are never touched. Runs in the
/// caller's transaction so body and TODO rows are atomically consistent.
export async function cascadeAutoCitationTodos(
  ctx: { db: DatabaseWriter },
  sectionId: Id<"outlineSections">,
  livePlaceholderIds: string[]
): Promise<number> {
  const live = new Set(livePlaceholderIds);
  // The (sectionId, placeholderId) index is filterable by sectionId alone, so
  // the read is bounded to this section even when the user has thousands of
  // rows globally.
  const rows = await ctx.db
    .query("sectionTodos")
    .withIndex("by_section_placeholder", (q) => q.eq("sectionId", sectionId))
    .collect();

  let deleted = 0;
  for (const row of rows) {
    if (row.source !== "auto-citation") continue;
    if (!row.placeholderId) continue;
    if (live.has(row.placeholderId)) continue;
    await ctx.db.delete(row._id);
    deleted++;
  }
  return deleted;
}

