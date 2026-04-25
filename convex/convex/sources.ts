import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// ── Kürzel generation helpers ──────────────────────────────────────────

/// Extracts the surname (last word) from a full name string.
function extractSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/// Strips diacritics/umlauts to produce ASCII-safe Kürzel characters.
/// e.g. "Krämer" → "Kramer", "Günther" → "Gunther"
function normalizeForKuerzel(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/// Generates a base Kürzel from authors + year following HKA rules:
/// - 1 author: first 2 letters of surname (upper) + last 2 digits of year
/// - 2 authors: first letter of each surname (upper) + last 2 digits
/// - 3+ authors: first letter of first 2 surnames (upper) + last 2 digits
function generateBaseKuerzel(authors: string[], year?: number): string {
  if (authors.length === 0) return "XX" + (year ? String(year).slice(-2) : "");

  const surnames = authors.map((a) => normalizeForKuerzel(extractSurname(a)));
  let prefix: string;

  if (surnames.length === 1) {
    prefix = surnames[0].slice(0, 2).toUpperCase();
  } else {
    // 2+ authors: first letter of first two surnames
    prefix = (surnames[0][0] + surnames[1][0]).toUpperCase();
  }

  const yearSuffix = year ? String(year).slice(-2) : "";
  return prefix + yearSuffix;
}

/// Checks all existing sources for Kürzel collisions and appends a/b/c suffixes.
/// Skips sources with manual overrides. Returns the resolved Kürzel for the
/// given paper.
async function resolveKuerzelCollisions(
  ctx: MutationCtx,
  paperId: Id<"papers">,
  baseKuerzel: string
): Promise<string> {
  const allSources = await ctx.db.query("sources").collect();

  // Find sources that share this base Kürzel (excluding the current paper)
  const collisions = allSources.filter(
    (s) =>
      s.paperId !== paperId &&
      !s.kuerzelManualOverride &&
      stripKuerzelSuffix(s.kuerzel) === baseKuerzel
  );

  if (collisions.length === 0) return baseKuerzel;

  // Assign suffixes: existing collision gets "a", new one gets next letter
  const usedSuffixes = new Set<string>();
  for (const c of collisions) {
    const suffix = c.kuerzel.slice(baseKuerzel.length);
    if (suffix) usedSuffixes.add(suffix);
  }

  // If existing collisions don't have suffixes yet, update them
  if (collisions.length > 0 && !collisions.some((c) => c.kuerzel !== baseKuerzel)) {
    // First collision gets "a"
    await ctx.db.patch(collisions[0]._id, { kuerzel: baseKuerzel + "a" });
    usedSuffixes.add("a");
  }

  // Find next available suffix for the new entry
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  for (const letter of alphabet) {
    if (!usedSuffixes.has(letter)) {
      return baseKuerzel + letter;
    }
  }

  return baseKuerzel;
}

/// Strips a trailing single-letter suffix from a Kürzel to recover the base.
/// e.g. "KR09a" → "KR09", "KR09" → "KR09"
function stripKuerzelSuffix(kuerzel: string): string {
  return kuerzel.replace(/[a-z]$/, "");
}

// ── Source type validator ──────────────────────────────────────────────

const sourceTypeValidator = v.union(
  v.literal("book"),
  v.literal("bookChapter"),
  v.literal("journalArticle"),
  v.literal("newspaperArticle"),
  v.literal("internetSource")
);

// ===== QUERIES =====

/// Returns the source record for a given paper (1:1 relationship).
export const getSourceByPaper = query({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sources")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .first();
  },
});

/// Returns all source records joined with basic paper metadata.
/// Used for bibliography rendering and Kürzel collision detection.
export const listAllSources = query({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("sources").collect();
    const result: Array<Doc<"sources"> & { title: string; authors: string[]; year?: number; zoteroItemKey?: string }> = [];

    for (const source of sources) {
      const paper = await ctx.db.get(source.paperId);
      if (paper) {
        result.push({
          ...source,
          title: paper.title,
          authors: paper.authors,
          year: paper.year,
          ...(paper.zoteroItemKey ? { zoteroItemKey: paper.zoteroItemKey } : {}),
        });
      }
    }

    return result;
  },
});

// ===== MUTATIONS =====

