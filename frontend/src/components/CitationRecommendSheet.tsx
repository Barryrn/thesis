/// Right-side drawer that runs the smart paper recommender for a section.
///
/// Reads the section's title, body, and notes; sends them to the Python
/// recommender via the Convex action `recommendations.recommendPapersForSection`;
/// renders a ranked list of papers with score bar, reasoning, and an "Add"
/// button per row. Adding inserts a `paperSectionMatch` via `addMatch`, which
/// the existing AI section-writer ("Generate section") then uses for citations.
///
/// Recommendations are transient — closing the sheet discards them. This
/// keeps the data model simple (no separate suggestions table for citations)
/// and matches the user's flow of running, picking a few, and moving on.
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAction, useMutation, useQuery } from "convex/react";
import { Compass, Loader2, Plus, Check } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "../../convex/_generated/api";
import type { Language } from "@/lib/LanguageContext";
import type {
  CitationRecommendation,
  GroupId,
  PaperId,
  RecommendScope,
  SectionId,
} from "@/lib/types";

interface CitationRecommendSheetProps {
  sectionId: SectionId;
  /// Provider override forwarded to the Python recommender.
  provider: string;
  /// Reasoning language for the recommender. The current UI locale is passed
  /// here so the explanation matches the language the user is reading the app
  /// in, regardless of how much draft prose the section already has.
  language: Language;
  onClose: () => void;
}

/// Internal status flags for the run-once flow. Recommendations are loaded
/// on demand (button click), not eagerly, so the sheet starts in `idle`.
type RunState =
  | { status: "idle" }
  | { status: "running" }
  | {
      status: "done";
      recommendations: CitationRecommendation[];
      lowContext: boolean;
    }
  | { status: "error"; message: string };

