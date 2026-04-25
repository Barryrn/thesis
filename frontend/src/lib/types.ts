import type { Id, Doc } from "../../convex/_generated/dataModel";

/// Fixed colour palette for paper groups.
export const GROUP_COLORS = [
  { label: "Amber",  value: "#F59E0B" },
  { label: "Red",    value: "#EF4444" },
  { label: "Green",  value: "#22C55E" },
  { label: "Blue",   value: "#3B82F6" },
  { label: "Purple", value: "#A855F7" },
  { label: "Pink",   value: "#EC4899" },
  { label: "Teal",   value: "#14B8A6" },
  { label: "Slate",  value: "#64748B" },
] as const;

export type PaperId = Id<"papers">;
export type SectionId = Id<"outlineSections">;
export type GroupId = Id<"paperGroups">;
export type Paper = Doc<"papers">;
export type OutlineSection = Doc<"outlineSections">;
export type Summary = Doc<"summaries">;
export type PaperGroup = Doc<"paperGroups">;

export interface ParsedSection {
  title: string;
  orderNumber: string;
  depth: number;
  parentOrderNumber?: string;
  notes?: string;
}

export interface SectionTreeNode extends OutlineSection {
  children: SectionTreeNode[];
}

export interface DragData {
  type: "paper-card";
  paperId: PaperId;
  sourceSectionId: SectionId | null;
  title: string;
  authors: string[];
  year?: number;
  relevanceScore: number;
  isManualOverride: boolean;
}

export interface UploadFileState {
  file: File;
  status: "queued" | "uploading" | "creating" | "triggering" | "done" | "error";
  error?: string;
  paperId?: PaperId;
  storageId?: string;
}

export interface EditableSectionNode {
  id: string;
  title: string;
  orderNumber: string;
  depth: number;
  parentOrderNumber?: string;
  children: EditableSectionNode[];
  notes?: string;
}

export interface SectionMatch {
  matchId: Id<"paperSectionMatches">;
  paperId: PaperId;
  title: string;
  authors: string[];
  year?: number;
  relevanceScore: number;
  isManualOverride: boolean;
  excerptCount: number;
  userNotes?: string;
  displayOrder?: number;
}

export interface ActiveSection {
  sectionId: SectionId;
  title: string;
  orderNumber: string;
  depth: number;
  notes?: string;
}

export interface PaperSectionAssignment {
  matchId: Id<"paperSectionMatches">;
  sectionId: SectionId;
  sectionTitle: string;
  sectionOrderNumber: string;
  sectionDepth: number;
  relevanceScore: number;
  isManualOverride: boolean;
  matchedAt: number;
}

export interface MatchExcerpt {
  _id: Id<"matchExcerpts">;
  matchId: Id<"paperSectionMatches">;
  paperId: PaperId;
  sectionId: SectionId;
  excerptText: string;
  relevanceNote: string;
  orderIndex: number;
  isManual?: boolean;
  pageNumber?: string;
  /// True when the page number is unverified (PDF page index, not printed page).
  pageNumberApproximate?: boolean;
}

/// Supported bibliography source types per HKA guidelines.
export type SourceType =
  | "book"
  | "bookChapter"
  | "journalArticle"
  | "newspaperArticle"
  | "internetSource";

/// Whether a citation is a direct (wörtliches) or indirect (sinngemäßes) quote.
export type CitationType = "direct" | "indirect";

export type Source = Doc<"sources">;
export type SourceId = Id<"sources">;

/// A parsed citation marker extracted from body text.
export interface ParsedCitation {
  fullMatch: string;
  paperId: string;
  citationType: CitationType;
  pageRef: string;
  /// Present only for secondary source citations ("zitiert nach").
  secondaryPaperId?: string;
  secondaryPageRef?: string;
}

/// A single footnote entry for display in the editor footnote panel.
export interface FootnoteEntry {
  number: number;
  kuerzel: string;
  pageRef: string;
  citationType: CitationType;
  paperId: string;
  /// Present only for secondary source footnotes.
  secondaryKuerzel?: string;
  secondaryPageRef?: string;
}

// ===== ZOTERO IMPORT =====

export interface ZoteroCollection {
  key: string;
  name: string;
  parentCollection: string | false;
}

export interface ZoteroItem {
  key: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  isbn?: string;
  itemType: string;
  sourceType: SourceType;
  hasPdf: boolean;
  pdfAttachmentKey?: string;
  sourceMetadata: {
    publisher?: string;
    journalName?: string;
    volume?: string;
    issue?: string;
    pageStart?: string;
    pageEnd?: string;
    url?: string;
    editorNames?: string[];
    editorBookTitle?: string;
    newspaperName?: string;
    publishDate?: string;
    publisherLocation?: string;
    edition?: string;
    accessDate?: string;
    language?: string;
  };
}

export interface ZoteroImportResult {
  itemKey: string;
  status: "success" | "error";
  paperId?: string;
  error?: string;
}

/// AI text optimization modes available in the write tab toolbar.
export type OptimizeMode = "enhance" | "formalize" | "simplify" | "expand";

/// Maps processingStep values to user-friendly labels shown during paper processing.
export const PROCESSING_STEP_LABELS: Record<string, string> = {
  downloading: "Downloading...",
  extracting: "Extracting text...",
  identifying: "Detecting IDs...",
  summarizing: "Summarizing...",
  saving: "Saving...",
};
