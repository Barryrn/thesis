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
}
