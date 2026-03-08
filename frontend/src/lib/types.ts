import type { Id, Doc } from "../../convex/_generated/dataModel";

export type PaperId = Id<"papers">;
export type SectionId = Id<"outlineSections">;
export type Paper = Doc<"papers">;
export type OutlineSection = Doc<"outlineSections">;
export type Summary = Doc<"summaries">;

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
}
