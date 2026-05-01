/// Convex queries and mutations for paper groups — freeform user-defined
/// collections that are independent of the thesis outline sections.
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/// FNV-1a 32-bit hash of the trimmed, lowercased input. Used to fingerprint
/// group descriptions so we can decide whether a previously-declined
/// suggestion should become eligible again. Convex's mutation/query runtime
/// has no `crypto.subtle`, so a hand-rolled hash is the simplest stable option.
function descriptionHash(s: string | undefined): string {
  if (!s) return "";
  const norm = s.trim().toLowerCase();
  if (!norm) return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

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

/// Returns groups that have auto-assign enabled and a non-empty description.
/// The matcher uses these as the candidate set for new papers.
export const listAutoAssignGroups = query({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.db.query("paperGroups").collect();
    return groups.filter(
      (g) => g.autoAssign === true && (g.description ?? "").trim().length > 0
    );
  },
});

/// Creates a new group. Throws if a group with the same name already exists.
export const createGroup = mutation({
  args: {
    name: v.string(),
    color: v.string(),
    description: v.optional(v.string()),
    autoAssign: v.optional(v.boolean()),
  },
  handler: async (ctx, { name, color, description, autoAssign }) => {
    // Enforce unique names to avoid user confusion.
    const existing = await ctx.db
      .query("paperGroups")
      .filter((q) => q.eq(q.field("name"), name))
      .first();
    if (existing) {
      throw new Error(`A group named "${name}" already exists.`);
    }
    const groupId = await ctx.db.insert("paperGroups", {
      name,
      color,
      createdAt: Date.now(),
      description,
      autoAssign,
      descriptionHash: descriptionHash(description),
    });
    // NOTE: We do NOT schedule a Convex action here to backfill suggestions.
    // The matcher action runs in Convex's cloud runtime and can't reach the
    // user's localhost Python service (always ECONNREFUSED). The browser
    // (which can reach localhost) is responsible for triggering the matcher
    // — see runGroupMatcher() in frontend/src/lib/runGroupMatcher.ts.
    return groupId;
  },
});

