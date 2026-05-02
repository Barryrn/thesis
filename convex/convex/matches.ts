import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// ===== HELPERS =====

async function deleteExcerptsForMatch(
  ctx: { db: any },
  matchId: any
) {
  const excerpts = await ctx.db
    .query("matchExcerpts")
    .withIndex("by_match", (q: any) => q.eq("matchId", matchId))
    .collect();
  for (const excerpt of excerpts) {
    await ctx.db.delete(excerpt._id);
  }
}

async function deleteExcerptsForPaper(
  ctx: { db: any },
  paperId: any
) {
  const excerpts = await ctx.db
    .query("matchExcerpts")
    .withIndex("by_paper_section")
    .filter((q: any) => q.eq(q.field("paperId"), paperId))
    .collect();
  for (const excerpt of excerpts) {
    await ctx.db.delete(excerpt._id);
  }
}

// ===== MUTATIONS =====

/// Upserts citation matches for specific sections only, preserving
/// matches for all other sections. Called by the /cite endpoint after
/// the user drags a paper onto a sidebar section node.
export const upsertCitationMatches = mutation({
  args: {
    paperId: v.id("papers"),
    matches: v.array(
      v.object({
        sectionId: v.id("outlineSections"),
        relevanceScore: v.number(),
      })
    ),
    excerpts: v.array(
      v.object({
        sectionId: v.id("outlineSections"),
        excerptText: v.string(),
        relevanceNote: v.string(),
        orderIndex: v.number(),
        pageNumber: v.optional(v.string()),
        pageNumberApproximate: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Load all existing matches for this paper once (already has pageNumber)
    const existingMatches = await ctx.db
      .query("paperSectionMatches")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    const matchIds: Record<string, any> = {};
    const now = Date.now();

    for (const match of args.matches) {
      // Remove existing excerpts for this paper+section before reinserting
      const oldExcerpts = await ctx.db
        .query("matchExcerpts")
        .withIndex("by_paper_section", (q) =>
          q.eq("paperId", args.paperId).eq("sectionId", match.sectionId)
        )
        .collect();
      for (const e of oldExcerpts) await ctx.db.delete(e._id);

      // Upsert the match record
      const existing = existingMatches.find(
        (m) => m.sectionId === match.sectionId
      );
      if (existing) {
        await ctx.db.patch(existing._id, {
          relevanceScore: match.relevanceScore,
          isManualOverride: false,
          matchedAt: now,
        });
        matchIds[match.sectionId as string] = existing._id;
      } else {
        const id = await ctx.db.insert("paperSectionMatches", {
          paperId: args.paperId,
          sectionId: match.sectionId,
          relevanceScore: match.relevanceScore,
          isManualOverride: false,
          matchedAt: now,
        });
        matchIds[match.sectionId as string] = id;
      }
    }

    // Insert excerpts linked to their respective match IDs
    for (const excerpt of args.excerpts) {
      const matchId = matchIds[excerpt.sectionId as string];
      if (matchId) {
        await ctx.db.insert("matchExcerpts", {
          matchId,
          paperId: args.paperId,
          sectionId: excerpt.sectionId,
          excerptText: excerpt.excerptText,
          relevanceNote: excerpt.relevanceNote,
          orderIndex: excerpt.orderIndex,
          isManual: false,
          pageNumber: excerpt.pageNumber ?? undefined,
          pageNumberApproximate: excerpt.pageNumberApproximate ?? undefined,
        });
      }
    }

    return Object.values(matchIds);
  },
});

/// Deletes all paper-section matches and their linked excerpts across the
/// entire database. Used for one-time migration to the on-demand citation
/// workflow.
export const clearAllMatches = mutation({
  args: {},
  handler: async (ctx) => {
    const matches = await ctx.db.query("paperSectionMatches").collect();
    for (const match of matches) {
      await deleteExcerptsForMatch(ctx, match._id);
      await ctx.db.delete(match._id);
    }
  },
});

export const createMatches = mutation({
  args: {
    paperId: v.id("papers"),
    matches: v.array(
      v.object({
        sectionId: v.id("outlineSections"),
        relevanceScore: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Delete existing excerpts for this paper
    await deleteExcerptsForPaper(ctx, args.paperId);

    // Delete existing matches for this paper
    const existing = await ctx.db
      .query("paperSectionMatches")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    for (const match of existing) {
      await ctx.db.delete(match._id);
    }

    // Batch insert new matches
    const now = Date.now();
    const ids = [];
    for (const match of args.matches) {
      const id = await ctx.db.insert("paperSectionMatches", {
        paperId: args.paperId,
        sectionId: match.sectionId,
        relevanceScore: match.relevanceScore,
        isManualOverride: false,
        matchedAt: now,
      });
      ids.push(id);
    }
    return ids;
  },
});

export const createExcerpts = mutation({
  args: {
    paperId: v.id("papers"),
    excerpts: v.array(
      v.object({
        matchId: v.id("paperSectionMatches"),
        sectionId: v.id("outlineSections"),
        excerptText: v.string(),
        relevanceNote: v.string(),
        orderIndex: v.number(),
        pageNumber: v.optional(v.string()),
        pageNumberApproximate: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const ids = [];
    for (const excerpt of args.excerpts) {
      const id = await ctx.db.insert("matchExcerpts", {
        matchId: excerpt.matchId,
        paperId: args.paperId,
        sectionId: excerpt.sectionId,
        excerptText: excerpt.excerptText,
        relevanceNote: excerpt.relevanceNote,
        orderIndex: excerpt.orderIndex,
        isManual: false,
        pageNumber: excerpt.pageNumber,
        pageNumberApproximate: excerpt.pageNumberApproximate ?? undefined,
      });
      ids.push(id);
    }
    return ids;
  },
});

export const updateMatch = mutation({
  args: {
    paperId: v.id("papers"),
    oldSectionId: v.id("outlineSections"),
    newSectionId: v.id("outlineSections"),
  },
  handler: async (ctx, args) => {
    // Find the match for paperId + oldSectionId
    const matches = await ctx.db
      .query("paperSectionMatches")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    const match = matches.find((m) => m.sectionId === args.oldSectionId);
    if (!match) {
      throw new Error(
        `No match found for paperId ${args.paperId} and sectionId ${args.oldSectionId}`
      );
    }

    // Delete excerpts for the old match (they were section-specific)
    await deleteExcerptsForMatch(ctx, match._id);

    await ctx.db.patch(match._id, {
      sectionId: args.newSectionId,
      isManualOverride: true,
      matchedAt: Date.now(),
    });
  },
});

export const addMatch = mutation({
  args: {
    paperId: v.id("papers"),
    sectionId: v.id("outlineSections"),
    relevanceScore: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("paperSectionMatches")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    const alreadyExists = existing.find(
      (m) => m.sectionId === args.sectionId
    );
    if (alreadyExists) {
      await ctx.db.patch(alreadyExists._id, {
        relevanceScore: args.relevanceScore,
        isManualOverride: true,
        matchedAt: Date.now(),
      });
      return alreadyExists._id;
    }

    return await ctx.db.insert("paperSectionMatches", {
      paperId: args.paperId,
      sectionId: args.sectionId,
      relevanceScore: args.relevanceScore,
      isManualOverride: true,
      matchedAt: Date.now(),
    });
  },
});

export const removeMatch = mutation({
  args: {
    paperId: v.id("papers"),
    sectionId: v.id("outlineSections"),
  },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("paperSectionMatches")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    const match = matches.find((m) => m.sectionId === args.sectionId);
    if (match) {
      // Delete associated excerpts first
      await deleteExcerptsForMatch(ctx, match._id);
      await ctx.db.delete(match._id);
    }
  },
});

export const addExcerpt = mutation({
  args: {
    /// Optional. When the excerpt is attached during a self-cite via the
    /// @-picker, the user has selected a paper directly without going through
    /// AI matching, so there is no underlying match record yet. Order index
    /// is then computed across the (paperId, sectionId) tuple instead.
    matchId: v.optional(v.id("paperSectionMatches")),
    paperId: v.id("papers"),
    sectionId: v.id("outlineSections"),
    excerptText: v.string(),
    relevanceNote: v.string(),
    pageNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // When a match exists, scope ordering by match (preserves AI excerpt
    // ordering); otherwise scope by paper+section so user-added self-cite
    // excerpts sit with their siblings rather than colliding with order 0.
    const existing = args.matchId
      ? await ctx.db
          .query("matchExcerpts")
          .withIndex("by_match", (q: any) => q.eq("matchId", args.matchId))
          .collect()
      : await ctx.db
          .query("matchExcerpts")
          .withIndex("by_paper_section", (q: any) =>
            q.eq("paperId", args.paperId).eq("sectionId", args.sectionId)
          )
          .collect();
    const maxOrder =
      existing.length > 0
        ? Math.max(...existing.map((e) => e.orderIndex))
        : -1;

    return await ctx.db.insert("matchExcerpts", {
      matchId: args.matchId,
      paperId: args.paperId,
      sectionId: args.sectionId,
      excerptText: args.excerptText,
      relevanceNote: args.relevanceNote,
      orderIndex: maxOrder + 1,
      isManual: true,
      pageNumber: args.pageNumber,
    });
  },
});

export const updateExcerpt = mutation({
  args: {
    excerptId: v.id("matchExcerpts"),
    excerptText: v.optional(v.string()),
    relevanceNote: v.optional(v.string()),
    pageNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, string | boolean | undefined> = {};
    if (args.excerptText !== undefined) patch.excerptText = args.excerptText;
    if (args.relevanceNote !== undefined) patch.relevanceNote = args.relevanceNote;
    if (args.pageNumber !== undefined) {
      if (args.pageNumber) {
        // User has manually verified/set a concrete page number
        patch.pageNumber = args.pageNumber;
        patch.pageNumberApproximate = false;
      } else {
        // Clearing the page number — also clear the approximate flag
        patch.pageNumber = undefined;
        patch.pageNumberApproximate = undefined;
      }
    }
    await ctx.db.patch(args.excerptId, patch);
  },
});

export const deleteExcerpt = mutation({
  args: {
    excerptId: v.id("matchExcerpts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.excerptId);
  },
});

export const updateUserNotes = mutation({
  args: {
    matchId: v.id("paperSectionMatches"),
    userNotes: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.matchId, {
      userNotes: args.userNotes || undefined,
    });
  },
});

export const reorderMatches = mutation({
  args: {
    sectionId: v.id("outlineSections"),
    orderedMatchIds: v.array(v.id("paperSectionMatches")),
  },
  handler: async (ctx, args) => {
    for (let i = 0; i < args.orderedMatchIds.length; i++) {
      await ctx.db.patch(args.orderedMatchIds[i], {
        displayOrder: i,
      });
    }
  },
});

/// Persists the per-match expand/collapse state of a paper card so the user's
/// chosen layout survives reloads. Scoped per `paperSectionMatches` row, so
/// a paper can be collapsed in one section and expanded in another.
export const setMatchExpanded = mutation({
  args: {
    matchId: v.id("paperSectionMatches"),
    isExpanded: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.matchId, {
      isExpanded: args.isExpanded,
    });
  },
});

// ===== QUERIES =====

export const getMatchesBySection = query({
  args: { sectionId: v.id("outlineSections") },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("paperSectionMatches")
      .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
      .collect();

    // Join with papers table + count excerpts
    const results = [];
    for (const match of matches) {
      const paper = await ctx.db.get(match.paperId);
      if (paper) {
        const excerpts = await ctx.db
          .query("matchExcerpts")
          .withIndex("by_match", (q: any) => q.eq("matchId", match._id))
          .collect();
        results.push({
          matchId: match._id,
          paperId: match.paperId,
          title: paper.title,
          authors: paper.authors,
          year: paper.year,
          relevanceScore: match.relevanceScore,
          isManualOverride: match.isManualOverride,
          excerptCount: excerpts.length,
          userNotes: match.userNotes,
          displayOrder: match.displayOrder,
          isExpanded: match.isExpanded,
        });
      }
    }
    return results;
  },
});

export const getMatchesByPaper = query({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("paperSectionMatches")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    const results = [];
    for (const match of matches) {
      const section = await ctx.db.get(match.sectionId);
      if (section) {
        results.push({
          matchId: match._id,
          sectionId: match.sectionId,
          sectionTitle: section.title,
          sectionOrderNumber: section.orderNumber,
          sectionDepth: section.depth,
          relevanceScore: match.relevanceScore,
          isManualOverride: match.isManualOverride,
          matchedAt: match.matchedAt,
        });
      }
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results;
  },
});

export const getExcerptsByMatch = query({
  args: { matchId: v.id("paperSectionMatches") },
  handler: async (ctx, args) => {
    const excerpts = await ctx.db
      .query("matchExcerpts")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .collect();

    excerpts.sort((a, b) => a.orderIndex - b.orderIndex);
    return excerpts;
  },
});

/// Returns every excerpt for the given papers, regardless of which section
/// they were originally collected under. Used by the section editor's
/// FUSSNOTEN panel to surface the source quote + relevance note behind each
/// citation — a citation references a *paper*, not a paper-in-this-section,
/// so a section-scoped lookup would hide notes whenever the paper happens to
/// be matched under a different section.
export const getExcerptsByPaperIds = query({
  args: { paperIds: v.array(v.id("papers")) },
  handler: async (ctx, args) => {
    const excerpts: Doc<"matchExcerpts">[] = [];
    for (const paperId of args.paperIds) {
      const rows = await ctx.db
        .query("matchExcerpts")
        .withIndex("by_paper_section", (q) => q.eq("paperId", paperId))
        .collect();
      excerpts.push(...rows);
    }
    excerpts.sort(
      (a, b) =>
        a.paperId.localeCompare(b.paperId) || a.orderIndex - b.orderIndex
    );
    return excerpts;
  },
});

export const getExcerptsByPaperSection = query({
  args: {
    paperId: v.id("papers"),
    sectionId: v.id("outlineSections"),
  },
  handler: async (ctx, args) => {
    const excerpts = await ctx.db
      .query("matchExcerpts")
      .withIndex("by_paper_section", (q) =>
        q.eq("paperId", args.paperId).eq("sectionId", args.sectionId)
      )
      .collect();

    excerpts.sort((a, b) => a.orderIndex - b.orderIndex);
    return excerpts;
  },
});

/// Returns all excerpts joined with their parent paper and section metadata.
/// Used by the global search modal to enable client-side filtering across
/// all collected excerpts.
export const getAllExcerptsWithContext = query({
  args: {},
  handler: async (ctx) => {
    const excerpts = await ctx.db.query("matchExcerpts").collect();

    // Batch-fetch unique papers and sections to avoid N+1 queries
    const paperIds = [...new Set(excerpts.map((e) => e.paperId))];
    const sectionIds = [...new Set(excerpts.map((e) => e.sectionId))];

    const [papers, sections] = await Promise.all([
      Promise.all(paperIds.map((id) => ctx.db.get(id))),
      Promise.all(sectionIds.map((id) => ctx.db.get(id))),
    ]);

    const paperById = new Map(
      paperIds.map((id, i) => [id, papers[i]] as const)
    );
    const sectionById = new Map(
      sectionIds.map((id, i) => [id, sections[i]] as const)
    );

    const results = [];
    for (const excerpt of excerpts) {
      const paper = paperById.get(excerpt.paperId);
      const section = sectionById.get(excerpt.sectionId);

      if (paper && section) {
        results.push({
          excerptId: excerpt._id,
          excerptText: excerpt.excerptText,
          relevanceNote: excerpt.relevanceNote,
          pageNumber: excerpt.pageNumber,
          paperId: paper._id,
          paperTitle: paper.title,
          paperAuthors: paper.authors,
          sectionId: section._id,
          sectionTitle: section.title,
          sectionOrderNumber: section.orderNumber,
          sectionDepth: section.depth,
          sectionNotes: section.notes,
        });
      }
    }
    return results;
  },
});

export const getUnassignedPapers = query({
  args: {},
  handler: async (ctx) => {
    const allPapers = await ctx.db.query("papers").order("desc").collect();

    const results = [];
    for (const paper of allPapers) {
      const matches = await ctx.db
        .query("paperSectionMatches")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect();

      if (matches.length === 0) {
        results.push({ ...paper, bestScore: 0 });
        continue;
      }

      const maxScore = Math.max(...matches.map((m) => m.relevanceScore));
      if (maxScore < 0.5) {
        results.push({ ...paper, bestScore: maxScore });
      }
    }
    return results;
  },
});
