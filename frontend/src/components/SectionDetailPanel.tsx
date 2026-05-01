import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "convex/react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { api } from "../../convex/_generated/api";
import { BookOpen, ArrowDownWideNarrow, Quote, ChevronDown, StickyNote, Pencil, PenLine } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import PaperSummaryCard from "./PaperSummaryCard";
import SectionWriteEditor from "./SectionWriteEditor";
import type { ActiveSection, SectionId } from "@/lib/types";
import type { Id } from "../../convex/_generated/dataModel";

type PaperSort = "relevance" | "excerpts" | "manual";
type CenterTab = "papers" | "write";

interface SectionDetailPanelProps {
  activeSection: ActiveSection | null;
  onMatchOrderChange?: (matchIds: Id<"paperSectionMatches">[]) => void;
}

export default function SectionDetailPanel({
  activeSection,
  onMatchOrderChange,
}: SectionDetailPanelProps) {
  if (!activeSection) {
    return <EmptyState />;
  }

  return (
    <SectionContent
      activeSection={activeSection}
      onMatchOrderChange={onMatchOrderChange}
    />
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-5">
        <BookOpen className="size-7 text-amber-dim" />
      </div>
      <h2 className="heading-serif text-2xl text-foreground/80 mb-2">
        {t("sectionDetail.selectSection")}
      </h2>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
        {t("sectionDetail.selectSectionHint")}
      </p>
    </div>
  );
}

