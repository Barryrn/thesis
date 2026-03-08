import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
    matchId: v.id("paperSectionMatches"),
    paperId: v.id("papers"),
    sectionId: v.id("outlineSections"),
    excerptText: v.string(),
    relevanceNote: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("matchExcerpts")
      .withIndex("by_match", (q: any) => q.eq("matchId", args.matchId))
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
    });
  },
});

export const updateExcerpt = mutation({
  args: {
    excerptId: v.id("matchExcerpts"),
    excerptText: v.optional(v.string()),
    relevanceNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, string> = {};
    if (args.excerptText !== undefined) patch.excerptText = args.excerptText;
    if (args.relevanceNote !== undefined)
      patch.relevanceNote = args.relevanceNote;
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
