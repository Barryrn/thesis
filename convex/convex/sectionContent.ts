import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/// Old citation marker format (pre-HKA): {{cite:paperId::Label}}
const OLD_CITE_REGEX = /\{\{cite:([^:]+)::([^}]+)\}\}/g;

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

/// Validator for per-mode AI prompt override (prompt replacement + extra context).
const aiPromptOverrideValidator = v.optional(
  v.object({
    prompt: v.optional(v.string()),
    extraContext: v.optional(v.string()),
  })
);

/// Validator for the full per-section AI prompt overrides object.
const aiPromptOverridesValidator = v.object({
  enhance: aiPromptOverrideValidator,
  formalize: aiPromptOverrideValidator,
  simplify: aiPromptOverrideValidator,
  expand: aiPromptOverrideValidator,
});

/// Updates only the AI prompt overrides for a section's content.
/// Decoupled from saveSectionContent so prompt edits save instantly
/// without interfering with the debounced body-text autosave.
export const updateAiPromptOverrides = mutation({
  args: {
    sectionId: v.id("outlineSections"),
    aiPromptOverrides: aiPromptOverridesValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sectionContent")
      .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        aiPromptOverrides: args.aiPromptOverrides,
      });
      return existing._id;
    }

    // Create a minimal content doc if the user configures prompts before writing.
    return await ctx.db.insert("sectionContent", {
      sectionId: args.sectionId,
      body: "",
      citedPaperIds: [],
      updatedAt: Date.now(),
      aiPromptOverrides: args.aiPromptOverrides,
    });
  },
});

// ===== MIGRATION =====

/// One-time migration: rewrites old-format citation markers to the new HKA format.
/// Old: {{cite:paperId::Label}} → New: {{cite:paperId::indirect::S. ?}}
/// Defaults all old citations to indirect with placeholder page ref "S. ?"
/// for the user to fill in later. Safe to run multiple times.
export const migrateCitationMarkers = mutation({
  args: {},
  handler: async (ctx) => {
    const contents = await ctx.db.query("sectionContent").collect();
    let updated = 0;

    for (const content of contents) {
      const re = new RegExp(OLD_CITE_REGEX.source, "g");
      if (re.test(content.body)) {
        const newBody = content.body.replace(
          new RegExp(OLD_CITE_REGEX.source, "g"),
          (_match: string, paperId: string, _label: string) =>
            `{{cite:${paperId}::indirect::S. ?}}`
        );
        await ctx.db.patch(content._id, { body: newBody });
        updated++;
      }
    }

    return { updated };
  },
});