function SectionContent({
  activeSection,
  onMatchOrderChange,
}: {
  activeSection: ActiveSection;
  onMatchOrderChange?: (matchIds: Id<"paperSectionMatches">[]) => void;
}) {
  const { t } = useTranslation();
  const [sortBy, setSortBy] = useState<PaperSort>("relevance");
  const [activeTab, setActiveTab] = useState<CenterTab>("papers");

  const matches =
    useQuery(api.matches.getMatchesBySection, {
      sectionId: activeSection.sectionId,
    }) ?? [];

  const sortedMatches = useMemo(() => {
    const sorted = [...matches];
    if (sortBy === "manual") {
      sorted.sort((a, b) => {
        const aOrder = a.displayOrder ?? Infinity;
        const bOrder = b.displayOrder ?? Infinity;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return b.relevanceScore - a.relevanceScore;
      });
    } else if (sortBy === "relevance") {
      sorted.sort(
        (a, b) =>
          b.relevanceScore - a.relevanceScore ||
          b.excerptCount - a.excerptCount
      );
    } else {
      sorted.sort(
        (a, b) =>
          b.excerptCount - a.excerptCount ||
          b.relevanceScore - a.relevanceScore
      );
    }
    return sorted;
  }, [matches, sortBy]);

  // Report current match order to parent for reorder handling
  useEffect(() => {
    if (sortBy === "manual") {
      onMatchOrderChange?.(sortedMatches.map((m) => m.matchId));
    }
  }, [sortedMatches, sortBy, onMatchOrderChange]);

  const { setNodeRef, isOver } = useDroppable({
    id: `section-detail-${activeSection.sectionId}`,
    // type: "section-detail" distinguishes this drop zone from sidebar nodes,
    // which use type: "outline-section" and trigger GPT citation instead.
    data: { type: "section-detail", sectionId: activeSection.sectionId },
  });

  return (
    <div ref={setNodeRef} className="p-6 min-h-full">
      {/* Section header */}
      <div className="mb-6 pb-4 border-b border-border/30">
        <span className="text-xs text-amber-dim font-mono tracking-wide">
          {activeSection.orderNumber}
        </span>
        <h2 className="heading-serif text-2xl text-foreground mt-1 leading-snug">
          {activeSection.title}
        </h2>
        <EditableNotesDropdown
          notes={activeSection.notes}
          sectionId={activeSection.sectionId}
        />

        {/* Tab toggle: Papers / Write */}
        <div className="flex items-center gap-1 mt-3">
          <button
            onClick={() => setActiveTab("papers")}
            className={`text-[11px] px-3 py-1 rounded-full transition-colors flex items-center gap-1.5 ${
              activeTab === "papers"
                ? "bg-amber/10 text-amber"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BookOpen className="size-3" />
            {t("sectionDetail.tabPapers")}
            {matches.length > 0 && (
              <span className="text-[10px] opacity-60">{matches.length}</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("write")}
            className={`text-[11px] px-3 py-1 rounded-full transition-colors flex items-center gap-1.5 ${
              activeTab === "write"
                ? "bg-amber/10 text-amber"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <PenLine className="size-3" />
            {t("sectionDetail.tabWrite")}
          </button>
        </div>

        {/* Sort controls — only visible on Papers tab */}
        {activeTab === "papers" && (
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-sm text-muted-foreground">
              {matches.length === 0
                ? t("sectionDetail.noPapersAssigned")
                : t("sectionDetail.papersAssigned", { count: matches.length })}
            </p>

            {matches.length > 1 && (
              <div className="flex items-center gap-1">
                <ArrowDownWideNarrow className="size-3 text-muted-foreground/60" />
                <button
                  onClick={() => setSortBy("relevance")}
                  className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                    sortBy === "relevance"
                      ? "bg-amber/10 text-amber"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("sectionDetail.sortRelevance")}
                </button>
                <button
                  onClick={() => setSortBy("excerpts")}
                  className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                    sortBy === "excerpts"
                      ? "bg-amber/10 text-amber"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("sectionDetail.sortExcerpts")}
                </button>
                <button
                  onClick={() => setSortBy("manual")}
                  className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                    sortBy === "manual"
                      ? "bg-amber/10 text-amber"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("sectionDetail.sortManual")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab content */}
      {activeTab === "write" ? (
        <SectionWriteEditor activeSection={activeSection} />
      ) : (
        /* Drop zone / paper list */
        <div
          className={`rounded-lg transition-all ${
            isOver ? "ring-2 ring-amber/30 bg-amber/5" : ""
          }`}
        >
          {matches.length === 0 ? (
            <div className="border-2 border-dashed border-border/30 rounded-lg py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {t("sectionDetail.dragPapersHere")}
              </p>
            </div>
          ) : sortBy === "manual" ? (
            <SortableContext
              items={sortedMatches.map((m) => m.matchId)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {sortedMatches.map((m) => (
                  <PaperSummaryCard
                    key={m.matchId}
                    match={m}
                    sectionId={activeSection.sectionId}
                    sortable
                  />
                ))}
              </div>
            </SortableContext>
          ) : (
            <div className="space-y-4">
              {sortedMatches.map((m) => (
                <PaperSummaryCard
                  key={m.matchId}
                  match={m}
                  sectionId={activeSection.sectionId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditableNotesDropdown({
  notes,
  sectionId,
}: {
  notes?: string;
  sectionId: SectionId;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes ?? "");
  const [dirty, setDirty] = useState(false);
  const updateNotes = useMutation(api.outline.updateSectionNotes);

  async function handleSave() {
    await updateNotes({ sectionId, notes: value });
    setDirty(false);
    setEditing(false);
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-amber-dim hover:text-amber transition-colors"
      >
        <StickyNote className="size-3" />
        <span>{t("sectionDetail.sectionNotes")}</span>
        {notes && (
          <span className="text-[9px] text-muted-foreground normal-case tracking-normal ml-1">
            {t("sectionDetail.hasNotes")}
          </span>
        )}
        <ChevronDown
          className={`size-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-2">
          {editing ? (
            <div className="space-y-2">
              <Textarea
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setDirty(true);
                }}
                className="text-sm min-h-[80px] bg-transparent"
                placeholder={t("sectionDetail.addSectionNotes")}
              />
              <div className="flex gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setEditing(false);
                    setValue(notes ?? "");
                    setDirty(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                {dirty && (
                  <Button size="xs" onClick={handleSave}>
                    {t("sectionDetail.saveNotes")}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="group relative px-3 py-2 rounded-md bg-amber/5 border border-amber/10">
              {notes ? (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {notes}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground/50 italic">
                  {t("sectionDetail.noSectionNotes")}
                </p>
              )}
              <button
                onClick={() => setEditing(true)}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-amber transition-all"
              >
                <Pencil className="size-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
