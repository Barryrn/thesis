import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

export const upsertOutlineSections = mutation({
  args: {
    sections: v.array(
      v.object({
        title: v.string(),
        orderNumber: v.string(),
        depth: v.number(),
        parentOrderNumber: v.optional(v.string()),
        notes: v.optional(v.string()),
      })
    ),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    // Delete all existing sections for this version
    const existing = await ctx.db
      .query("outlineSections")
      .withIndex("by_version", (q) => q.eq("outlineVersion", args.version))
      .collect();

    for (const section of existing) {
      await ctx.db.delete(section._id);
    }

    // Insert new sections, building orderNumber → _id map for parent resolution
    const orderNumberToId = new Map<string, Id<"outlineSections">>();

    for (const section of args.sections) {
      let parentId: Id<"outlineSections"> | undefined = undefined;

      if (section.parentOrderNumber !== undefined) {
        const resolved = orderNumberToId.get(section.parentOrderNumber);
        if (resolved) {
          parentId = resolved;
        }
      }

      const id = await ctx.db.insert("outlineSections", {
        title: section.title,
        orderNumber: section.orderNumber,
        depth: section.depth,
        parentId,
        notes: section.notes,
        outlineVersion: args.version,
      });

      orderNumberToId.set(section.orderNumber, id);
    }

    return orderNumberToId.size;
  },
});

export const updateSectionNotes = mutation({
  args: {
    sectionId: v.id("outlineSections"),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sectionId, {
      notes: args.notes || undefined,
    });
  },
});

export const listSections = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("outlineSections").order("asc").collect();
  },
});
