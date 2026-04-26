import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  papers: defineTable({
    title: v.string(),
    authors: v.array(v.string()),
    year: v.optional(v.number()),
    storageId: v.optional(v.string()),
    fileUrl: v.optional(v.string()),
    /// Zotero item key when imported from a Zotero library.
    zoteroItemKey: v.optional(v.string()),
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
    /// Current pipeline step shown in the UI during processing.
    /// Cleared when status transitions to "completed" or "failed".
    processingStep: v.optional(
      v.union(
        v.literal("downloading"),
        v.literal("extracting"),
        v.literal("identifying"),
        v.literal("summarizing"),
        v.literal("saving")
      )
    ),
    /// Pasted text content for manual sources (no PDF).
    /// Used by the summarizer and citation matcher in place of extracted PDF text.
    manualContent: v.optional(v.string()),
    /// Epoch-ms timestamp of the last summarization run against manualContent.
    /// Compared to content edits to decide whether the "regenerate" button shows.
    manualContentSummarizedAt: v.optional(v.number()),
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
    /// True when the page number is a PDF page index rather than a verified
    /// printed page number. The frontend shows a '~' prefix as a warning.
    pageNumberApproximate: v.optional(v.boolean()),
  })
    .index("by_match", ["matchId"])
    .index("by_paper_section", ["paperId", "sectionId"]),

  /// Authored thesis prose per section, with inline citation markers.
  /// Separate from outlineSections so content survives outline re-imports.
  sectionContent: defineTable({
    sectionId: v.id("outlineSections"),
    /// Raw body text containing {{cite:paperId::direct|indirect::pageRef}} markers.
    body: v.string(),
    /// Cached array of unique paper IDs referenced in body. Recomputed on save.
    citedPaperIds: v.array(v.id("papers")),
    updatedAt: v.number(),
    /// Per-section AI prompt overrides. Each mode can have a full prompt
    /// replacement and/or extra context that appends to the effective base.
    aiPromptOverrides: v.optional(v.object({
      en: v.optional(v.object({
        enhance: v.optional(v.object({ prompt: v.optional(v.string()), extraContext: v.optional(v.string()) })),
        formalize: v.optional(v.object({ prompt: v.optional(v.string()), extraContext: v.optional(v.string()) })),
        simplify: v.optional(v.object({ prompt: v.optional(v.string()), extraContext: v.optional(v.string()) })),
        expand: v.optional(v.object({ prompt: v.optional(v.string()), extraContext: v.optional(v.string()) })),
      })),
      de: v.optional(v.object({
        enhance: v.optional(v.object({ prompt: v.optional(v.string()), extraContext: v.optional(v.string()) })),
        formalize: v.optional(v.object({ prompt: v.optional(v.string()), extraContext: v.optional(v.string()) })),
        simplify: v.optional(v.object({ prompt: v.optional(v.string()), extraContext: v.optional(v.string()) })),
        expand: v.optional(v.object({ prompt: v.optional(v.string()), extraContext: v.optional(v.string()) })),
      })),
    })),
  }).index("by_section", ["sectionId"]),

  /// Bibliographic metadata for a paper, 1:1 extension of the papers table.
  /// Holds source-type-specific fields needed to generate HKA-formatted
  /// bibliography entries and Kürzel-based footnote citations.
  sources: defineTable({
    paperId: v.id("papers"),
    sourceType: v.union(
      v.literal("book"),
      v.literal("bookChapter"),
      v.literal("journalArticle"),
      v.literal("newspaperArticle"),
      v.literal("internetSource")
    ),
    /// Auto-generated abbreviation code (e.g. "KR09"). First 2 letters of
    /// surname + last 2 digits of year. Collisions get a/b/c suffix.
    kuerzel: v.string(),
    /// True when the user has manually overridden the auto-generated Kürzel.
    kuerzelManualOverride: v.boolean(),
    // -- Shared optional fields --
    publisher: v.optional(v.string()),
    publisherLocation: v.optional(v.string()),
    edition: v.optional(v.string()),
    // -- Journal article fields --
    journalName: v.optional(v.string()),
    volume: v.optional(v.string()),
    issue: v.optional(v.string()),
    pageStart: v.optional(v.string()),
    pageEnd: v.optional(v.string()),
    // -- Book chapter (Sammelband) fields --
    editorNames: v.optional(v.array(v.string())),
    editorBookTitle: v.optional(v.string()),
    // -- Newspaper article fields --
    newspaperName: v.optional(v.string()),
    publishDate: v.optional(v.string()),
    // -- Internet source fields --
    url: v.optional(v.string()),
    accessDate: v.optional(v.string()),
    // -- General --
    language: v.optional(v.string()),
  }).index("by_paper", ["paperId"]),

  /// Uploaded images for thesis sections (charts, diagrams, screenshots).
  /// Each figure belongs to a section and is auto-numbered at render/export time
  /// based on section order + orderIndex within the section.
  figures: defineTable({
    sectionId: v.id("outlineSections"),
    /// Convex storage ID for the uploaded image file.
    storageId: v.string(),
    /// User-provided caption displayed below the image (e.g. "Abbildung 1: ...").
    caption: v.string(),
    /// Position within the section's figure list, used for ordering.
    orderIndex: v.number(),
    createdAt: v.number(),
  }).index("by_section", ["sectionId"]),

  /// Singleton table holding thesis-level metadata for the Deckblatt (title page),
  /// abstracts, and the Eidesstattliche Erklärung. Only one document ever exists.
  thesisMetadata: defineTable({
    studentName: v.string(),
    studentAddress: v.optional(v.string()),
    studentEmail: v.optional(v.string()),
    universityEmail: v.optional(v.string()),
    matrikelnummer: v.optional(v.string()),
    /// Thesis title in German.
    titleDE: v.string(),
    /// Thesis title in English.
    titleEN: v.optional(v.string()),
    subtitleDE: v.optional(v.string()),
    subtitleEN: v.optional(v.string()),
    studiengang: v.optional(v.string()),
    /// First examiner (Titel, Vorname, Nachname).
    erstpruefer: v.optional(v.string()),
    /// Second examiner (Titel, Vorname, Nachname).
    zweitpruefer: v.optional(v.string()),
    /// Submission date as ISO string.
    abgabedatum: v.optional(v.string()),
    /// German abstract (~10 lines, ergebnisorientiert).
    abstractDE: v.optional(v.string()),
    /// English abstract (~10 lines).
    abstractEN: v.optional(v.string()),
    /// German keywords (max 10).
    keywordsDE: v.optional(v.array(v.string())),
    /// English keywords (max 10).
    keywordsEN: v.optional(v.array(v.string())),
    /// User-configurable document layout (font, spacing, margins, page numbers).
    /// When absent, HKA defaults are used by the compiler and exporter.
    layoutSettings: v.optional(
      v.object({
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
      })
    ),
    /// User-configurable citation style and bibliography ordering.
    /// When absent, HKA Kürzel footnote style with alphabetical ordering is used.
    citationSettings: v.optional(
      v.object({
        style: v.union(
          v.literal("hkaFootnote"),
          v.literal("numbered"),
          v.literal("authorYear")
        ),
        ordering: v.union(
          v.literal("alphabetical"),
          v.literal("appearance")
        ),
      })
    ),
    /// User-configurable AI prompt overrides per optimization mode.
    /// When absent, the hardcoded baseline prompts in optimizer.py are used.
    aiPromptSettings: v.optional(v.object({
      en: v.optional(v.object({
        enhance: v.optional(v.string()),
        formalize: v.optional(v.string()),
        simplify: v.optional(v.string()),
        expand: v.optional(v.string()),
      })),
      de: v.optional(v.object({
        enhance: v.optional(v.string()),
        formalize: v.optional(v.string()),
        simplify: v.optional(v.string()),
        expand: v.optional(v.string()),
      })),
    })),
  }),

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