/// Creates a new source record linked to a paper.
/// Auto-generates a Kürzel if not provided, with collision detection.
export const createSource = mutation({
  args: {
    paperId: v.id("papers"),
    sourceType: sourceTypeValidator,
    kuerzel: v.optional(v.string()),
    kuerzelManualOverride: v.optional(v.boolean()),
    publisher: v.optional(v.string()),
    publisherLocation: v.optional(v.string()),
    edition: v.optional(v.string()),
    journalName: v.optional(v.string()),
    volume: v.optional(v.string()),
    issue: v.optional(v.string()),
    pageStart: v.optional(v.string()),
    pageEnd: v.optional(v.string()),
    editorNames: v.optional(v.array(v.string())),
    editorBookTitle: v.optional(v.string()),
    newspaperName: v.optional(v.string()),
    publishDate: v.optional(v.string()),
    url: v.optional(v.string()),
    accessDate: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check for existing source (1:1 relationship guard)
    const existing = await ctx.db
      .query("sources")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .first();
    if (existing) {
      throw new Error(`Source already exists for paper ${args.paperId}`);
    }

    // Generate or validate Kürzel
    let kuerzel: string;
    const isManualOverride = args.kuerzelManualOverride ?? false;

    if (args.kuerzel && isManualOverride) {
      kuerzel = args.kuerzel;
    } else {
      const paper = await ctx.db.get(args.paperId);
      if (!paper) throw new Error("Paper not found");
      const base = args.kuerzel ?? generateBaseKuerzel(paper.authors, paper.year);
      kuerzel = await resolveKuerzelCollisions(ctx, args.paperId, base);
    }

    const { kuerzel: _k, kuerzelManualOverride: _m, ...optionalFields } = args;
    return await ctx.db.insert("sources", {
      ...optionalFields,
      kuerzel,
      kuerzelManualOverride: isManualOverride,
    });
  },
});

/// Updates an existing source record. Re-checks Kürzel collisions when
/// the Kürzel changes and is not a manual override.
export const updateSource = mutation({
  args: {
    sourceId: v.id("sources"),
    sourceType: v.optional(sourceTypeValidator),
    kuerzel: v.optional(v.string()),
    kuerzelManualOverride: v.optional(v.boolean()),
    publisher: v.optional(v.string()),
    publisherLocation: v.optional(v.string()),
    edition: v.optional(v.string()),
    journalName: v.optional(v.string()),
    volume: v.optional(v.string()),
    issue: v.optional(v.string()),
    pageStart: v.optional(v.string()),
    pageEnd: v.optional(v.string()),
    editorNames: v.optional(v.array(v.string())),
    editorBookTitle: v.optional(v.string()),
    newspaperName: v.optional(v.string()),
    publishDate: v.optional(v.string()),
    url: v.optional(v.string()),
    accessDate: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.sourceId);
    if (!existing) throw new Error("Source not found");

    const { sourceId, ...patch } = args;

    // Handle Kürzel update with collision detection
    if (patch.kuerzel !== undefined && !patch.kuerzelManualOverride) {
      patch.kuerzel = await resolveKuerzelCollisions(
        ctx,
        existing.paperId,
        patch.kuerzel
      );
    }

    await ctx.db.patch(sourceId, patch);
  },
});

/// Regenerates the Kürzel for a source from the paper's current authors + year.
/// Useful when paper metadata changes. Skips if manual override is set.
export const regenerateKuerzel = mutation({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("sources")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .first();
    if (!source) throw new Error("Source not found for paper");
    if (source.kuerzelManualOverride) return source.kuerzel;

    const paper = await ctx.db.get(args.paperId);
    if (!paper) throw new Error("Paper not found");

    const base = generateBaseKuerzel(paper.authors, paper.year);
    const resolved = await resolveKuerzelCollisions(ctx, args.paperId, base);
    await ctx.db.patch(source._id, { kuerzel: resolved });
    return resolved;
  },
});

/// Creates a manual source with an associated paper record (no PDF upload).
/// Used when adding books, websites, or other non-PDF sources to the bibliography.
export const createManualSource = mutation({
  args: {
    title: v.string(),
    authors: v.array(v.string()),
    year: v.optional(v.number()),
    sourceType: sourceTypeValidator,
    kuerzel: v.optional(v.string()),
    kuerzelManualOverride: v.optional(v.boolean()),
    publisher: v.optional(v.string()),
    publisherLocation: v.optional(v.string()),
    edition: v.optional(v.string()),
    journalName: v.optional(v.string()),
    volume: v.optional(v.string()),
    issue: v.optional(v.string()),
    pageStart: v.optional(v.string()),
    pageEnd: v.optional(v.string()),
    editorNames: v.optional(v.array(v.string())),
    editorBookTitle: v.optional(v.string()),
    newspaperName: v.optional(v.string()),
    publishDate: v.optional(v.string()),
    url: v.optional(v.string()),
    accessDate: v.optional(v.string()),
    language: v.optional(v.string()),
    /// Pasted text content for manual sources (stored on the paper record).
    manualContent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Create the paper record (manual sources are "completed" immediately)
    const paperId = await ctx.db.insert("papers", {
      title: args.title,
      authors: args.authors,
      year: args.year,
      status: "completed",
      uploadedAt: Date.now(),
      manualContent: args.manualContent || undefined,
    });

    // Generate Kürzel
    const isManualOverride = args.kuerzelManualOverride ?? false;
    let kuerzel: string;
    if (args.kuerzel && isManualOverride) {
      kuerzel = args.kuerzel;
    } else {
      const base = args.kuerzel ?? generateBaseKuerzel(args.authors, args.year);
      kuerzel = await resolveKuerzelCollisions(ctx, paperId, base);
    }

    // Create source record with all type-specific fields
    const {
      title: _t, authors: _a, year: _y,
      kuerzel: _k, kuerzelManualOverride: _m,
      manualContent: _mc,
      ...sourceFields
    } = args;

    const sourceId = await ctx.db.insert("sources", {
      paperId,
      kuerzel,
      kuerzelManualOverride: isManualOverride,
      ...sourceFields,
    });

    return { paperId, sourceId };
  },
});

