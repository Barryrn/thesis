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
    // --- Step 0: Validate — reject duplicate orderNumbers ---
    const seen = new Set<string>();
    for (const section of args.sections) {
      if (seen.has(section.orderNumber)) {
        throw new Error(`Duplicate orderNumber: ${section.orderNumber}`);
      }
      seen.add(section.orderNumber);
    }

    // --- Step 1: Sort incoming by depth so parents are processed first ---
    const sorted = [...args.sections].sort((a, b) => a.depth - b.depth);

    // --- Step 2: Load existing sections, index by orderNumber ---
    const existing = await ctx.db
      .query("outlineSections")
      .withIndex("by_version", (q) => q.eq("outlineVersion", args.version))
      .collect();

    const existingByOrder = new Map(
      existing.map((s) => [s.orderNumber, s])
    );

    // --- Step 3: Classify & apply (patch existing or insert new) ---
    const orderNumberToId = new Map<string, Id<"outlineSections">>();
    const incomingOrderNumbers = new Set<string>();

    for (const section of sorted) {
      incomingOrderNumbers.add(section.orderNumber);
      const existingSection = existingByOrder.get(section.orderNumber);

      if (existingSection) {
        // Patch in-place — preserves _id and all FK references
        await ctx.db.patch(existingSection._id, {
          title: section.title,
          depth: section.depth,
          notes: section.notes,
        });
        orderNumberToId.set(section.orderNumber, existingSection._id);
      } else {
        // Insert new section
        const id = await ctx.db.insert("outlineSections", {
          title: section.title,
          orderNumber: section.orderNumber,
          depth: section.depth,
          notes: section.notes,
          outlineVersion: args.version,
        });
        orderNumberToId.set(section.orderNumber, id);
      }
    }

    // --- Step 4: Resolve parentIds (second pass, all IDs now known) ---
    for (const section of args.sections) {
      const sectionId = orderNumberToId.get(section.orderNumber)!;
      const parentId = section.parentOrderNumber
        ? orderNumberToId.get(section.parentOrderNumber)
        : undefined;
      await ctx.db.patch(sectionId, { parentId });
    }

    // --- Step 5: Cascade-delete removed sections ---
    for (const existingSection of existing) {
      if (incomingOrderNumbers.has(existingSection.orderNumber)) continue;

      // Delete matchExcerpts linked to matches for this section
      const matches = await ctx.db
        .query("paperSectionMatches")
        .withIndex("by_section", (q) =>
          q.eq("sectionId", existingSection._id)
        )
        .collect();

      for (const match of matches) {
        const excerpts = await ctx.db
          .query("matchExcerpts")
          .withIndex("by_match", (q) => q.eq("matchId", match._id))
          .collect();
        for (const excerpt of excerpts) {
          await ctx.db.delete(excerpt._id);
        }
        await ctx.db.delete(match._id);
      }

      // Delete the section itself
      await ctx.db.delete(existingSection._id);
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

/// Single-section lookup. Used by the recommendations action so it can read
/// title + notes without scanning the whole outline.
export const getSectionById = query({
  args: { sectionId: v.id("outlineSections") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sectionId);
  },
});
