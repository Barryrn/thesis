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

/// Bundles everything the section-writer needs to draft prose for a section
/// in a single round-trip. Intended for the Python /clarify and
/// /generate-section endpoints — they should not have to chain multiple
/// queries to assemble outline + matches + summaries + sources + thesis lang.
export const getGenerationContext = query({
  args: { sectionId: v.id("outlineSections") },
  handler: async (ctx, args) => {
    const section = await ctx.db.get(args.sectionId);
    if (!section) {
      throw new Error(`Section not found: ${args.sectionId}`);
    }

    // Walk the parent chain (depth -> root) so the AI can see hierarchical context.
    const parents: { orderNumber: string; title: string }[] = [];
    let cursorParentId = section.parentId;
    while (cursorParentId) {
      const parent = await ctx.db.get(cursorParentId);
      if (!parent) break;
      parents.unshift({ orderNumber: parent.orderNumber, title: parent.title });
      cursorParentId = parent.parentId;
    }

    // Sibling sections share the same parent (or are top-level when no parent).
    // Excluding self prevents the AI from being primed by the very section it's writing.
    const sameVersion = await ctx.db
      .query("outlineSections")
      .withIndex("by_version", (q) =>
        q.eq("outlineVersion", section.outlineVersion)
      )
      .collect();
    const siblings = sameVersion
      .filter(
        (s) =>
          s._id !== section._id &&
          (s.parentId ?? null) === (section.parentId ?? null)
      )
      .sort((a, b) => a.orderNumber.localeCompare(b.orderNumber))
      .map((s) => ({ orderNumber: s.orderNumber, title: s.title }));

    // Existing prose body (if any) — needed for language detection and so the
    // /generate-section endpoint can confirm whether Replace/Append applies.
    const content = await ctx.db
      .query("sectionContent")
      .withIndex("by_section", (q) => q.eq("sectionId", section._id))
      .first();

    // Mapped papers + their summaries, source Kürzel, and verbatim excerpts.
    // The Kürzel and summary together let the AI form indirect citations;
    // excerpts (with page numbers) ground direct citations.
    const matchRows = await ctx.db
      .query("paperSectionMatches")
      .withIndex("by_section", (q) => q.eq("sectionId", section._id))
      .collect();

    const matches = [];
    for (const match of matchRows) {
      const paper = await ctx.db.get(match.paperId);
      if (!paper) continue;

      const [summary, sourceRows, excerptRows] = await Promise.all([
        ctx.db
          .query("summaries")
          .withIndex("by_paper", (q) => q.eq("paperId", match.paperId))
          .first(),
        ctx.db
          .query("sources")
          .withIndex("by_paper", (q) => q.eq("paperId", match.paperId))
          .collect(),
        ctx.db
          .query("matchExcerpts")
          .withIndex("by_match", (q) => q.eq("matchId", match._id))
          .collect(),
      ]);

      const source = sourceRows[0];
      const excerpts = excerptRows
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((e) => ({
          text: e.excerptText,
          pageNumber: e.pageNumber ?? null,
          relevanceNote: e.relevanceNote,
        }));

      matches.push({
        paperId: match.paperId,
        title: paper.title,
        authors: paper.authors,
        year: paper.year ?? null,
        kuerzel: source?.kuerzel ?? null,
        summary: summary
          ? {
              researchQuestion: summary.researchQuestion,
              methodology: summary.methodology,
              keyFindings: summary.keyFindings,
              keywords: summary.keywords,
              rawSummary: summary.rawSummary,
              language: summary.language ?? null,
            }
          : null,
        excerpts,
      });
    }

    // The thesis language is not a single field on thesisMetadata. We surface
    // a best-effort default ("de" — the project's required German title is
    // mandatory while English is optional) so Python can fall back to it when
    // the section body is too short to language-detect from. Per-summary
    // languages are also returned via matches[].summary.language so the
    // writer can prefer the dominant language of the cited literature.
    const metaDocs = await ctx.db.query("thesisMetadata").collect();
    const meta = metaDocs[0];
    const thesisLanguage =
      meta && meta.titleEN && !meta.titleDE ? "en" : "de";

    return {
      section: {
        _id: section._id,
        orderNumber: section.orderNumber,
        title: section.title,
        depth: section.depth,
        notes: section.notes ?? null,
      },
      parents,
      siblings,
      body: content?.body ?? null,
      matches,
      thesisLanguage,
    };
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
const aiPromptOverrideValidator = v.object({
  prompt: v.optional(v.string()),
  extraContext: v.optional(v.string()),
});

/// Validator for all mode overrides within a single language.
const langOverridesValidator = v.object({
  enhance: v.optional(aiPromptOverrideValidator),
  formalize: v.optional(aiPromptOverrideValidator),
  simplify: v.optional(aiPromptOverrideValidator),
  expand: v.optional(aiPromptOverrideValidator),
});

/// Validator for the full per-section AI prompt overrides object, keyed by language.
const aiPromptOverridesValidator = v.object({
  en: v.optional(langOverridesValidator),
  de: v.optional(langOverridesValidator),
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
