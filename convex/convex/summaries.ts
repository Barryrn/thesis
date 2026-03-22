import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ===== MUTATIONS =====

export const createSummary = mutation({
  args: {
    paperId: v.id("papers"),
    researchQuestion: v.string(),
    methodology: v.string(),
    keyFindings: v.array(v.string()),
    keywords: v.array(v.string()),
    rawSummary: v.string(),
    /// Language code used when this summary was generated (e.g. "en", "de").
    /// Stored so the /cite endpoint can produce excerpts in the same language.
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("summaries", args);
  },
});

export const createIdentifiers = mutation({
  args: {
    paperId: v.id("papers"),
    identifiers: v.array(
      v.object({
        identifierType: v.union(
          v.literal("DOI"),
          v.literal("ISBN"),
          v.literal("arXiv"),
          v.literal("other")
        ),
        identifierValue: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const ids = [];
    for (const identifier of args.identifiers) {
      const id = await ctx.db.insert("paperIdentifiers", {
        paperId: args.paperId,
        identifierType: identifier.identifierType,
        identifierValue: identifier.identifierValue,
      });
      ids.push(id);
    }
    return ids;
  },
});

// ===== QUERIES =====

export const getSummaryByPaper = query({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    const summary = await ctx.db
      .query("summaries")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .first();
    return summary;
  },
});

export const getIdentifiersByPaper = query({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("paperIdentifiers")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
  },
});
