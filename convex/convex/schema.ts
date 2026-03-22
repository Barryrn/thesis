import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  papers: defineTable({
    title: v.string(),
    authors: v.array(v.string()),
    year: v.optional(v.number()),
    storageId: v.string(),
    fileUrl: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
    uploadedAt: v.number(),
    notes: v.optional(v.string()),
    fileName: v.optional(v.string()),
    libraryDisplayOrder: v.optional(v.number()),
  }),

  paperIdentifiers: defineTable({
    paperId: v.id("papers"),
    identifierType: v.union(
      v.literal("DOI"),
      v.literal("ISBN"),
      v.literal("arXiv"),
      v.literal("other")
    ),
    identifierValue: v.string(),
  }).index("by_paper", ["paperId"]),

  summaries: defineTable({
    paperId: v.id("papers"),
    researchQuestion: v.string(),
    methodology: v.string(),
    keyFindings: v.array(v.string()),
    keywords: v.array(v.string()),
    rawSummary: v.string(),
    /// Language code used when this summary was generated (e.g. "en", "de").
    /// Drives citation language so excerpts match the document's language.
    language: v.optional(v.string()),
  }).index("by_paper", ["paperId"]),

  outlineSections: defineTable({
    title: v.string(),
    parentId: v.optional(v.id("outlineSections")),
    orderNumber: v.string(),
    depth: v.number(),
    notes: v.optional(v.string()),
    outlineVersion: v.number(),
  }).index("by_version", ["outlineVersion"]),

  paperSectionMatches: defineTable({
    paperId: v.id("papers"),
    sectionId: v.id("outlineSections"),
    relevanceScore: v.number(),
    isManualOverride: v.boolean(),
    matchedAt: v.number(),
    userNotes: v.optional(v.string()),
    displayOrder: v.optional(v.number()),
  })
    .index("by_paper", ["paperId"])
    .index("by_section", ["sectionId"]),

  matchExcerpts: defineTable({
    matchId: v.id("paperSectionMatches"),
    paperId: v.id("papers"),
    sectionId: v.id("outlineSections"),
    excerptText: v.string(),
    relevanceNote: v.string(),
    orderIndex: v.number(),
    isManual: v.optional(v.boolean()),
    pageNumber: v.optional(v.string()),
  })
    .index("by_match", ["matchId"])
    .index("by_paper_section", ["paperId", "sectionId"]),

  /// Freeform user-defined collections that papers can be tagged into.
  paperGroups: defineTable({
    name: v.string(),
    color: v.string(),
    createdAt: v.number(),
  }),

  /// Many-to-many join between papers and paperGroups.
  paperGroupMemberships: defineTable({
    paperId: v.id("papers"),
    groupId: v.id("paperGroups"),
    addedAt: v.number(),
  })
    .index("by_paper", ["paperId"])
    .index("by_group", ["groupId"])
    .index("by_paper_group", ["paperId", "groupId"]),
});