/// Renames, recolors, edits the description, or toggles auto-assign.
/// Schedules backfill when the criterion changes (description edit on an
/// auto-assign group, or auto-assign flipped from off to on).
export const updateGroup = mutation({
  args: {
    groupId: v.id("paperGroups"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    description: v.optional(v.string()),
    autoAssign: v.optional(v.boolean()),
  },
  handler: async (ctx, { groupId, name, color, description, autoAssign }) => {
    const before = await ctx.db.get(groupId);
    if (!before) return;

    const patch: Partial<{
      name: string;
      color: string;
      description: string;
      autoAssign: boolean;
      descriptionHash: string;
    }> = {};
    if (name !== undefined) patch.name = name;
    if (color !== undefined) patch.color = color;
    if (description !== undefined) {
      patch.description = description;
      patch.descriptionHash = descriptionHash(description);
    }
    if (autoAssign !== undefined) patch.autoAssign = autoAssign;
    await ctx.db.patch(groupId, patch);

    // Backfill is triggered from the browser, not here — see the createGroup
    // comment for why. The frontend's "Edit description" / autoAssign-toggle
    // form calls runGroupMatcher() right after this mutation resolves.
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
    // Cascade pending/decided suggestions for this group.
    const suggestions = await ctx.db
      .query("paperGroupSuggestions")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    await Promise.all(suggestions.map((s) => ctx.db.delete(s._id)));
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

// =============================================================================
// AI suggestion queries / mutations
// =============================================================================

/// Returns all pending suggestions for a paper. Used by paper cards to render
/// the dashed suggestion pills inline next to confirmed group memberships.
export const listSuggestionsForPaper = query({
  args: { paperId: v.id("papers") },
  handler: async (ctx, { paperId }) => {
    return ctx.db
      .query("paperGroupSuggestions")
      .withIndex("by_paper_and_status", (q) =>
        q.eq("paperId", paperId).eq("status", "pending")
      )
      .collect();
  },
});

/// Returns every pending suggestion in the library, joined with denormalized
/// paper title/authors and group name/color so the review sheet can render
/// without a second round of queries.
export const listPendingSuggestions = query({
  args: {
    /// When set, returns only suggestions for that group. Used by the
    /// per-group review sheet opened from the GroupRow menu.
    groupId: v.optional(v.id("paperGroups")),
  },
  handler: async (ctx, { groupId }) => {
    // Use the by_group index when filtering — avoids a full table scan
    // once the suggestions table grows.
    const rows = groupId
      ? await ctx.db
          .query("paperGroupSuggestions")
          .withIndex("by_group", (q) => q.eq("groupId", groupId))
          .collect()
      : await ctx.db.query("paperGroupSuggestions").collect();
    const pending = rows.filter((r) => r.status === "pending");
    return Promise.all(
      pending.map(async (s) => {
        const paper = await ctx.db.get(s.paperId);
        const group = await ctx.db.get(s.groupId);
        return {
          _id: s._id,
          paperId: s.paperId,
          groupId: s.groupId,
          confidence: s.confidence,
          reason: s.reason,
          createdAt: s.createdAt,
          paperTitle: paper?.title ?? "",
          paperAuthors: paper?.authors ?? [],
          groupName: group?.name ?? "",
          groupColor: group?.color ?? "#888888",
        };
      })
    );
  },
});

/// Single integer used by the Groups section header badge.
export const countPendingSuggestions = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("paperGroupSuggestions").collect();
    return rows.filter((r) => r.status === "pending").length;
  },
});

/// Per-group pending count. Drives the count pill on the "See suggested
/// papers" menu entry inside each GroupRow's overflow menu.
export const countPendingSuggestionsForGroup = query({
  args: { groupId: v.id("paperGroups") },
  handler: async (ctx, { groupId }) => {
    const rows = await ctx.db
      .query("paperGroupSuggestions")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    return rows.filter((r) => r.status === "pending").length;
  },
});

/// Inserts a pending suggestion if no equivalent record blocks it. The matcher
/// action calls this for every (paperId, groupId) pair the model returned.
/// Skips on three conditions:
///   1. A pending suggestion for the pair already exists (avoid duplicates).
///   2. A declined suggestion exists with the same descriptionHash (the
///      criterion hasn't changed since the user said "no").
///   3. The paper is already a member of the group.
export const recordSuggestion = mutation({
  args: {
    paperId: v.id("papers"),
    groupId: v.id("paperGroups"),
    confidence: v.number(),
    reason: v.string(),
    groupDescriptionHashAtSuggestion: v.string(),
  },
  handler: async (
    ctx,
    { paperId, groupId, confidence, reason, groupDescriptionHashAtSuggestion }
  ) => {
    // 3. Already a member?
    const member = await ctx.db
      .query("paperGroupMemberships")
      .withIndex("by_paper_group", (q) =>
        q.eq("paperId", paperId).eq("groupId", groupId)
      )
      .first();
    if (member) return;

    // 1 + 2. Walk existing suggestions for the pair.
    const priors = await ctx.db
      .query("paperGroupSuggestions")
      .withIndex("by_paper", (q) => q.eq("paperId", paperId))
      .collect();
    for (const p of priors) {
      if (p.groupId !== groupId) continue;
      if (p.status === "pending") return;
      if (p.status === "accepted") return;
      if (
        p.status === "declined" &&
        p.groupDescriptionHashAtSuggestion === groupDescriptionHashAtSuggestion
      ) {
        return;
      }
    }

    await ctx.db.insert("paperGroupSuggestions", {
      paperId,
      groupId,
      confidence,
      reason,
      status: "pending",
      groupDescriptionHashAtSuggestion,
      createdAt: Date.now(),
    });
  },
});

/// Confirms a suggestion: creates the membership row (idempotent) and marks
/// the suggestion accepted.
export const acceptSuggestion = mutation({
  args: { suggestionId: v.id("paperGroupSuggestions") },
  handler: async (ctx, { suggestionId }) => {
    const s = await ctx.db.get(suggestionId);
    if (!s || s.status !== "pending") return;
    const existing = await ctx.db
      .query("paperGroupMemberships")
      .withIndex("by_paper_group", (q) =>
        q.eq("paperId", s.paperId).eq("groupId", s.groupId)
      )
      .first();
    if (!existing) {
      await ctx.db.insert("paperGroupMemberships", {
        paperId: s.paperId,
        groupId: s.groupId,
        addedAt: Date.now(),
      });
    }
    await ctx.db.patch(suggestionId, {
      status: "accepted",
      decidedAt: Date.now(),
    });
  },
});

/// Rejects a suggestion. The stored descriptionHash blocks re-suggestion
/// until the group's description (and thus its hash) changes.
export const declineSuggestion = mutation({
  args: { suggestionId: v.id("paperGroupSuggestions") },
  handler: async (ctx, { suggestionId }) => {
    const s = await ctx.db.get(suggestionId);
    if (!s || s.status !== "pending") return;
    await ctx.db.patch(suggestionId, {
      status: "declined",
      decidedAt: Date.now(),
    });
  },
});

/// Returns everything the frontend matcher client needs in a single query:
/// the target group + the eligible papers (with structured summaries) that
/// should be scored. Filters out memberships, declined-with-same-hash pairs,
/// and papers with no summary. This exists because the matcher runs in the
/// browser (Convex actions in cloud can't reach the user's localhost
/// Python service).
export const getRunCandidates = query({
  args: { groupId: v.id("paperGroups") },
  handler: async (ctx, { groupId }) => {
    const group = await ctx.db.get(groupId);
    if (!group) return null;
    if (group.autoAssign !== true) return null;
    if (!(group.description ?? "").trim()) return null;

    // Pairs blocked by an active decline for this group.
    const declined = await ctx.db
      .query("paperGroupSuggestions")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    const blockedPaperIds = new Set(
      declined
        .filter(
          (d) =>
            d.status === "declined" &&
            d.groupDescriptionHashAtSuggestion ===
              (group.descriptionHash ?? "")
        )
        .map((d) => d.paperId)
    );

    const allPapers = await ctx.db.query("papers").collect();
    const papers: {
      paperId: Id<"papers">;
      title: string;
      summary: {
        researchQuestion: string;
        methodology: string;
        keyFindings: string[];
        keywords: string[];
      };
    }[] = [];
    for (const p of allPapers) {
      if (blockedPaperIds.has(p._id)) continue;

      // Skip if already a member of this group.
      const existing = await ctx.db
        .query("paperGroupMemberships")
        .withIndex("by_paper_group", (q) =>
          q.eq("paperId", p._id).eq("groupId", groupId)
        )
        .first();
      if (existing) continue;

      // Skip papers without a summary — matcher needs structured fields.
      const summary = await ctx.db
        .query("summaries")
        .withIndex("by_paper", (q) => q.eq("paperId", p._id))
        .first();
      if (!summary) continue;

      papers.push({
        paperId: p._id,
        title: p.title,
        summary: {
          researchQuestion: summary.researchQuestion,
          methodology: summary.methodology,
          keyFindings: summary.keyFindings,
          keywords: summary.keywords,
        },
      });
    }

    return {
      group: {
        _id: group._id,
        name: group.name,
        description: group.description ?? "",
        descriptionHash: group.descriptionHash ?? "",
      },
      papers,
    };
  },
});

// =============================================================================
// Run-state plumbing
//
// These mutations let the action layer report progress without holding
// open a long-running transaction. The frontend reads the same fields
// reactively to show a spinner + N/M counter on each group row.
// =============================================================================

/// Marks the start of a backfill / rerun. Clears any prior `failed` state
/// and resets the progress counter so the UI gets a fresh "0 / total" read.
export const startSuggestionRun = mutation({
  args: {
    groupId: v.id("paperGroups"),
    total: v.number(),
  },
  handler: async (ctx, { groupId, total }) => {
    await ctx.db.patch(groupId, {
      suggestionRunStatus: "running",
      suggestionRunTotal: total,
      suggestionRunProgress: 0,
      suggestionRunStartedAt: Date.now(),
      suggestionRunError: undefined,
    });
  },
});

/// Bumps the progress counter. The action calls this after each per-paper
/// Python response. Bounded to <= total so the UI never shows "201 / 200".
export const incrementSuggestionRun = mutation({
  args: {
    groupId: v.id("paperGroups"),
    by: v.number(),
  },
  handler: async (ctx, { groupId, by }) => {
    const g = await ctx.db.get(groupId);
    if (!g) return;
    const total = g.suggestionRunTotal ?? 0;
    const next = Math.min((g.suggestionRunProgress ?? 0) + by, total);
    await ctx.db.patch(groupId, { suggestionRunProgress: next });
  },
});

/// Clears the running flag. On success the UI returns to the idle (no
/// indicator) state; on failure it shows the error briefly so users know
/// something went wrong without hunting in the Convex dashboard.
export const finishSuggestionRun = mutation({
  args: {
    groupId: v.id("paperGroups"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { groupId, error }) => {
    await ctx.db.patch(groupId, {
      suggestionRunStatus: error ? "failed" : "idle",
      suggestionRunTotal: undefined,
      suggestionRunProgress: undefined,
      suggestionRunStartedAt: undefined,
      suggestionRunError: error,
    });
  },
});

/// Returns the (paperId, groupId) pairs that have a `declined` suggestion
/// whose stored hash still matches the group's current hash. The matcher
/// action filters its candidate set against this list before calling Python.
export const listActiveDeclines = query({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.db.query("paperGroups").collect();
    const hashByGroup = new Map<Id<"paperGroups">, string>();
    for (const g of groups) {
      hashByGroup.set(g._id, g.descriptionHash ?? "");
    }
    const rows = await ctx.db.query("paperGroupSuggestions").collect();
    return rows
      .filter(
        (r) =>
          r.status === "declined" &&
          hashByGroup.get(r.groupId) === r.groupDescriptionHashAtSuggestion
      )
      .map((r) => ({ paperId: r.paperId, groupId: r.groupId }));
  },
});
