/// Right-side drawer that runs the batch section-writer over a
/// chosen outline subtree. Wires the headless `useBatchGenerateSections`
/// hook to real Convex actions/mutations and renders a per-section
/// status list, an in-page error log, and a Stop button.
///
/// The panel is mode-agnostic about how it was opened — `OutlineSidebar`
/// passes the root section node and the panel walks the tree itself.
import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2, Square, X } from "lucide-react";

import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { AISurfaceProgress } from "@/components/ai-progress";
import { useProvider } from "@/lib/ProviderContext";
import {
  useBatchGenerateSections,
  type BatchAdapters,
  type BatchExistingBodyMode,
  type BatchSectionInput,
  type BatchSectionStatus,
} from "@/hooks/useBatchGenerateSections";
import type { PaperId, SectionTreeNode, SectionId } from "@/lib/types";
import { buildSectionTree } from "@/lib/treeBuilder";

interface BatchGeneratePanelProps {
  /// Section node clicked by the user. The whole subtree (this node +
  /// all descendants in document order) is run.
  rootNode: SectionTreeNode;
  onClose: () => void;
}

/// Flatten a tree node into a depth-first ordered list of `{ _id }`s.
function flattenSubtree(root: SectionTreeNode): SectionTreeNode[] {
  const out: SectionTreeNode[] = [];
  const walk = (n: SectionTreeNode) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

export default function BatchGeneratePanel({
  rootNode,
  onClose,
}: BatchGeneratePanelProps) {
  const { provider } = useProvider();
  const [mode, setMode] = useState<BatchExistingBodyMode>("skip");
  const [showLog, setShowLog] = useState(true);

  // We re-resolve the subtree from the live outline query so a section
  // added/removed mid-edit is reflected without remounting the panel.
  const allSections = useQuery(api.outline.listSections) ?? [];
  const tree = useMemo(() => buildSectionTree(allSections), [allSections]);
  const liveRoot = useMemo(() => {
    const find = (nodes: SectionTreeNode[]): SectionTreeNode | null => {
      for (const n of nodes) {
        if (n._id === rootNode._id) return n;
        const f = find(n.children);
        if (f) return f;
      }
      return null;
    };
    return find(tree);
  }, [tree, rootNode._id]);

  const subtree = useMemo(
    () => (liveRoot ? flattenSubtree(liveRoot) : []),
    [liveRoot]
  );

  // Per-section content rows give us the `currentBody` field the batch
  // hook needs for its existing-body skip rule. We fetch them once at
  // panel-open time rather than per-section to keep the network footprint
  // small; the user kicking off Start happens only after they've reviewed
  // the section list anyway.
  const subtreeIds = useMemo(() => subtree.map((n) => n._id), [subtree]);
  const sectionContents = useQuery(
    api.sectionContent.getSectionContentBatch,
    subtreeIds.length > 0 ? { sectionIds: subtreeIds } : "skip"
  );

  // Convex bindings exposed to the headless hook.
  const recommendAction = useAction(api.recommendations.recommendPapersForSection);
  const addMatchMutation = useMutation(api.matches.addMatch);
  const saveMutation = useMutation(api.sectionContent.saveSectionContent);

  const adapters: BatchAdapters = useMemo(
    () => ({
      async recommend(sectionId, _signal) {
        // Convex actions don't accept AbortSignal; the outer Stop click
        // can still cancel the in-flight stream/detect/validate fetches,
        // and processOne gates on `stoppedRef` between phases — a few
        // extra recommend round-trips are an acceptable cost.
        const result = await recommendAction({
          sectionId,
          scope: { type: "all" },
          provider,
        });
        return (result?.recommendations ?? []).map((r) => ({
          paperId: r.paperId as unknown as PaperId,
          score: r.score,
        }));
      },
      async addMatch(paperId, sectionId, relevanceScore) {
        await addMatchMutation({ paperId, sectionId, relevanceScore });
      },
      async save(sectionId, body, citedPaperIds, pendingCitations) {
        await saveMutation({
          sectionId,
          body,
          citedPaperIds,
          pendingCitations: pendingCitations.map((p) => ({
            id: p.id,
            reason: p.reason,
            suggestedPaperIds: p.suggestedPaperIds,
          })),
        });
      },
    }),
    [recommendAction, addMatchMutation, saveMutation, provider]
  );

  const batch = useBatchGenerateSections({ provider, adapters });

  // Auto-scroll the log to the bottom on every new entry.
  const logEndRef = useMemo(
    () => ({ current: null as HTMLDivElement | null }),
    []
  );
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [batch.state.log.length, logEndRef]);

  const handleStart = () => {
    if (!liveRoot) return;
    const inputs: BatchSectionInput[] = subtree.map((n) => {
      const content = sectionContents?.find((c) => c?.sectionId === n._id);
      return {
        sectionId: n._id,
        title: n.title,
        orderNumber: n.orderNumber,
        notes: n.notes ?? null,
        currentBody: content?.body ?? null,
      };
    });
    batch.start(inputs, mode);
  };

  const isRunning = batch.state.status === "running";

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] bg-background border-l border-border shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">
            Generate subtree: {rootNode.title}
          </h2>
          <p className="text-xs text-muted-foreground">
            {subtree.length} section(s) in scope
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close panel">
          <X className="size-4" />
        </Button>
      </div>

      {/* Mode selector + Start */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <label className="text-xs font-medium text-muted-foreground block">
          Existing content
        </label>
        <div className="flex gap-1">
          {(["skip", "append", "replace"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={isRunning}
              onClick={() => setMode(m)}
              className={`px-2 py-1 rounded text-xs border transition ${
                mode === m
                  ? "bg-amber/10 border-amber text-amber"
                  : "bg-background border-border text-muted-foreground hover:bg-muted"
              } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {m}
            </button>
          ))}
        </div>
        <Button
          onClick={handleStart}
          disabled={isRunning || subtree.length === 0 || sectionContents === undefined}
          className="w-full gap-2"
        >
          {isRunning ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Running…
            </>
          ) : (
            "Start"
          )}
        </Button>
      </div>

      {/* Progress strip while running */}
      {isRunning && (
        <div className="px-4 pt-3">
          <AISurfaceProgress
            label={`${batch.state.stats.done + batch.state.stats.skipped + batch.state.stats.failed} / ${batch.state.stats.total} section(s)`}
            detail={
              batch.state.currentIndex >= 0
                ? batch.state.sections[batch.state.currentIndex]?.title
                : undefined
            }
            progress={
              batch.state.stats.total > 0
                ? (batch.state.stats.done +
                    batch.state.stats.skipped +
                    batch.state.stats.failed) /
                  batch.state.stats.total
                : undefined
            }
            onStop={batch.stop}
            stopLabel="Stop batch"
          />
        </div>
      )}

      {/* Section list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {batch.state.sections.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Click Start to begin.
          </p>
        ) : (
          batch.state.sections.map((s, i) => (
            <div
              key={s.sectionId}
              className={`flex items-start gap-2 text-xs py-1 px-2 rounded ${
                batch.state.currentIndex === i ? "bg-amber/5" : ""
              }`}
            >
              <StatusDot status={s.status} />
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">
                  <span className="text-muted-foreground font-mono mr-1">
                    {s.orderNumber}
                  </span>
                  {s.title}
                </p>
                {s.lastMessage && (
                  <p className="text-muted-foreground truncate">
                    {s.lastMessage}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Log toggle + panel */}
      <div className="border-t border-border px-4 py-2">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLog((v) => !v)}
            className="h-7 text-xs"
          >
            {showLog ? "Hide log" : "Show log"} ({batch.state.log.length})
          </Button>
          {batch.state.status !== "idle" && !isRunning && (
            <Button
              variant="ghost"
              size="sm"
              onClick={batch.reset}
              className="h-7 text-xs"
            >
              Reset
            </Button>
          )}
        </div>
        {showLog && (
          <div className="mt-2 bg-muted/30 border border-border rounded p-2 max-h-48 overflow-y-auto font-mono text-[10px] leading-tight space-y-0.5">
            {batch.state.log.length === 0 ? (
              <p className="text-muted-foreground italic">No activity yet</p>
            ) : (
              batch.state.log.map((entry, i) => (
                <div
                  key={i}
                  className={
                    entry.level === "error"
                      ? "text-red-500"
                      : entry.level === "ok"
                        ? "text-green-500"
                        : entry.level === "warn"
                          ? "text-amber"
                          : "text-muted-foreground"
                  }
                >
                  <span className="opacity-60">[{entry.ts}]</span>{" "}
                  <span className="opacity-80">{entry.sectionTitle}</span>{" "}
                  <span className="opacity-60">[{entry.phase}]</span>{" "}
                  {entry.message}
                </div>
              ))
            )}
            <div ref={(el) => (logEndRef.current = el)} />
          </div>
        )}
      </div>
    </div>
  );
}

/// Mini status indicator next to each section row. Mirrors the dot
/// colors used in the outline sidebar so the same visual vocabulary
/// applies in both surfaces.
function StatusDot({ status }: { status: BatchSectionStatus }) {
  const map: Record<BatchSectionStatus, { color: string; pulse: boolean }> = {
    queued: { color: "bg-muted-foreground/30", pulse: false },
    linking: { color: "bg-amber", pulse: true },
    drafting: { color: "bg-amber", pulse: true },
    detecting: { color: "bg-amber", pulse: true },
    validating: { color: "bg-amber", pulse: true },
    done: { color: "bg-green-500", pulse: false },
    skipped: { color: "bg-slate-400", pulse: false },
    failed: { color: "bg-red-500", pulse: false },
    cancelled: { color: "bg-red-500", pulse: false },
  };
  const { color, pulse } = map[status];
  if (status === "linking" || status === "drafting" || status === "detecting" || status === "validating") {
    return (
      <Loader2
        className="size-3 mt-0.5 text-amber animate-spin shrink-0"
        aria-label={status}
      />
    );
  }
  if (status === "failed" || status === "cancelled") {
    return (
      <Square
        className={`size-3 mt-0.5 fill-current text-red-500 shrink-0`}
        aria-label={status}
      />
    );
  }
  return (
    <span
      aria-label={status}
      className={`inline-block size-2 mt-1.5 rounded-full shrink-0 ${color} ${
        pulse ? "animate-pulse" : ""
      }`}
    />
  );
}
