import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  GripVertical,
  ChevronDown,
  Quote,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  StickyNote,
  HelpCircle,
  Lightbulb,
  FlaskConical,
  FileText,
  Unlink,
} from "lucide-react";
import type {
  SectionMatch,
  SectionId,
  DragData,
  MatchExcerpt,
} from "@/lib/types";
import type { Id } from "../../convex/_generated/dataModel";

interface PaperSummaryCardProps {
  match: SectionMatch;
  sectionId: SectionId;
  sortable?: boolean;
}

function getScoreBadge(score: number) {
  if (score >= 0.7)
    return {
      label: "Strong",
      className: "bg-sage/20 text-sage border-sage/30",
    };
  if (score >= 0.5)
    return {
      label: "Possible",
      className: "bg-amber/15 text-amber border-amber/30",
    };
  return {
    label: "Weak",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  };
}

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= 2) return authors.join(", ");
  return `${authors[0]}, ${authors[1]} et al.`;
}

// --- CollapsibleSection sub-component ---

function CollapsibleSection({
  icon: Icon,
  label,
  defaultOpen = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <div className="border-t border-border/20 pt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-amber-dim uppercase tracking-wider hover:text-amber transition-colors w-full"
      >
        <Icon className="size-3" />
        <span>{label}</span>
        <ChevronDown
          className={`size-3 ml-auto transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      {expanded && <div className="mt-2">{children}</div>}
    </div>
  );
}

// --- ExcerptItem sub-component ---

function ExcerptItem({
  excerpt,
  onUpdate,
  onDelete,
}: {
  excerpt: MatchExcerpt;
  onUpdate: (args: {
    excerptId: Id<"matchExcerpts">;
    excerptText?: string;
    relevanceNote?: string;
    pageNumber?: string;
  }) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(excerpt.excerptText);
  const [editNote, setEditNote] = useState(excerpt.relevanceNote);
  const [editPageNumber, setEditPageNumber] = useState(excerpt.pageNumber ?? "");

  async function handleSave() {
    await onUpdate({
      excerptId: excerpt._id,
      excerptText: editText,
      relevanceNote: editNote,
      pageNumber: editPageNumber.trim() || undefined,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="space-y-2 p-2 rounded-md bg-muted/20 border border-border/20">
        <Textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="text-sm min-h-[60px]"
          placeholder="Excerpt text..."
        />
        <Textarea
          value={editNote}
          onChange={(e) => setEditNote(e.target.value)}
          className="text-sm min-h-[40px]"
          placeholder="Relevance note (optional)"
        />
        <Input
          value={editPageNumber}
          onChange={(e) => setEditPageNumber(e.target.value)}
          className="text-sm h-8"
          placeholder="Page (e.g. 42 or 42–45)"
        />
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="xs" onClick={() => setEditing(false)}>
            <X className="size-3" /> Cancel
          </Button>
          <Button size="xs" onClick={handleSave}>
            <Check className="size-3" /> Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group/excerpt space-y-1 relative">
      <blockquote className="text-sm text-foreground/80 leading-relaxed border-l-2 border-amber/30 pl-3 italic">
        &ldquo;{excerpt.excerptText}&rdquo;
      </blockquote>
      {excerpt.pageNumber && (
        <p className="text-[10px] text-muted-foreground/60 pl-3">
          p. {excerpt.pageNumber}
        </p>
      )}
      <div className="flex items-start justify-between">
        <p className="text-[11px] text-muted-foreground pl-3 flex-1">
          {excerpt.relevanceNote}
        </p>
        <div className="opacity-0 group-hover/excerpt:opacity-100 transition-opacity flex items-center gap-1 shrink-0 ml-2">
          {excerpt.isManual && (
            <span className="text-[9px] text-amber-dim/50 self-center mr-1">
              manual
            </span>
          )}
          <button
            onClick={() => setEditing(true)}
            className="text-muted-foreground/40 hover:text-amber transition-colors p-0.5"
          >
            <Pencil className="size-3" />
          </button>
          <button
            onClick={onDelete}
            className="text-muted-foreground/40 hover:text-destructive transition-colors p-0.5"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main component ---

export default function PaperSummaryCard({
  match,
  sectionId,
  sortable = false,
}: PaperSummaryCardProps) {
  const summary = useQuery(api.summaries.getSummaryByPaper, {
    paperId: match.paperId,
  });

  const paper = useQuery(api.papers.getPaper, {
    paperId: match.paperId,
  });

  const excerpts = useQuery(api.matches.getExcerptsByMatch, {
    matchId: match.matchId,
  });

  const [excerptsExpanded, setExcerptsExpanded] = useState(false);

  // Add excerpt form state
  const [showAddExcerpt, setShowAddExcerpt] = useState(false);
  const [newExcerptText, setNewExcerptText] = useState("");
  const [newRelevanceNote, setNewRelevanceNote] = useState("");
  const [newPageNumber, setNewPageNumber] = useState("");

  // Additional notes state
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [notesValue, setNotesValue] = useState(match.userNotes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);

  // Mutations
  const addExcerptMutation = useMutation(api.matches.addExcerpt);
  const updateExcerptMutation = useMutation(api.matches.updateExcerpt);
  const deleteExcerptMutation = useMutation(api.matches.deleteExcerpt);
  const updateUserNotesMutation = useMutation(api.matches.updateUserNotes);
  const removeMatchMutation = useMutation(api.matches.removeMatch);
  const updatePaperNotesMutation = useMutation(api.papers.updatePaperNotes);

  // Document notes state
  const [docNotesExpanded, setDocNotesExpanded] = useState(false);
  const [docNotesValue, setDocNotesValue] = useState(paper?.notes ?? "");
  const [docNotesDirty, setDocNotesDirty] = useState(false);

  const dragData = {
    type: "paper-card",
    paperId: match.paperId,
    sourceSectionId: sectionId,
    title: match.title,
    authors: match.authors,
    year: match.year,
    relevanceScore: match.relevanceScore,
    isManualOverride: match.isManualOverride,
  } satisfies DragData;

  const dragId = `paper-${sectionId}-${match.paperId}`;

  const sortableResult = useSortable({
    id: match.matchId,
    data: dragData,
    disabled: !sortable,
  });

  const draggableResult = useDraggable({
    id: dragId,
    data: dragData,
    disabled: sortable,
  });

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = sortable ? sortableResult : draggableResult;

  const style = sortable
    ? {
        transform: CSS.Transform.toString(sortableResult.transform),
        transition: sortableResult.transition ?? undefined,
      }
    : transform
      ? { transform: CSS.Translate.toString(transform) }
      : undefined;

  const badge = getScoreBadge(match.relevanceScore);

  async function handleAddExcerpt() {
    if (!newExcerptText.trim()) return;
    await addExcerptMutation({
      matchId: match.matchId,
      paperId: match.paperId,
      sectionId: sectionId,
      excerptText: newExcerptText.trim(),
      relevanceNote: newRelevanceNote.trim(),
      pageNumber: newPageNumber.trim() || undefined,
    });
    setNewExcerptText("");
    setNewRelevanceNote("");
    setNewPageNumber("");
    setShowAddExcerpt(false);
  }

  async function handleDeleteExcerpt(excerptId: Id<"matchExcerpts">) {
    await deleteExcerptMutation({ excerptId });
  }

  async function handleSaveNotes() {
    await updateUserNotesMutation({
      matchId: match.matchId,
      userNotes: notesValue,
    });
    setNotesDirty(false);
  }

  async function handleSaveDocNotes() {
    await updatePaperNotesMutation({
      paperId: match.paperId,
      notes: docNotesValue,
    });
    setDocNotesDirty(false);
  }

  async function handleUnlink() {
    if (
      window.confirm(
        `Unlink "${match.title}" from this section? Associated excerpts will also be removed.`
      )
    ) {
      await removeMatchMutation({ paperId: match.paperId, sectionId });
    }
  }

  const excerptCount = excerpts?.length ?? 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group bg-card rounded-lg border border-border/50 p-5 transition-all hover:border-amber/20 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-amber transition-colors shrink-0"
        >
          <GripVertical className="size-4" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="heading-serif text-lg text-foreground leading-snug">
            {match.title}
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatAuthors(match.authors)}
            {match.year ? ` (${match.year})` : ""}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Badge variant="outline" className={`text-xs ${badge.className}`}>
            {badge.label}
          </Badge>
          {match.isManualOverride && (
            <span className="text-[10px] text-amber-dim">Manual</span>
          )}
          <button
            onClick={handleUnlink}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all p-0.5"
            title="Unlink from this section"
          >
            <Unlink className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Relevance bar */}
      <div className="mt-3 ml-7">
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-dim to-amber transition-all"
            style={{ width: `${match.relevanceScore * 100}%` }}
          />
        </div>
      </div>

      {/* Summary content */}
      <div className="mt-4 ml-7 space-y-4">
        {summary === undefined && (
          <div className="space-y-2">
            <div className="h-3 bg-muted/50 rounded animate-pulse w-3/4" />
            <div className="h-3 bg-muted/50 rounded animate-pulse w-1/2" />
            <div className="h-3 bg-muted/50 rounded animate-pulse w-2/3" />
          </div>
        )}

        {summary === null && (
          <p className="text-sm text-muted-foreground italic">
            Paper has not been processed yet.
          </p>
        )}

        {summary && (
          <>
            {summary.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {summary.keywords.map((kw) => (
                  <span
                    key={kw}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-dusty-blue/20 text-dusty-blue bg-dusty-blue/5"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            )}

            <CollapsibleSection icon={HelpCircle} label="Research Question" defaultOpen>
              <p className="text-sm text-foreground/80 leading-relaxed">
                {summary.researchQuestion}
              </p>
            </CollapsibleSection>

            <CollapsibleSection icon={Lightbulb} label="Key Findings" defaultOpen>
              <ul className="space-y-1">
                {summary.keyFindings.map((finding, i) => (
                  <li
                    key={i}
                    className="text-sm text-foreground/80 leading-relaxed flex gap-2"
                  >
                    <span className="text-amber/60 shrink-0 mt-0.5">-</span>
                    <span>{finding}</span>
                  </li>
                ))}
              </ul>
            </CollapsibleSection>

            <CollapsibleSection icon={FlaskConical} label="Methodology">
              <p className="text-sm text-foreground/70 leading-relaxed">
                {summary.methodology}
              </p>
            </CollapsibleSection>

            <CollapsibleSection icon={FileText} label="Full Summary">
              <p className="text-sm text-foreground/70 leading-relaxed border-l-2 border-amber/20 pl-3">
                {summary.rawSummary}
              </p>
            </CollapsibleSection>

            {/* Supporting excerpts */}
            {excerpts && (
              <div className="border-t border-border/20 pt-3">
                <button
                  onClick={() => setExcerptsExpanded(!excerptsExpanded)}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-amber-dim uppercase tracking-wider hover:text-amber transition-colors w-full"
                >
                  <Quote className="size-3" />
                  <span>
                    {excerptCount > 0
                      ? `${excerptCount} Supporting Excerpt${excerptCount !== 1 ? "s" : ""}`
                      : "Supporting Excerpts"}
                  </span>
                  <ChevronDown
                    className={`size-3 ml-auto transition-transform duration-200 ${
                      excerptsExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {excerptsExpanded && (
                  <div className="mt-3 space-y-3">
                    {excerpts.map((excerpt) => (
                      <ExcerptItem
                        key={excerpt._id}
                        excerpt={excerpt}
                        onUpdate={updateExcerptMutation}
                        onDelete={() => handleDeleteExcerpt(excerpt._id)}
                      />
                    ))}

                    {excerptCount === 0 && !showAddExcerpt && (
                      <p className="text-[11px] text-muted-foreground/60 italic">
                        No excerpts yet.
                      </p>
                    )}

                    {showAddExcerpt ? (
                      <div className="mt-2 space-y-2 p-3 rounded-md bg-muted/30 border border-border/30">
                        <Textarea
                          placeholder="Paste or type the excerpt text..."
                          value={newExcerptText}
                          onChange={(e) => setNewExcerptText(e.target.value)}
                          className="text-sm min-h-[60px]"
                        />
                        <Textarea
                          placeholder="Why is this relevant? (optional)"
                          value={newRelevanceNote}
                          onChange={(e) => setNewRelevanceNote(e.target.value)}
                          className="text-sm min-h-[40px]"
                        />
                        <Input
                          placeholder="Page (e.g. 42 or 42–45)"
                          value={newPageNumber}
                          onChange={(e) => setNewPageNumber(e.target.value)}
                          className="text-sm h-8"
                        />
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              setShowAddExcerpt(false);
                              setNewExcerptText("");
                              setNewRelevanceNote("");
                              setNewPageNumber("");
                            }}
                          >
                            <X className="size-3" /> Cancel
                          </Button>
                          <Button
                            size="xs"
                            onClick={handleAddExcerpt}
                            disabled={!newExcerptText.trim()}
                          >
                            <Check className="size-3" /> Add
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowAddExcerpt(true)}
                        className="flex items-center gap-1 text-[11px] text-amber-dim/60 hover:text-amber transition-colors"
                      >
                        <Plus className="size-3" /> Add excerpt
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}


          </>
        )}

        {/* Section Notes (per-paper per-section) — always visible for linked papers */}
        <div className="border-t border-border/20 pt-3">
          <button
            onClick={() => setNotesExpanded(!notesExpanded)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-amber-dim uppercase tracking-wider hover:text-amber transition-colors w-full"
          >
            <StickyNote className="size-3" />
            <span>Section Notes</span>
            {match.userNotes && (
              <span className="text-[9px] text-muted-foreground normal-case tracking-normal ml-1">
                (has notes)
              </span>
            )}
            <ChevronDown
              className={`size-3 ml-auto transition-transform duration-200 ${
                notesExpanded ? "rotate-180" : ""
              }`}
            />
          </button>

          {notesExpanded && (
            <div className="mt-2 space-y-2">
              <Textarea
                placeholder="Add notes about this paper's relevance to this section..."
                value={notesValue}
                onChange={(e) => {
                  setNotesValue(e.target.value);
                  setNotesDirty(true);
                }}
                className="text-sm min-h-[80px] bg-transparent"
              />
              {notesDirty && (
                <div className="flex justify-end">
                  <Button size="xs" onClick={handleSaveNotes}>
                    Save Notes
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Document Notes (global, per-paper) — always visible for linked papers */}
        <div className="border-t border-border/20 pt-3">
          <button
            onClick={() => setDocNotesExpanded(!docNotesExpanded)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-amber-dim uppercase tracking-wider hover:text-amber transition-colors w-full"
          >
            <FileText className="size-3" />
            <span>Document Notes</span>
            {paper?.notes && (
              <span className="text-[9px] text-muted-foreground normal-case tracking-normal ml-1">
                (has notes)
              </span>
            )}
            <ChevronDown
              className={`size-3 ml-auto transition-transform duration-200 ${
                docNotesExpanded ? "rotate-180" : ""
              }`}
            />
          </button>

          {docNotesExpanded && (
            <div className="mt-2 space-y-2">
              <Textarea
                placeholder="Add general notes about this paper..."
                value={docNotesValue}
                onChange={(e) => {
                  setDocNotesValue(e.target.value);
                  setDocNotesDirty(true);
                }}
                className="text-sm min-h-[80px] bg-transparent"
              />
              {docNotesDirty && (
                <div className="flex justify-end">
                  <Button size="xs" onClick={handleSaveDocNotes}>
                    Save Notes
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
