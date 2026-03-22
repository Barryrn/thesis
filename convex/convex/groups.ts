/// Convex queries and mutations for paper groups — freeform user-defined
/// collections that are independent of the thesis outline sections.
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/// Returns all groups ordered by creation time (oldest first).
export const listGroups = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("paperGroups").order("asc").collect();
  },
});

/// Returns all membership rows as `{ paperId, groupId }` pairs.
/// Used by DocumentLibrary to build a client-side map without N+1 per-card queries.
export const listAllMemberships = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("paperGroupMemberships").collect();
    return rows.map((r) => ({ paperId: r.paperId, groupId: r.groupId }));
  },
});

/// Returns the groups a specific paper belongs to.
export const getGroupsForPaper = query({
  args: { paperId: v.id("papers") },
  handler: async (ctx, { paperId }) => {
    const memberships = await ctx.db
      .query("paperGroupMemberships")
      .withIndex("by_paper", (q) => q.eq("paperId", paperId))
      .collect();
    return Promise.all(memberships.map((m) => ctx.db.get(m.groupId)));
  },
});

/// Creates a new group. Throws if a group with the same name already exists.
export const createGroup = mutation({
  args: {
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, { name, color }) => {
    // Enforce unique names to avoid user confusion.
    const existing = await ctx.db
      .query("paperGroups")
      .filter((q) => q.eq(q.field("name"), name))
      .first();
    if (existing) {
      throw new Error(`A group named "${name}" already exists.`);
    }
    return ctx.db.insert("paperGroups", { name, color, createdAt: Date.now() });
  },
});

/// Renames or recolors an existing group.
export const updateGroup = mutation({
  args: {
    groupId: v.id("paperGroups"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, { groupId, name, color }) => {
    const patch: Partial<{ name: string; color: string }> = {};
    if (name !== undefined) patch.name = name;
    if (color !== undefined) patch.color = color;
    await ctx.db.patch(groupId, patch);
  },
});

/// Deletes a group and all its membership rows (cascade).
export const deleteGroup = mutation({
  args: { groupId: v.id("paperGroups") },
  handler: async (ctx, { groupId }) => {
    // Remove all memberships first.
    const memberships = await ctx.db
      .query("paperGroupMemberships")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    await Promise.all(memberships.map((m) => ctx.db.delete(m._id)));
    await ctx.db.delete(groupId);
  },
});

/// Adds a paper to a group. Idempotent — does nothing if already a member.
export const addPaperToGroup = mutation({
  args: {
    paperId: v.id("papers"),
    groupId: v.id("paperGroups"),
  },
  handler: async (ctx, { paperId, groupId }) => {
    const existing = await ctx.db
      .query("paperGroupMemberships")
      .withIndex("by_paper_group", (q) =>
        q.eq("paperId", paperId).eq("groupId", groupId)
      )
      .first();
    if (existing) return; // Already a member — no-op.
    await ctx.db.insert("paperGroupMemberships", {
      paperId,
      groupId,
      addedAt: Date.now(),
    });
  },
});

/// Removes a paper from a group.
export const removePaperFromGroup = mutation({
  args: {
    paperId: v.id("papers"),
    groupId: v.id("paperGroups"),
  },
  handler: async (ctx, { paperId, groupId }) => {
    const existing = await ctx.db
      .query("paperGroupMemberships")
      .withIndex("by_paper_group", (q) =>
        q.eq("paperId", paperId).eq("groupId", groupId)
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
