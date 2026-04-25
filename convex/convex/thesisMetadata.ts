import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ===== QUERIES =====

/// Returns the singleton thesis metadata document, or null if not yet created.
export const getMetadata = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("thesisMetadata").collect();
    return docs[0] ?? null;
  },
});

// ===== MUTATIONS =====

/// Convex validator for layout settings — shared between mutations.
const layoutSettingsValidator = v.object({
  fontSize: v.number(),
  lineSpacing: v.number(),
  margins: v.object({
    top: v.number(),
    bottom: v.number(),
    left: v.number(),
    right: v.number(),
  }),
  pageNumbering: v.object({
    position: v.union(v.literal("header"), v.literal("footer")),
    format: v.union(
      v.literal("automatic"),
      v.literal("allArabic"),
      v.literal("allRoman")
    ),
    startPage: v.number(),
  }),
});

/// Creates or updates the thesis metadata singleton.
/// If a document already exists, patches it; otherwise inserts a new one.
export const upsertMetadata = mutation({
  args: {
    studentName: v.string(),
    studentAddress: v.optional(v.string()),
    studentEmail: v.optional(v.string()),
    universityEmail: v.optional(v.string()),
    matrikelnummer: v.optional(v.string()),
    titleDE: v.string(),
    titleEN: v.optional(v.string()),
    subtitleDE: v.optional(v.string()),
    subtitleEN: v.optional(v.string()),
    studiengang: v.optional(v.string()),
    erstpruefer: v.optional(v.string()),
    zweitpruefer: v.optional(v.string()),
    abgabedatum: v.optional(v.string()),
    abstractDE: v.optional(v.string()),
    abstractEN: v.optional(v.string()),
    keywordsDE: v.optional(v.array(v.string())),
    keywordsEN: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("thesisMetadata").collect();

    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, args);
      return existing[0]._id;
    }

    return await ctx.db.insert("thesisMetadata", args);
  },
});

/// Updates only the layout settings on the thesis metadata singleton.
/// Separate from upsertMetadata so the preview panel can auto-save
/// without requiring all mandatory metadata fields.
export const updateLayoutSettings = mutation({
  args: { layoutSettings: layoutSettingsValidator },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("thesisMetadata").collect();

    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, {
        layoutSettings: args.layoutSettings,
      });
      return existing[0]._id;
    }

    // Create a minimal metadata doc if none exists yet.
    return await ctx.db.insert("thesisMetadata", {
      studentName: "",
      titleDE: "",
      layoutSettings: args.layoutSettings,
    });
  },
});