export default function CitationRecommendSheet({
  sectionId,
  provider,
  language,
  onClose,
}: CitationRecommendSheetProps) {
  const { t } = useTranslation();
  const recommend = useAction(api.recommendations.recommendPapersForSection);
  const addMatch = useMutation(api.matches.addMatch);

  // Group + paper lists drive the scope-picker UI. Both queries are cheap
  // and already used elsewhere in the app, so the cache is usually warm.
  const groups = useQuery(api.groups.listGroups) ?? [];
  const papers = useQuery(api.papers.listPapers) ?? [];

  // ── Scope picker state ───────────────────────────────────────────────
  const [scopeType, setScopeType] = useState<"all" | "groups" | "papers">(
    "all"
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<GroupId>>(
    new Set()
  );
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<PaperId>>(
    new Set()
  );

  // ── Run state ─────────────────────────────────────────────────────────
  const [run, setRun] = useState<RunState>({ status: "idle" });
  /// Tracks paperIds the user has already added in this sheet session so the
  /// row's "Add" button collapses to "Added ✓" without a re-fetch.
  const [addedIds, setAddedIds] = useState<Set<PaperId>>(new Set());

  /// Whether the Run button should be enabled. We block "groups" / "papers"
  /// scopes that have no selection so the user gets a clear empty state
  /// before paying for the LLM call.
  const canRun = useMemo(() => {
    if (run.status === "running") return false;
    if (scopeType === "groups") return selectedGroupIds.size > 0;
    if (scopeType === "papers") return selectedPaperIds.size > 0;
    return true;
  }, [run.status, scopeType, selectedGroupIds, selectedPaperIds]);

  /// Builds the scope payload for the Convex action.
  function buildScope(): RecommendScope {
    if (scopeType === "groups") {
      return { type: "groups", groupIds: Array.from(selectedGroupIds) };
    }
    if (scopeType === "papers") {
      return { type: "papers", paperIds: Array.from(selectedPaperIds) };
    }
    return { type: "all" };
  }

  async function handleRun() {
    setRun({ status: "running" });
    setAddedIds(new Set());
    try {
      const result = await recommend({
        sectionId,
        scope: buildScope(),
        provider,
        language,
      });
      setRun({
        status: "done",
        recommendations: result.recommendations as CitationRecommendation[],
        lowContext: result.lowContext,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("recommend.errorGeneric");
      setRun({ status: "error", message });
    }
  }

  async function handleAdd(rec: CitationRecommendation) {
    // Optimistically mark the row as added; if the mutation throws we
    // surface the error and leave the rest of the sheet untouched.
    setAddedIds((prev) => {
      const next = new Set(prev);
      next.add(rec.paperId);
      return next;
    });
    try {
      await addMatch({
        paperId: rec.paperId,
        sectionId,
        relevanceScore: rec.score,
      });
    } catch {
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(rec.paperId);
        return next;
      });
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="overflow-y-auto w-[440px] sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Compass className="size-4 text-amber" />
            {t("recommend.title")}
          </SheetTitle>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-4">
          {/* Scope picker */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("recommend.scopeLabel")}
            </p>
            <div className="flex flex-col gap-1.5">
              {(["all", "groups", "papers"] as const).map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="radio"
                    name="scope"
                    value={type}
                    checked={scopeType === type}
                    onChange={() => setScopeType(type)}
                  />
                  {t(`recommend.scope.${type}`)}
                </label>
              ))}
            </div>

            {scopeType === "groups" && (
              <div className="ml-5 mt-2 flex flex-wrap gap-1.5">
                {groups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("recommend.noGroups")}
                  </p>
                ) : (
                  groups.map((g) => {
                    const selected = selectedGroupIds.has(g._id);
                    return (
                      <button
                        key={g._id}
                        type="button"
                        onClick={() =>
                          setSelectedGroupIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(g._id)) next.delete(g._id);
                            else next.add(g._id);
                            return next;
                          })
                        }
                        className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                          selected ? "border-amber bg-amber/10 text-amber" : "border-border text-muted-foreground hover:border-amber/50"
                        }`}
                        style={
                          selected
                            ? {
                                backgroundColor: `${g.color}20`,
                                borderColor: g.color,
                                color: g.color,
                              }
                            : undefined
                        }
                      >
                        {g.name}
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {scopeType === "papers" && (
              <div className="ml-5 mt-2 max-h-40 overflow-y-auto border border-border rounded-md p-2 space-y-1">
                {papers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("recommend.noPapers")}
                  </p>
                ) : (
                  papers.map((p) => {
                    const selected = selectedPaperIds.has(p._id);
                    return (
                      <label
                        key={p._id}
                        className="flex items-center gap-2 text-xs cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            setSelectedPaperIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(p._id)) next.delete(p._id);
                              else next.add(p._id);
                              return next;
                            })
                          }
                        />
                        <span className="truncate flex-1" title={p.title}>
                          {p.title}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Run button */}
          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-amber/10 hover:bg-amber/20 text-amber border border-amber/30 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {run.status === "running" ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {t("recommend.running")}
              </>
            ) : (
              <>
                <Compass className="size-3.5" />
                {t("recommend.runButton")}
              </>
            )}
          </button>

          {/* Low-context banner */}
          {run.status === "done" && run.lowContext && (
            <p className="text-[11px] rounded-md bg-amber/5 border border-amber/30 text-amber px-2 py-1.5">
              {t("recommend.lowContextBanner")}
            </p>
          )}

          {/* Error state */}
          {run.status === "error" && (
            <p className="text-xs text-destructive">{run.message}</p>
          )}

          {/* Results list */}
          {run.status === "done" && run.recommendations.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {t("recommend.empty")}
            </p>
          )}

          {run.status === "done" && run.recommendations.length > 0 && (
            <div className="space-y-2">
              {run.recommendations.map((rec) => {
                const added = addedIds.has(rec.paperId);
                const pct = Math.round(rec.score * 100);
                return (
                  <div
                    key={rec.paperId}
                    className="flex flex-col gap-1.5 rounded-md border border-border/50 bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className="text-sm font-medium text-foreground truncate flex-1"
                        title={rec.title}
                      >
                        {rec.title}
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleAdd(rec)}
                        disabled={added}
                        aria-label={
                          added
                            ? t("recommend.added")
                            : t("recommend.addToSection")
                        }
                        title={
                          added
                            ? t("recommend.added")
                            : t("recommend.addToSection")
                        }
                        className="shrink-0 p-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 transition-colors disabled:opacity-60 disabled:cursor-default"
                      >
                        {added ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Plus className="size-3.5" />
                        )}
                      </button>
                    </div>

                    {rec.authors.length > 0 && (
                      <p className="text-xs text-muted-foreground truncate">
                        {rec.authors.slice(0, 2).join(", ")}
                        {rec.authors.length > 2 ? " et al." : ""}
                        {rec.year ? ` (${rec.year})` : ""}
                      </p>
                    )}

                    {/* Score bar */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-amber"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums w-9 text-right">
                        {pct}%
                      </span>
                    </div>

                    {rec.reasoning && (
                      <p className="text-[11px] text-muted-foreground italic">
                        “{rec.reasoning}”
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
