import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ===== MUTATIONS =====

export const createPaper = mutation({
  args: {
    title: v.string(),
    authors: v.array(v.string()),
    year: v.optional(v.number()),
    storageId: v.string(),
    fileUrl: v.string(),
    /// Original filename (e.g. "paper.pdf") used to determine file type in the UI.
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const paperId = await ctx.db.insert("papers", {
      title: args.title,
      authors: args.authors,
      year: args.year,
      storageId: args.storageId,
      fileUrl: args.fileUrl,
      fileName: args.fileName,
      status: "pending",
      uploadedAt: Date.now(),
    });
    return paperId;
  },
});

export const updatePaperStatus = mutation({
  args: {
    paperId: v.id("papers"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paperId, {
      status: args.status,
      ...(args.errorMessage !== undefined && {
        errorMessage: args.errorMessage,
      }),
    });
  },
});

export const updatePaperMetadata = mutation({
  args: {
    paperId: v.id("papers"),
    title: v.string(),
    authors: v.array(v.string()),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paperId, {
      title: args.title,
      authors: args.authors,
      year: args.year,
    });
  },
});

export const updatePaperNotes = mutation({
  args: {
    paperId: v.id("papers"),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paperId, {
      notes: args.notes || undefined,
    });
  },
});

// ===== QUERIES =====

export const getPaper = query({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.paperId);
  },
});

export const listPapers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("papers").order("desc").collect();
  },
});

export const deletePaper = mutation({
  args: {
    paperId: v.id("papers"),
  },
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper) throw new Error("Paper not found");

    // 1. Delete all matchExcerpts referencing this paper
    const excerpts = await ctx.db
      .query("matchExcerpts")
      .withIndex("by_paper_section")
      .filter((q) => q.eq(q.field("paperId"), args.paperId))
      .collect();
    for (const excerpt of excerpts) {
      await ctx.db.delete(excerpt._id);
    }

    // 2. Delete all paperSectionMatches
    const matches = await ctx.db
      .query("paperSectionMatches")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
    for (const match of matches) {
      await ctx.db.delete(match._id);
    }

    // 3. Delete summaries
    const summaries = await ctx.db
      .query("summaries")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
    for (const summary of summaries) {
      await ctx.db.delete(summary._id);
    }

    // 4. Delete paperIdentifiers
    const identifiers = await ctx.db
      .query("paperIdentifiers")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
    for (const identifier of identifiers) {
      await ctx.db.delete(identifier._id);
    }

    // 5. Delete stored PDF file
    if (paper.storageId) {
      await ctx.storage.delete(paper.storageId);
    }

    // 6. Delete the paper record
    await ctx.db.delete(args.paperId);
  },
});

/// Deletes every paper and all associated data (excerpts, matches, summaries,
/// identifiers, and stored files) in a single mutation.
export const deleteAllPapers = mutation({
  args: {},
  handler: async (ctx) => {
    // 1. Delete all matchExcerpts
    const excerpts = await ctx.db.query("matchExcerpts").collect();
    for (const excerpt of excerpts) {
      await ctx.db.delete(excerpt._id);
    }

    // 2. Delete all paperSectionMatches
    const matches = await ctx.db.query("paperSectionMatches").collect();
    for (const match of matches) {
      await ctx.db.delete(match._id);
    }

    // 3. Delete all summaries
    const summaries = await ctx.db.query("summaries").collect();
    for (const summary of summaries) {
      await ctx.db.delete(summary._id);
    }

    // 4. Delete all paperIdentifiers
    const identifiers = await ctx.db.query("paperIdentifiers").collect();
    for (const identifier of identifiers) {
      await ctx.db.delete(identifier._id);
    }

    // 5. Delete stored PDF files and paper records
    const papers = await ctx.db.query("papers").collect();
    for (const paper of papers) {
      if (paper.storageId) {
        await ctx.storage.delete(paper.storageId);
      }
      await ctx.db.delete(paper._id);
    }

    return { deleted: papers.length };
  },
});

// ===== LIBRARY ORDERING =====

export const reorderLibrary = mutation({
  args: {
    orderedPaperIds: v.array(v.id("papers")),
  },
  handler: async (ctx, args) => {
    for (let i = 0; i < args.orderedPaperIds.length; i++) {
      await ctx.db.patch(args.orderedPaperIds[i], {
        libraryDisplayOrder: i,
      });
    }
  },
});

export const resetLibraryOrder = mutation({
  args: {},
  handler: async (ctx) => {
    const papers = await ctx.db.query("papers").collect();
    for (const paper of papers) {
      if (paper.libraryDisplayOrder !== undefined) {
        await ctx.db.patch(paper._id, { libraryDisplayOrder: undefined });
      }
    }
  },
});

// ===== FILE STORAGE =====

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getFileUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
