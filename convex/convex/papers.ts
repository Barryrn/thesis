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
      v.literal("failed"),
      v.literal("cancelled")
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.errorMessage !== undefined) {
      patch.errorMessage = args.errorMessage;
    }
    // Clear processingStep when transitioning to a terminal state
    // (`cancelled` is terminal alongside `completed` and `failed`).
    if (
      args.status === "completed" ||
      args.status === "failed" ||
      args.status === "cancelled"
    ) {
      patch.processingStep = undefined;
    }
    await ctx.db.patch(args.paperId, patch);
  },
});

/// Marks a paper as `cancelled` so the Python pipeline aborts at the
/// next between-stage status check. Idempotent: only flips status when
/// the paper is in a cancellable state (`pending` or `processing`).
/// Already-terminal states (`completed`, `failed`, `cancelled`) are
/// no-ops so a stale Stop click can't undo a successful run.
export const cancelPaperProcessing = mutation({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper) return { cancelled: false, reason: "not_found" as const };
    if (paper.status !== "pending" && paper.status !== "processing") {
      return { cancelled: false, reason: "not_cancellable" as const };
    }
    await ctx.db.patch(args.paperId, {
      status: "cancelled",
      processingStep: undefined,
    });
    return { cancelled: true, reason: null };
  },
});

/// Updates the current pipeline step for a paper being processed.
/// Called by the Python backend before each processing stage so the
/// frontend can show real-time progress.
export const updateProcessingStep = mutation({
  args: {
    paperId: v.id("papers"),
    step: v.optional(
      v.union(
        v.literal("downloading"),
        v.literal("extracting"),
        v.literal("identifying"),
        v.literal("summarizing"),
        v.literal("saving")
      )
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paperId, {
      processingStep: args.step,
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

/// Updates the pasted text content for a manual source and clears the
/// summarization timestamp so the UI knows the summary is stale.
export const updateManualContent = mutation({
  args: {
    paperId: v.id("papers"),
    manualContent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paperId, {
      manualContent: args.manualContent || undefined,
      manualContentSummarizedAt: undefined,
    });
  },
});

/// Sets the manualContentSummarizedAt timestamp after a successful summarization.
/// Called by the Python backend when /process-manual completes.
export const setManualContentSummarizedAt = mutation({
  args: {
    paperId: v.id("papers"),
    manualContentSummarizedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paperId, {
      manualContentSummarizedAt: args.manualContentSummarizedAt,
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

/// Returns paperId and zoteroItemKey for all Zotero-imported papers.
/// Used by the ZoteroImport browser to identify which items are already imported.
export const listZoteroKeys = query({
  args: {},
  handler: async (ctx) => {
    const papers = await ctx.db.query("papers").collect();
    return papers
      .filter((p) => p.zoteroItemKey)
      .map((p) => ({ _id: p._id, zoteroItemKey: p.zoteroItemKey! }));
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

    // 4b. Delete source record
    const sources = await ctx.db
      .query("sources")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
    for (const source of sources) {
      await ctx.db.delete(source._id);
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

    // 4b. Delete all source records
    const sources = await ctx.db.query("sources").collect();
    for (const source of sources) {
      await ctx.db.delete(source._id);
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

// ===== ZOTERO IMPORT =====

/// Creates a paper record from Zotero metadata. Unlike `createPaper`, file
/// fields are optional — papers without a PDF get status "completed" immediately
/// since there is nothing to process until the user attaches a file.
export const createPaperFromZotero = mutation({
  args: {
    title: v.string(),
    authors: v.array(v.string()),
    year: v.optional(v.number()),
    storageId: v.optional(v.string()),
    fileUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    zoteroItemKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("papers", {
      title: args.title,
      authors: args.authors,
      year: args.year,
      storageId: args.storageId,
      fileUrl: args.fileUrl,
      fileName: args.fileName,
      zoteroItemKey: args.zoteroItemKey,
      status: args.storageId ? "pending" : "completed",
      uploadedAt: Date.now(),
    });
  },
});

/// Attaches a PDF file to a metadata-only paper (e.g. imported from Zotero
/// without a PDF). Sets status to "pending" so the processing pipeline picks
/// it up.
export const attachFileToPaper = mutation({
  args: {
    paperId: v.id("papers"),
    storageId: v.string(),
    fileUrl: v.string(),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paperId, {
      storageId: args.storageId,
      fileUrl: args.fileUrl,
      fileName: args.fileName,
      status: "pending",
    });
  },
});

/// Links an existing paper to a Zotero library item. Called by the /process
/// pipeline after creating or finding a Zotero item for an uploaded paper.
export const updateZoteroItemKey = mutation({
  args: {
    paperId: v.id("papers"),
    zoteroItemKey: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paperId, {
      zoteroItemKey: args.zoteroItemKey,
    });
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
