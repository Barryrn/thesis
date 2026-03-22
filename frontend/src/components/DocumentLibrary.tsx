/// Document library panel (right sidebar). Shows all papers with search,
/// status filters, group filters, and optional manual sort via drag-and-drop.
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { api } from "../../convex/_generated/api";
import { Search, ArrowDownWideNarrow, RotateCcw } from "lucide-react";
import LibraryPaperCard from "./LibraryPaperCard";
import GroupsSection from "./GroupsSection";

type StatusFilter = "all" | "unassigned" | "processing" | "completed";
type SortMode = "alphabetical" | "manual";

const filterTabs: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unassigned", label: "Unassigned" },
  { key: "processing", label: "In Progress" },
  { key: "completed", label: "Done" },
];

import type { Paper, PaperId, PaperGroup, GroupId } from "@/lib/types";

interface DocumentLibraryProps {
  onPreviewPaper: (paper: Paper) => void;
  onLibraryOrderChange?: (paperIds: PaperId[]) => void;
}

export default function DocumentLibrary({
  onPreviewPaper,
  onLibraryOrderChange,
}: DocumentLibraryProps) {
  const papers = useQuery(api.papers.listPapers) ?? [];
  const unassigned = useQuery(api.matches.getUnassignedPapers) ?? [];
  const groups = (useQuery(api.groups.listGroups) ?? []) as PaperGroup[];
  const memberships = useQuery(api.groups.listAllMemberships) ?? [];
  const resetLibraryOrder = useMutation(api.papers.resetLibraryOrder);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("alphabetical");
  const [selectedGroupId, setSelectedGroupId] = useState<GroupId | null>(null);

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
  }, [papers, searchQuery, statusFilter, unassignedIds, sortMode, isFiltered, selectedGroupId, membershipsByPaper]);

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
        <h2 className="heading-serif text-base text-foreground mb-3">
          Documents
        </h2>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search papers..."
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
          {filterTabs.map((tab) => (
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
              A–Z
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
              title={isFiltered ? "Disable filters to use manual sorting" : undefined}
            >
              Manual
            </button>
            {hasManualOrder && (
              <button
                onClick={handleReset}
                className="ml-auto flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                title="Reset to alphabetical order"
              >
                <RotateCcw className="size-2.5" />
                Reset
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
              {searchQuery ? "No papers match your search" : "No papers uploaded yet"}
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
    </div>
  );
}
