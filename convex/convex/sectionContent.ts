import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/// Returns the authored content for a section, or null if none exists yet.
export const getSectionContent = query({
  args: { sectionId: v.id("outlineSections") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sectionContent")
      .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
      .first();
  },
});

/// Upserts the authored body text and cited paper IDs for a section.
/// Enforces a one-to-one relationship: patches existing doc or inserts new.
export const saveSectionContent = mutation({
  args: {
    sectionId: v.id("outlineSections"),
    body: v.string(),
    citedPaperIds: v.array(v.id("papers")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sectionContent")
      .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        body: args.body,
        citedPaperIds: args.citedPaperIds,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("sectionContent", {
      sectionId: args.sectionId,
      body: args.body,
      citedPaperIds: args.citedPaperIds,
      updatedAt: now,
    });
  },
});
