import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Search, X } from "lucide-react";
import type {
  CitationRecommendation,
  GroupId,
  PaperId,
} from "@/lib/types";

/// Scope for the highlight-to-cite recommender. `section` searches papers
/// already linked to the section, `group` narrows to one paper group, `all`
/// scans every completed paper.
export type FindCiteScope =
  | { type: "section" }
  | { type: "group"; groupId: GroupId }
  | { type: "all" };

/// One available group offered in the scope dropdown. Pre-fetched by the
/// parent — the popover does no Convex queries of its own so it stays a
/// pure presentational component.
export interface AvailableGroup {
  _id: GroupId;
  name: string;
}

/// Score below which a result row is rendered de-emphasised. Mirrors the
/// "low confidence" threshold described in the plan.
const LOW_SCORE_THRESHOLD = 0.4;

interface HighlightCitationPopoverProps {
  /// Pixel coordinates relative to the editor container.
  anchor: { top: number; left: number };
  scope: FindCiteScope;
  onScopeChange: (scope: FindCiteScope) => void;
  loading: boolean;
  results: CitationRecommendation[] | null;
  excluded: { paperId: PaperId; reason: "no-summary" }[];
  lowContext: boolean;
  availableGroups: AvailableGroup[];
  onPickResult: (paperId: PaperId) => void;
  onDismiss: () => void;
}

/// Floating popover anchored near the user's selection that runs the
/// recommender and lets the user pick a paper to cite. Picking a paper hands
/// off to the existing `CitationPicker` Stage 2 — this popover never inserts
/// a citation directly.
export default function HighlightCitationPopover({
  anchor,
  scope,
  onScopeChange,
  loading,
  results,
  excluded,
  lowContext,
  availableGroups,
  onPickResult,
  onDismiss,
}: HighlightCitationPopoverProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape so the popover behaves like the
  // existing `CitationPicker`.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onDismiss();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  const allLowConfidence = useMemo(() => {
    if (!results || results.length === 0) return false;
    return results.every((r) => r.score < LOW_SCORE_THRESHOLD);
  }, [results]);

  return (
    <div
      ref={containerRef}
      className="absolute z-50 w-96 rounded-lg border border-border/50 bg-card shadow-lg overflow-hidden"
      style={{ top: anchor.top + 24, left: Math.min(anchor.left, 200) }}
    >
      {/* Header: scope segmented control + close button */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/30">
        <div className="flex items-center gap-1">
          <ScopePill
            active={scope.type === "section"}
            onClick={() => onScopeChange({ type: "section" })}
            label={t("findCitation.scopeSection", "Section")}
          />
          <ScopePill
            active={scope.type === "group"}
            onClick={() => {
              // Switching to group with no group chosen surfaces the dropdown
              // but defers the actual scope change until the user picks one.
              if (scope.type !== "group" && availableGroups.length > 0) {
                onScopeChange({
                  type: "group",
                  groupId: availableGroups[0]._id,
                });
              }
            }}
            label={t("findCitation.scopeGroup", "Group")}
            disabled={availableGroups.length === 0}
          />
          <ScopePill
            active={scope.type === "all"}
            onClick={() => onScopeChange({ type: "all" })}
            label={t("findCitation.scopeAll", "All")}
          />
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded hover:bg-muted/30 text-muted-foreground transition-colors"
          aria-label={t("common.close", "Close")}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Group dropdown — only when group scope is active */}
      {scope.type === "group" && availableGroups.length > 0 && (
        <div className="px-3 py-2 border-b border-border/20">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {t("findCitation.groupLabel", "Group")}
          </label>
          <select
            value={scope.groupId}
            onChange={(e) =>
              onScopeChange({
                type: "group",
                groupId: e.target.value as GroupId,
              })
            }
            className="mt-1 w-full bg-transparent border border-border/30 rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-amber/40"
          >
            {availableGroups.map((g) => (
              <option key={g._id} value={g._id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Banners */}
      {lowContext && (
        <div className="px-3 py-1.5 text-[11px] text-amber bg-amber/5 border-b border-amber/20">
          {t(
            "findCitation.lowContextBanner",
            "Highlight more text for better matches."
          )}
        </div>
      )}
      {!loading && results && allLowConfidence && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] text-amber bg-amber/5 border-b border-amber/20">
          <span>
            {t(
              "findCitation.allLowConfidenceBanner",
              "Low confidence — try widening the scope."
            )}
          </span>
          {scope.type !== "all" && (
            <button
              onClick={() => onScopeChange({ type: "all" })}
              className="rounded-full px-2 py-0.5 text-[10px] bg-amber/10 hover:bg-amber/20 transition-colors"
            >
              {t("findCitation.searchAll", "Search all")}
            </button>
          )}
        </div>
      )}

      {/* Body */}
      <div className="max-h-72 overflow-y-auto py-1">
        {loading && (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t("findCitation.loading", "Searching for matches…")}
          </div>
        )}

        {!loading && results && results.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground italic">
            {scope.type === "section"
              ? t(
                  "findCitation.emptySection",
                  "No section papers. Try Group or All."
                )
              : t("findCitation.empty", "No matches in this scope.")}
            {scope.type !== "all" && (
              <button
                onClick={() => onScopeChange({ type: "all" })}
                className="ml-2 text-amber hover:text-amber/80 transition-colors not-italic"
              >
                {t("findCitation.searchAll", "Search all")}
              </button>
            )}
          </div>
        )}

        {!loading && results && results.length > 0 && (
          <div className="space-y-1">
            {results.map((rec) => {
              const pct = Math.round(rec.score * 100);
              const muted = rec.score < LOW_SCORE_THRESHOLD;
              return (
                <button
                  key={rec.paperId}
                  type="button"
                  onClick={() => onPickResult(rec.paperId)}
                  className={`w-full text-left px-3 py-2 hover:bg-muted/30 transition-colors flex flex-col gap-1.5 ${
                    muted ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className="text-sm font-medium text-foreground truncate flex-1"
                      title={rec.title}
                    >
                      {rec.title}
                    </p>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {pct}%
                    </span>
                  </div>
                  {rec.authors.length > 0 && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {rec.authors.slice(0, 2).join(", ")}
                      {rec.authors.length > 2 ? " et al." : ""}
                      {rec.year ? ` (${rec.year})` : ""}
                    </p>
                  )}
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-amber"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {rec.reasoning && (
                    <p className="text-[11px] text-muted-foreground italic">
                      “{rec.reasoning}”
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Excluded note. Render only when we have any result panel content
            visible — otherwise the empty state already covers messaging. */}
        {!loading && excluded.length > 0 && results && results.length > 0 && (
          <p className="px-3 py-2 text-[10px] text-muted-foreground/60 italic flex items-center gap-1">
            <Search className="size-3" />
            {t("findCitation.excludedNoSummary", {
              count: excluded.length,
              defaultValue:
                "{{count}} paper(s) skipped — no summary yet.",
            })}
          </p>
        )}
      </div>
    </div>
  );
}

/// Small segmented-control pill. Active variant uses the amber accent
/// consistent with the rest of the editor toolbar.
function ScopePill({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
        active
          ? "bg-amber/10 text-amber"
          : "bg-muted/20 text-muted-foreground hover:bg-muted/30"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );
}
