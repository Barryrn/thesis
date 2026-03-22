import { useState, useMemo } from "react";
import PdfViewer from "@/components/PdfViewer";
import { useQuery, useMutation } from "convex/react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { api } from "../../convex/_generated/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  ExternalLink,
  ChevronDown,
  X,
  Plus,
  Search,
  Calendar,
  FileText,
  BookOpen,
  Layers,
  Quote,
  ArrowDownWideNarrow,
  StickyNote,
} from "lucide-react";
import type { Paper, PaperId, SectionId } from "@/lib/types";

interface DocumentPreviewModalProps {
  paper: Paper;
  onClose: () => void;
}

const statusLabels: Record<string, { label: string; className: string }> = {
  completed: { label: "Processed", className: "bg-sage/20 text-sage" },
  processing: { label: "Processing", className: "bg-dusty-blue/20 text-dusty-blue" },
  pending: { label: "Pending", className: "bg-dusty-blue/10 text-dusty-blue/70" },
  failed: { label: "Failed", className: "bg-destructive/20 text-destructive" },
};

function getScoreBadge(score: number) {
  if (score >= 0.7)
    return { label: "Strong", className: "bg-sage/20 text-sage border-sage/30" };
  if (score >= 0.5)
    return { label: "Possible", className: "bg-amber/15 text-amber border-amber/30" };
  return { label: "Weak", className: "bg-destructive/15 text-destructive border-destructive/30" };
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors[0]}, ${authors[1]} et al.`;
}

export default function DocumentPreviewModal({
  paper,
  onClose,
}: DocumentPreviewModalProps) {
  const summary = useQuery(api.summaries.getSummaryByPaper, {
    paperId: paper._id,
  });
  const identifiers = useQuery(api.summaries.getIdentifiersByPaper, {
    paperId: paper._id,
  });
  const assignments = useQuery(api.matches.getMatchesByPaper, {
    paperId: paper._id,
  });
  const sections = useQuery(api.outline.listSections);

  const addMatch = useMutation(api.matches.addMatch);
  const removeMatch = useMutation(api.matches.removeMatch);

  const [showRawSummary, setShowRawSummary] = useState(false);
  const [showAddSection, setShowAddSection] = useState(false);
  const [sectionSearch, setSectionSearch] = useState("");
  const [assignmentSort, setAssignmentSort] = useState<"score" | "order">("score");

  // Determines whether the PDF tab should be shown — only for .pdf uploads.
  const isPdf = paper.fileName?.toLowerCase().endsWith(".pdf") ?? false;
  const [activeTab, setActiveTab] = useState<"summary" | "pdf">("summary");

  const assignedSectionIds = useMemo(
    () => new Set(assignments?.map((a) => a.sectionId) ?? []),
    [assignments]
  );

  const sortedAssignments = useMemo(() => {
    if (!assignments) return undefined;
    const sorted = [...assignments];
    if (assignmentSort === "score") {
      sorted.sort((a, b) => b.relevanceScore - a.relevanceScore);
    } else {
      sorted.sort((a, b) =>
        a.sectionOrderNumber.localeCompare(b.sectionOrderNumber, undefined, {
          numeric: true,
        })
      );
    }
    return sorted;
  }, [assignments, assignmentSort]);

  const availableSections = useMemo(() => {
    if (!sections) return [];
    return sections
      .filter((s) => !assignedSectionIds.has(s._id))
      .filter((s) => {
        if (!sectionSearch.trim()) return true;
        const q = sectionSearch.toLowerCase();
        return (
          s.title.toLowerCase().includes(q) ||
          s.orderNumber.toLowerCase().includes(q)
        );
      });
  }, [sections, assignedSectionIds, sectionSearch]);

  const status = statusLabels[paper.status] ?? statusLabels.pending;

  async function handleAddSection(sectionId: SectionId) {
    await addMatch({ paperId: paper._id, sectionId, relevanceScore: 1.0 });
    setShowAddSection(false);
    setSectionSearch("");
  }

  async function handleRemoveSection(sectionId: SectionId) {
    await removeMatch({ paperId: paper._id, sectionId });
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="sm:max-w-xl overflow-y-auto"
      >
        {/* ─── Header ─── */}
        <SheetHeader className="pb-0">
          <SheetTitle className="heading-serif text-xl text-foreground leading-snug pr-8">
            {paper.title}
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            {formatAuthors(paper.authors)}
            {paper.year ? ` (${paper.year})` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-6">
          {/* ─── Metadata Row ─── */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3" />
              {formatDate(paper.uploadedAt)}
            </span>

            <div className="h-3 w-px bg-border/50" />

            <Badge
              variant="secondary"
              className={`text-[10px] h-5 ${status.className}`}
            >
              {status.label}
            </Badge>

            <div className="h-3 w-px bg-border/50" />

            <a
              href={paper.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-amber hover:text-amber/80 transition-colors"
            >
              <ExternalLink className="size-3" />
              View Original
            </a>
          </div>

          {/* ─── Identifiers ─── */}
          {identifiers && identifiers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {identifiers.map((id) => (
                <span
                  key={id._id}
                  className="text-[10px] px-2 py-0.5 rounded-md bg-muted/50 text-muted-foreground font-mono"
                >
                  {id.identifierType}: {id.identifierValue}
                </span>
              ))}
            </div>
          )}

          {/* ─── Tabs (only shown when a PDF is available) ─── */}
          {isPdf && (
            <div className="flex items-center gap-1 border-b border-border/30 pb-0">
              {(["summary", "pdf"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize rounded-t-md transition-colors border-b-2 -mb-px ${
                    activeTab === tab
                      ? "border-amber text-amber"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}

          {/* ─── PDF tab content ─── */}
          {activeTab === "pdf" && isPdf && (
            <PdfViewer fileUrl={paper.fileUrl} />
          )}

          {/* ─── Summary tab content ─── */}
          {activeTab === "summary" && (
            <>
          {/* ─── Document Notes ─── */}
          <DocumentNotesBlock paper={paper} />

          {/* ─── Summary Content ─── */}
          {summary === undefined && <SummarySkeleton />}

          {summary === null && (
            <div className="rounded-lg border border-border/30 bg-card/50 p-6 text-center">
              <FileText className="size-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground italic">
                Paper has not been processed yet.
              </p>
            </div>
          )}

          {summary && (
            <>
              {/* Keywords */}
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

              {/* Research Question */}
              <SummaryBlock label="Research Question">
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {summary.researchQuestion}
                </p>
              </SummaryBlock>

              {/* Methodology */}
              <SummaryBlock label="Methodology">
                <p className="text-sm text-foreground/70 leading-relaxed">
                  {summary.methodology}
                </p>
              </SummaryBlock>

              {/* Key Findings */}
              <SummaryBlock label="Key Findings">
                <ul className="space-y-1.5">
                  {summary.keyFindings.map((finding, i) => (
                    <li
                      key={i}
                      className="text-sm text-foreground/80 leading-relaxed flex gap-2"
                    >
                      <span className="text-amber/50 shrink-0 mt-0.5">-</span>
                      <span>{finding}</span>
                    </li>
                  ))}
                </ul>
              </SummaryBlock>

              {/* Raw Summary (collapsible) */}
              <div>
                <button
                  onClick={() => setShowRawSummary(!showRawSummary)}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-amber-dim uppercase tracking-wider hover:text-amber transition-colors group"
                >
                  <ChevronDown
                    className={`size-3 transition-transform duration-200 ${
                      showRawSummary ? "rotate-180" : ""
                    }`}
                  />
                  Full Summary
                </button>
                {showRawSummary && (
                  <p className="mt-2 text-sm text-foreground/70 leading-relaxed border-l-2 border-amber/20 pl-3">
                    {summary.rawSummary}
                  </p>
                )}
              </div>
            </>
          )}

          {/* ─── Section Assignments ─── */}
          <div className="border-t border-border/30 pt-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers className="size-3.5 text-amber-dim" />
                <h3 className="text-[11px] font-medium text-amber-dim uppercase tracking-wider">
                  Section Assignments
                </h3>
                {assignments && assignments.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] h-4 px-1.5 bg-amber/10 text-amber"
                  >
                    {assignments.length}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {assignments && assignments.length > 1 && (
                  <div className="flex items-center gap-1">
                    <ArrowDownWideNarrow className="size-3 text-muted-foreground/60" />
                    <button
                      onClick={() => setAssignmentSort("score")}
                      className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${
                        assignmentSort === "score"
                          ? "bg-amber/10 text-amber"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Score
                    </button>
                    <button
                      onClick={() => setAssignmentSort("order")}
                      className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${
                        assignmentSort === "order"
                          ? "bg-amber/10 text-amber"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Order
                    </button>
                  </div>
                )}
                <button
                  onClick={() => setShowAddSection(!showAddSection)}
                  className="inline-flex items-center gap-1 text-xs text-amber hover:text-amber/80 transition-colors"
                >
                  <Plus className="size-3" />
                  Add
                </button>
              </div>
            </div>

            {/* Add Section Dropdown */}
            {showAddSection && (
              <div className="mb-3 rounded-lg border border-border/50 bg-card/80 overflow-hidden">
                <div className="p-2 border-b border-border/30">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search sections..."
                      value={sectionSearch}
                      onChange={(e) => setSectionSearch(e.target.value)}
                      autoFocus
                      className="w-full h-7 pl-7 pr-2 text-xs bg-muted/30 border border-border/50 rounded-md text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/40 transition-all"
                    />
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {availableSections.length === 0 ? (
                    <div className="p-3 text-center">
                      <p className="text-xs text-muted-foreground">
                        {sections?.length === assignedSectionIds.size
                          ? "Assigned to all sections"
                          : "No matching sections"}
                      </p>
                    </div>
                  ) : (
                    availableSections.map((section) => (
                      <button
                        key={section._id}
                        onClick={() => handleAddSection(section._id)}
                        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-amber/5 transition-colors text-xs border-b border-border/10 last:border-0"
                      >
                        <span className="text-[10px] text-amber-dim font-mono shrink-0 w-8">
                          {section.orderNumber}
                        </span>
                        <span className="text-foreground/80 truncate">
                          {section.title}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Assignments List */}
            {sortedAssignments === undefined && <AssignmentsSkeleton />}

            {sortedAssignments && sortedAssignments.length === 0 && (
              <div className="rounded-lg border border-dashed border-border/30 p-5 text-center">
                <BookOpen className="size-6 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  No sections assigned yet — drag this paper
                  <br />
                  to a section or add one above
                </p>
              </div>
            )}

            {sortedAssignments && sortedAssignments.length > 0 && (
              <div className="space-y-2">
                {sortedAssignments.map((assignment) => {
                  const badge = getScoreBadge(assignment.relevanceScore);
                  return (
                    <div
                      key={assignment.matchId}
                      className="group/row rounded-lg border border-border/30 bg-card/30 p-3 hover:border-amber/15 transition-all"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] text-amber-dim font-mono shrink-0 w-8">
                          {assignment.sectionOrderNumber}
                        </span>

                        <span className="text-sm text-foreground/80 truncate flex-1">
                          {assignment.sectionTitle}
                        </span>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {assignment.isManualOverride && (
                            <span className="text-[9px] text-amber-dim/70 uppercase tracking-wider">
                              Manual
                            </span>
                          )}
                          <Badge
                            variant="outline"
                            className={`text-[10px] h-4 px-1.5 ${badge.className}`}
                          >
                            {badge.label}
                          </Badge>
                          <button
                            onClick={() =>
                              handleRemoveSection(assignment.sectionId)
                            }
                            className="opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5 -mr-0.5"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      </div>

                      {/* Relevance bar */}
                      <div className="mt-2 ml-[2.375rem]">
                        <div className="h-0.5 bg-muted/50 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-dim to-amber transition-all"
                            style={{
                              width: `${assignment.relevanceScore * 100}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Excerpts for this assignment */}
                      <AssignmentExcerpts
                        paperId={paper._id}
                        sectionId={assignment.sectionId}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AssignmentExcerpts({
  paperId,
  sectionId,
}: {
  paperId: PaperId;
  sectionId: SectionId;
}) {
  const excerpts = useQuery(api.matches.getExcerptsByPaperSection, {
    paperId,
    sectionId,
  });
  const [expanded, setExpanded] = useState(false);

  if (!excerpts || excerpts.length === 0) return null;

  return (
    <div className="mt-2 ml-[2.375rem]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-amber-dim/70 hover:text-amber-dim transition-colors"
      >
        <Quote className="size-2.5" />
        <span>
          {excerpts.length} excerpt{excerpts.length !== 1 ? "s" : ""}
        </span>
        <ChevronDown
          className={`size-2.5 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-2">
          {excerpts.map((excerpt) => (
            <div key={excerpt._id}>
              <p className="text-[11px] text-foreground/70 leading-relaxed border-l border-amber/20 pl-2 italic">
                &ldquo;{excerpt.excerptText}&rdquo;
              </p>
              <p className="text-[10px] text-muted-foreground/70 pl-2 mt-0.5">
                {excerpt.relevanceNote}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentNotesBlock({ paper }: { paper: Paper }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(paper.notes ?? "");
  const [dirty, setDirty] = useState(false);
  const updateNotes = useMutation(api.papers.updatePaperNotes);

  async function handleSave() {
    await updateNotes({ paperId: paper._id, notes: value });
    setDirty(false);
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-amber-dim uppercase tracking-wider hover:text-amber transition-colors"
      >
        <StickyNote className="size-3" />
        <span>Document Notes</span>
        {paper.notes && (
          <span className="text-[9px] text-muted-foreground normal-case tracking-normal ml-1">
            (has notes)
          </span>
        )}
        <ChevronDown
          className={`size-3 ml-auto transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <Textarea
            placeholder="Add notes about this paper..."
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setDirty(true);
            }}
            className="text-sm min-h-[80px] bg-transparent"
          />
          {dirty && (
            <div className="flex justify-end">
              <Button size="xs" onClick={handleSave}>
                Save Notes
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-[11px] font-medium text-amber-dim uppercase tracking-wider mb-1.5">
        {label}
      </h4>
      {children}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-5 bg-muted/30 rounded-full animate-pulse"
            style={{ width: `${50 + i * 12}px` }}
          />
        ))}
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-muted/30 rounded animate-pulse w-24" />
        <div className="h-3 bg-muted/30 rounded animate-pulse w-full" />
        <div className="h-3 bg-muted/30 rounded animate-pulse w-4/5" />
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-muted/30 rounded animate-pulse w-20" />
        <div className="h-3 bg-muted/30 rounded animate-pulse w-full" />
        <div className="h-3 bg-muted/30 rounded animate-pulse w-3/4" />
      </div>
    </div>
  );
}

function AssignmentsSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-border/20 p-3 animate-pulse"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-3 w-6 bg-muted/30 rounded" />
            <div className="h-3 bg-muted/30 rounded flex-1" />
            <div className="h-4 w-12 bg-muted/30 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
