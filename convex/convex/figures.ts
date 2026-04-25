import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ===== QUERIES =====

/// Returns all figures for a given section, ordered by orderIndex.
export const getFiguresBySection = query({
  args: { sectionId: v.id("outlineSections") },
  handler: async (ctx, args) => {
    const figures = await ctx.db
      .query("figures")
      .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
      .collect();

    // Resolve storage URLs for each figure
    const result = await Promise.all(
      figures.map(async (fig) => {
        const url = await ctx.storage.getUrl(fig.storageId);
        return { ...fig, url };
      })
    );

    return result.sort((a, b) => a.orderIndex - b.orderIndex);
  },
});

/// Returns all figures across every section, with resolved storage URLs.
/// Used by the preview modal and export endpoint to build the Abbildungsverzeichnis.
export const getAllFiguresWithUrls = query({
  args: {},
  handler: async (ctx) => {
    const figures = await ctx.db.query("figures").collect();

    const result = await Promise.all(
      figures.map(async (fig) => {
        const url = await ctx.storage.getUrl(fig.storageId);
        const section = await ctx.db.get(fig.sectionId);
        return {
          ...fig,
          url,
          sectionOrderNumber: section?.orderNumber ?? "",
        };
      })
    );

    return result;
  },
});

// ===== MUTATIONS =====

/// Uploads a new figure linked to a section. Auto-assigns orderIndex.
export const uploadFigure = mutation({
  args: {
    sectionId: v.id("outlineSections"),
    storageId: v.string(),
    caption: v.string(),
  },
  handler: async (ctx, args) => {
    // Find the current max orderIndex for this section
    const existing = await ctx.db
      .query("figures")
      .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
      .collect();

    const maxOrder = existing.reduce(
      (max, fig) => Math.max(max, fig.orderIndex),
      -1
    );

    return await ctx.db.insert("figures", {
      sectionId: args.sectionId,
      storageId: args.storageId,
      caption: args.caption,
      orderIndex: maxOrder + 1,
      createdAt: Date.now(),
    });
  },
});

/// Updates the caption of an existing figure.
export const updateFigureCaption = mutation({
  args: {
    figureId: v.id("figures"),
    caption: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.figureId, { caption: args.caption });
  },
});

/// Reorders figures within a section by assigning new orderIndex values.
export const reorderFigures = mutation({
  args: {
    sectionId: v.id("outlineSections"),
    orderedFigureIds: v.array(v.id("figures")),
  },
  handler: async (ctx, args) => {
    for (let i = 0; i < args.orderedFigureIds.length; i++) {
      await ctx.db.patch(args.orderedFigureIds[i], { orderIndex: i });
    }
  },
});

/// Deletes a figure and its associated storage blob.
export const deleteFigure = mutation({
  args: { figureId: v.id("figures") },
  handler: async (ctx, args) => {
    const figure = await ctx.db.get(args.figureId);
    if (!figure) return;

    // Delete the storage blob
    await ctx.storage.delete(figure.storageId);
    // Delete the figure record
    await ctx.db.delete(args.figureId);
  },
});

/// Generates an upload URL for storing a figure image in Convex storage.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
