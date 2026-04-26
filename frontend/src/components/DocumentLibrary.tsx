/// Document library panel (right sidebar). Shows all papers with search,
/// status filters, group filters, and optional manual sort via drag-and-drop.
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "convex/react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { api } from "../../convex/_generated/api";
import { Search, ArrowDownWideNarrow, RotateCcw, Plus } from "lucide-react";
import LibraryPaperCard from "./LibraryPaperCard";
import GroupsSection from "./GroupsSection";
import SourceEditSheet from "./SourceEditSheet";

type StatusFilter = "all" | "unassigned" | "processing" | "completed";
type SourceFilter = "all" | "zotero" | "manual";
type SortMode = "alphabetical" | "manual";

import type { Paper, PaperId, PaperGroup, GroupId } from "@/lib/types";

interface DocumentLibraryProps {
  onPreviewPaper: (paper: Paper) => void;
  onLibraryOrderChange?: (paperIds: PaperId[]) => void;
}

export default function DocumentLibrary({
  onPreviewPaper,
  onLibraryOrderChange,
}: DocumentLibraryProps) {
  const { t } = useTranslation();
  const papers = useQuery(api.papers.listPapers) ?? [];
  const unassigned = useQuery(api.matches.getUnassignedPapers) ?? [];
  const groups = (useQuery(api.groups.listGroups) ?? []) as PaperGroup[];
  const memberships = useQuery(api.groups.listAllMemberships) ?? [];
  const resetLibraryOrder = useMutation(api.papers.resetLibraryOrder);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("alphabetical");
  const [selectedGroupId, setSelectedGroupId] = useState<GroupId | null>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);

  const unassignedIds = useMemo(
    () => new Set(unassigned.map((p) => p._id)),
    [unassigned]
  );

  /// paperId → Set<groupId> — built once from the flat memberships list.
  const membershipsByPaper = useMemo(() => {
    const map = new Map<PaperId, Set<GroupId>>();
    for (const m of memberships) {
      if (!map.has(m.paperId)) map.set(m.paperId, new Set());
      map.get(m.paperId)!.add(m.groupId);
    }
    return map;
  }, [memberships]);

  /// groupId → paper count.
  const membershipsByGroup = useMemo(() => {
    const map = new Map<GroupId, number>();
    for (const m of memberships) {
      map.set(m.groupId, (map.get(m.groupId) ?? 0) + 1);
    }
    return map;
  }, [memberships]);

  const isFiltered =
    searchQuery.trim() !== "" ||
    statusFilter !== "all" ||
    sourceFilter !== "all" ||
    selectedGroupId !== null;

  const filteredPapers = useMemo(() => {
    let result = papers;

    // Search filter.
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.authors.some((a) => a.toLowerCase().includes(q))
      );
    }

    // Status filter.
    switch (statusFilter) {
      case "unassigned":
        result = result.filter((p) => unassignedIds.has(p._id));
        break;
      case "processing":
        result = result.filter(
          (p) => p.status === "processing" || p.status === "pending"
        );
        break;
      case "completed":
        result = result.filter((p) => p.status === "completed");
        break;
    }

    // Source filter (Zotero vs Manual).
    if (sourceFilter === "zotero") {
      result = result.filter((p) => !!p.zoteroItemKey);
    } else if (sourceFilter === "manual") {
      result = result.filter((p) => !p.zoteroItemKey);
    }

    // Group filter (AND-combined with status filter above).
    if (selectedGroupId !== null) {
      result = result.filter((p) =>
        membershipsByPaper.get(p._id)?.has(selectedGroupId)
      );
    }

    // Sort.
    const sorted = [...result];
    if (sortMode === "manual" && !isFiltered) {
      sorted.sort((a, b) => {
        const aOrder = a.libraryDisplayOrder ?? Infinity;
        const bOrder = b.libraryDisplayOrder ?? Infinity;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.title.localeCompare(b.title);
      });
    } else {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    }

    return sorted;
  }, [papers, searchQuery, statusFilter, sourceFilter, unassignedIds, sortMode, isFiltered, selectedGroupId, membershipsByPaper]);

  const hasManualOrder = papers.some(
    (p) => p.libraryDisplayOrder !== undefined
  );

  // Report current order to parent for drag detection.
  useEffect(() => {
    if (sortMode === "manual" && !isFiltered) {
      onLibraryOrderChange?.(filteredPapers.map((p) => p._id));
    } else {
      onLibraryOrderChange?.([]);
    }
  }, [filteredPapers, sortMode, isFiltered, onLibraryOrderChange]);

  const effectiveSortMode = isFiltered ? "alphabetical" : sortMode;

  async function handleReset() {
    await resetLibraryOrder();
    setSortMode("alphabetical");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="heading-serif text-base text-foreground">
            {t("documentLibrary.documents")}
          </h2>
          <button
            onClick={() => setAddSourceOpen(true)}
            className="text-[11px] px-2.5 py-1 rounded-md bg-amber text-background hover:bg-amber/90 transition-colors flex items-center gap-1 font-medium"
          >
            <Plus className="size-3" />
            {t("documentLibrary.newSource")}
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t("documentLibrary.searchPapers")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-sm bg-muted/30 border border-border/50 rounded-md text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/40 focus:border-amber/30 transition-all"
          />
        </div>

        {/* Groups — collapsible section above filter tabs */}
        <div className="mt-3">
          <GroupsSection
            groups={groups}
            membershipsByGroup={membershipsByGroup}
            selectedGroupId={selectedGroupId}
            onSelectGroup={setSelectedGroupId}
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mt-2">
          {([
            { key: "all" as StatusFilter, label: t("documentLibrary.filterAll") },
            { key: "unassigned" as StatusFilter, label: t("documentLibrary.filterUnassigned") },
            { key: "processing" as StatusFilter, label: t("documentLibrary.filterInProgress") },
            { key: "completed" as StatusFilter, label: t("documentLibrary.filterDone") },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                statusFilter === tab.key
                  ? "bg-amber/15 text-amber"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {tab.label}
              {tab.key === "unassigned" && unassigned.length > 0 && (
                <span className="ml-1 text-amber-dim">{unassigned.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Source filter (Zotero / Manual) */}
        <div className="flex gap-1 mt-1.5">
          {([
            { key: "all" as SourceFilter, label: t("documentLibrary.allSources") },
            { key: "zotero" as SourceFilter, label: t("common.zotero") },
            { key: "manual" as SourceFilter, label: t("common.manual") },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSourceFilter(tab.key)}
              className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                sourceFilter === tab.key
                  ? tab.key === "zotero"
                    ? "bg-blue-500/15 text-blue-500"
                    : "bg-amber/15 text-amber"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sort controls */}
        {filteredPapers.length > 1 && (
          <div className="flex items-center gap-1 mt-2">
            <ArrowDownWideNarrow className="size-3 text-muted-foreground/60" />
            <button
              onClick={() => setSortMode("alphabetical")}
              className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                effectiveSortMode === "alphabetical"
                  ? "bg-amber/10 text-amber"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("documentLibrary.sortAlpha")}
            </button>
            <button
              onClick={() => !isFiltered && setSortMode("manual")}
              className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                effectiveSortMode === "manual"
                  ? "bg-amber/10 text-amber"
                  : isFiltered
                    ? "text-muted-foreground/30 cursor-not-allowed"
                    : "text-muted-foreground hover:text-foreground"
              }`}
              title={isFiltered ? t("documentLibrary.disableFiltersHint") : undefined}
            >
              {t("documentLibrary.sortManual")}
            </button>
            {hasManualOrder && (
              <button
                onClick={handleReset}
                className="ml-auto flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                title={t("documentLibrary.resetOrder")}
              >
                <RotateCcw className="size-2.5" />
                {t("documentLibrary.reset")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Paper list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredPapers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">
              {searchQuery ? t("documentLibrary.noMatchingPapers") : t("documentLibrary.noPapersUploaded")}
            </p>
          </div>
        ) : effectiveSortMode === "manual" ? (
          <SortableContext
            items={filteredPapers.map((p) => p._id)}
            strategy={verticalListSortingStrategy}
          >
            {filteredPapers.map((paper) => (
              <LibraryPaperCard
                key={paper._id}
                paper={paper}
                isUnassigned={unassignedIds.has(paper._id)}
                onPreview={onPreviewPaper}
                sortable
                groups={groups}
                paperGroupIds={membershipsByPaper.get(paper._id) ?? new Set()}
              />
            ))}
          </SortableContext>
        ) : (
          filteredPapers.map((paper) => (
            <LibraryPaperCard
              key={paper._id}
              paper={paper}
              isUnassigned={unassignedIds.has(paper._id)}
              onPreview={onPreviewPaper}
              groups={groups}
              paperGroupIds={membershipsByPaper.get(paper._id) ?? new Set()}
            />
          ))
        )}
      </div>

      {/* Manual source creation sheet */}
      <SourceEditSheet
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        source={null}
      />
    </div>
  );
}
