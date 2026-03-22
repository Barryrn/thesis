import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import StatStrip from "@/components/StatStrip";
import OutlineSidebar from "@/components/OutlineSidebar";
import SectionDetailPanel from "@/components/SectionDetailPanel";
import DocumentLibrary from "@/components/DocumentLibrary";
import DocumentPreviewModal from "@/components/DocumentPreviewModal";
import type { ActiveSection, DragData, PaperId, SectionId, Paper } from "@/lib/types";
import type { Id } from "../../convex/_generated/dataModel";

export default function Dashboard() {
  const papers = useQuery(api.papers.listPapers) ?? [];
  const sections = useQuery(api.outline.listSections) ?? [];
  const addMatch = useMutation(api.matches.addMatch);
  const updateMatch = useMutation(api.matches.updateMatch);
  const reorderMatches = useMutation(api.matches.reorderMatches);
  const reorderLibrary = useMutation(api.papers.reorderLibrary);
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [activeSection, setActiveSection] = useState<ActiveSection | null>(
    null
  );
  const [previewPaper, setPreviewPaper] = useState<Paper | null>(null);
  const [sectionMatchOrder, setSectionMatchOrder] = useState<
    Id<"paperSectionMatches">[]
  >([]);
  const [libraryPaperOrder, setLibraryPaperOrder] = useState<
    Id<"papers">[]
  >([]);
  // Tracks which section IDs are awaiting a /cite response (shows spinner)
  const [citingSections, setCitingSections] = useState<Set<SectionId>>(
    new Set()
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const total = papers.length;
  const completed = papers.filter((p) => p.status === "completed").length;
  const processing = papers.filter(
    (p) => p.status === "processing" || p.status === "pending"
  ).length;
  const failed = papers.filter((p) => p.status === "failed").length;

  function handleDragStart(event: DragStartEvent) {
    setActiveDrag(event.active.data.current as DragData);
    setPreviewPaper(null);
  }

  /**
   * Calls the /cite backend endpoint to run GPT-based scoring and excerpt
   * extraction for a specific paper against one or more outline sections.
   * Shows a spinner on the target section nodes during processing.
   */
  const triggerCitation = useCallback(
    async (paperId: PaperId, sectionIds: SectionId[]) => {
      const paper = papers.find((p) => p._id === paperId);
      if (!paper?.fileUrl) return;

      // Show spinner on each target section
      setCitingSections((prev) => new Set([...prev, ...sectionIds]));

      try {
        await fetch("http://localhost:8000/cite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paperId,
            fileUrl: paper.fileUrl,
            sectionIds,
            // Pass full section objects so the backend can filter and score
            sections: sections.map((s) => ({
              _id: s._id,
              title: s.title,
              orderNumber: s.orderNumber,
              notes: s.notes,
            })),
            language: "en",
          }),
        });
      } catch (err) {
        console.error("[CITE] Citation request failed:", err);
      } finally {
        setCitingSections((prev) => {
          const next = new Set(prev);
          sectionIds.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [papers, sections]
  );

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const dragData = active.data.current as DragData;

    // Detect library reorder: both IDs are paper IDs in the library order
    if (active.id !== over.id && libraryPaperOrder.length > 0) {
      const activeId = String(active.id) as Id<"papers">;
      const overId = String(over.id) as Id<"papers">;
      const oldIdx = libraryPaperOrder.indexOf(activeId);
      const newIdx = libraryPaperOrder.indexOf(overId);

      if (oldIdx !== -1 && newIdx !== -1) {
        const newOrder = arrayMove(libraryPaperOrder, oldIdx, newIdx);
        setLibraryPaperOrder(newOrder);
        await reorderLibrary({ orderedPaperIds: newOrder });
        return;
      }
    }

    // Detect sortable reorder: both IDs are in the sectionMatchOrder list
    if (active.id !== over.id && sectionMatchOrder.length > 0) {
      const activeId = String(active.id) as Id<"paperSectionMatches">;
      const overId = String(over.id) as Id<"paperSectionMatches">;
      const oldIndex = sectionMatchOrder.indexOf(activeId);
      const newIndex = sectionMatchOrder.indexOf(overId);

      if (oldIndex !== -1 && newIndex !== -1 && dragData.sourceSectionId) {
        const newOrder = arrayMove(sectionMatchOrder, oldIndex, newIndex);
        setSectionMatchOrder(newOrder);
        await reorderMatches({
          sectionId: dragData.sourceSectionId,
          orderedMatchIds: newOrder,
        });
        return;
      }
    }

    const dropType = over.data.current?.type as string | undefined;
    const targetSectionId = over.data.current?.sectionId as
      | SectionId
      | undefined;
    if (!targetSectionId) return;

    const { paperId, sourceSectionId } = dragData;

    if (dropType === "outline-section") {
      // Sidebar section drop → trigger GPT citation for this section
      // (only when dragging from the library; moves from sections stay as manual)
      if (sourceSectionId === null) {
        await triggerCitation(paperId, [targetSectionId]);
      } else if (sourceSectionId !== targetSectionId) {
        // Move between sections without re-running citation
        await updateMatch({
          paperId,
          oldSectionId: sourceSectionId,
          newSectionId: targetSectionId,
        });
      }
    } else {
      // Center-panel drop → manual add (no GPT, immediate)
      if (sourceSectionId === null) {
        await addMatch({
          paperId,
          sectionId: targetSectionId,
          relevanceScore: 1.0,
        });
      } else if (sourceSectionId !== targetSectionId) {
        await updateMatch({
          paperId,
          oldSectionId: sourceSectionId,
          newSectionId: targetSectionId,
        });
      }
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 h-14 border-b border-border/50 px-5 flex items-center justify-between shrink-0 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-5">
          <h1 className="heading-serif text-xl text-amber">
            Thesis Paper Organizer
          </h1>
          <div className="h-4 w-px bg-border/50" />
          <StatStrip
            total={total}
            completed={completed}
            processing={processing}
            failed={failed}
          />
        </div>
        <Link to="/upload#upload">
          <Button
            variant="outline"
            size="sm"
            className="border-amber/20 text-amber hover:bg-amber/10 hover:text-amber"
          >
            Upload Papers
          </Button>
        </Link>
      </header>

      {/* 3-panel layout */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        collisionDetection={pointerWithin}
      >
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Outline Sidebar */}
          <aside className="w-[260px] shrink-0 border-r border-border/50 bg-sidebar overflow-hidden">
            <OutlineSidebar
              activeSection={activeSection}
              onSelectSection={setActiveSection}
              citingSections={citingSections}
            />
          </aside>

          {/* Center: Section Detail */}
          <main className="flex-1 overflow-y-auto">
            <SectionDetailPanel
              activeSection={activeSection}
              onMatchOrderChange={setSectionMatchOrder}
            />
          </main>

          {/* Right: Document Library */}
          <aside className="w-[320px] shrink-0 border-l border-border/50 overflow-hidden">
            <DocumentLibrary
              onPreviewPaper={setPreviewPaper}
              onLibraryOrderChange={setLibraryPaperOrder}
            />
          </aside>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeDrag && (
            <div className="w-72 opacity-90">
              <Card className="shadow-xl border-amber/20 bg-card">
                <CardContent className="p-3">
                  <p className="font-semibold text-sm truncate text-foreground">
                    {activeDrag.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {activeDrag.authors.length > 0
                      ? activeDrag.authors.slice(0, 2).join(", ")
                      : "Unknown authors"}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Document preview (outside DndContext to avoid z-index conflicts) */}
      {previewPaper && (
        <DocumentPreviewModal
          paper={previewPaper}
          onClose={() => setPreviewPaper(null)}
          onCite={triggerCitation}
        />
      )}
    </div>
  );
}