/// Updates a manually created paper's core metadata (title, authors, year).
/// Optionally regenerates the Kürzel when author/year change.
export const updateManualPaper = mutation({
  args: {
    paperId: v.id("papers"),
    title: v.optional(v.string()),
    authors: v.optional(v.array(v.string())),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper) throw new Error("Paper not found");

    const { paperId, ...patch } = args;
    await ctx.db.patch(paperId, patch);

    // Regenerate Kürzel if authors or year changed (unless manual override)
    if (patch.authors !== undefined || patch.year !== undefined) {
      const source = await ctx.db
        .query("sources")
        .withIndex("by_paper", (q) => q.eq("paperId", paperId))
        .first();
      if (source && !source.kuerzelManualOverride) {
        const updatedPaper = await ctx.db.get(paperId);
        if (updatedPaper) {
          const base = generateBaseKuerzel(updatedPaper.authors, updatedPaper.year);
          const resolved = await resolveKuerzelCollisions(ctx, paperId, base);
          await ctx.db.patch(source._id, { kuerzel: resolved });
        }
      }
    }
  },
});

/// Checks if a source is cited in any section and returns the section names.
/// Used to prevent accidental deletion of cited sources.
export const getSourceCitations = query({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    const contents = await ctx.db.query("sectionContent").collect();
    const marker = `{{cite:${args.paperId}`;
    const citedSections: Array<{ sectionId: string; title: string }> = [];

    for (const content of contents) {
      if (content.body.includes(marker)) {
        const section = await ctx.db.get(content.sectionId);
        if (section) {
          citedSections.push({
            sectionId: section._id,
            title: `${section.orderNumber} ${section.title}`,
          });
        }
      }
    }

    return citedSections;
  },
});

/// Deletes a source and its associated paper record.
/// Returns an error if the source is cited in any section.
export const deleteSourceSafe = mutation({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    // Check for citations in section content
    const contents = await ctx.db.query("sectionContent").collect();
    const marker = `{{cite:${args.paperId}`;
    const citedIn: string[] = [];

    for (const content of contents) {
      if (content.body.includes(marker)) {
        const section = await ctx.db.get(content.sectionId);
        if (section) {
          citedIn.push(`${section.orderNumber} ${section.title}`);
        }
      }
    }

    if (citedIn.length > 0) {
      throw new Error(
        `Cannot delete: source is cited in ${citedIn.length} section(s): ${citedIn.join(", ")}`
      );
    }

    // Cascade-delete related records to avoid orphans
    const paperIdentifiers = await ctx.db
      .query("paperIdentifiers")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
    for (const pi of paperIdentifiers) {
      await ctx.db.delete(pi._id);
    }

    const summaries = await ctx.db
      .query("summaries")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
    for (const s of summaries) {
      await ctx.db.delete(s._id);
    }

    const matches = await ctx.db
      .query("paperSectionMatches")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
    for (const m of matches) {
      // Delete excerpts for this match
      const excerpts = await ctx.db
        .query("matchExcerpts")
        .withIndex("by_match", (q) => q.eq("matchId", m._id))
        .collect();
      for (const e of excerpts) {
        await ctx.db.delete(e._id);
      }
      await ctx.db.delete(m._id);
    }

    const memberships = await ctx.db
      .query("paperGroupMemberships")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
    for (const mem of memberships) {
      await ctx.db.delete(mem._id);
    }

    // Delete source record
    const sources = await ctx.db
      .query("sources")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
    for (const source of sources) {
      await ctx.db.delete(source._id);
    }

    // Delete the paper record
    await ctx.db.delete(args.paperId);
  },
});

/// Deletes the source record for a given paper. Called during cascade deletion.
export const deleteSourceByPaper = mutation({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    const sources = await ctx.db
      .query("sources")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
    for (const source of sources) {
      await ctx.db.delete(source._id);
    }
  },
});

// ===== MIGRATION =====

/// One-time migration: creates default source records (type: "book") for
/// all existing papers that don't have one yet. Safe to run multiple times.
export const migrateCreateSourcesForExistingPapers = mutation({
  args: {},
  handler: async (ctx) => {
    const papers = await ctx.db.query("papers").collect();
    let created = 0;

    for (const paper of papers) {
      const existing = await ctx.db
        .query("sources")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .first();

      if (!existing) {
        const base = generateBaseKuerzel(paper.authors, paper.year);
        const kuerzel = await resolveKuerzelCollisions(ctx, paper._id, base);

        await ctx.db.insert("sources", {
          paperId: paper._id,
          sourceType: "book",
          kuerzel,
          kuerzelManualOverride: false,
        });
        created++;
      }
    }

    return { created };
  },
});
