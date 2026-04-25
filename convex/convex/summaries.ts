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

/// Upserts a summary for a paper — deletes the existing one (if any) before
/// inserting. Prevents duplicate summaries when re-summarizing manual sources.
export const upsertSummary = mutation({
  args: {
    paperId: v.id("papers"),
    researchQuestion: v.string(),
    methodology: v.string(),
    keyFindings: v.array(v.string()),
    keywords: v.array(v.string()),
    rawSummary: v.string(),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("summaries")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
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

/// Upserts a single identifier for a paper. If an identifier of the same type
/// already exists, it updates the value; otherwise inserts a new record.
/// Allows users to add or correct DOIs from the frontend.
export const upsertIdentifier = mutation({
  args: {
    paperId: v.id("papers"),
    identifierType: v.union(
      v.literal("DOI"),
      v.literal("ISBN"),
      v.literal("arXiv"),
      v.literal("other")
    ),
    identifierValue: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("paperIdentifiers")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    const match = existing.find((id) => id.identifierType === args.identifierType);

    if (match) {
      await ctx.db.patch(match._id, { identifierValue: args.identifierValue });
      return match._id;
    }

    return await ctx.db.insert("paperIdentifiers", {
      paperId: args.paperId,
      identifierType: args.identifierType,
      identifierValue: args.identifierValue,
    });
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

/// Returns all DOI identifiers across all papers. Used by the frontend
/// ZoteroImport component to detect duplicates before importing.
export const listAllDOIs = query({
  args: {},
  handler: async (ctx) => {
    const allIds = await ctx.db.query("paperIdentifiers").collect();
    return allIds
      .filter((id) => id.identifierType === "DOI")
      .map((id) => ({ paperId: id.paperId, doi: id.identifierValue }));
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
