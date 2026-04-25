/// Sheet drawer for editing per-section AI prompt overrides.
/// Each optimization mode gets a collapsible section showing:
/// - Read-only preview of the effective base prompt (global or baseline)
/// - Optional full prompt replacement checkbox + textarea
/// - Extra context/instructions textarea
/// - Tier badge and reset button

import { useCallback, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import type {
  OptimizeMode,
  AiPromptSettings,
  AiPromptOverrides,
  AiPromptOverride,
} from "@/lib/types";
import { getPromptTier } from "@/lib/promptResolver";

/// Labels displayed for each mode.
const MODE_LABELS: Record<OptimizeMode, string> = {
  enhance: "Enhance",
  formalize: "Formalize",
  simplify: "Simplify",
  expand: "Expand",
};

const MODES: OptimizeMode[] = ["enhance", "formalize", "simplify", "expand"];

/// Human-readable tier labels for the badge.
const TIER_LABELS: Record<string, string> = {
  baseline: "Baseline",
  global: "Global",
  section: "Section",
};

/// Tier-specific badge colors.
const TIER_COLORS: Record<string, string> = {
  baseline: "bg-muted/50 text-muted-foreground",
  global: "bg-blue-500/15 text-blue-400",
  section: "bg-amber/15 text-amber",
};

interface SectionPromptEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionTitle: string;
  /// Current per-section prompt overrides from sectionContent.
  aiPromptOverrides: AiPromptOverrides | undefined;
  /// Global prompt settings from thesisMetadata.
  globalSettings: AiPromptSettings | undefined;
  /// Hardcoded baseline prompts fetched from the Python backend.
  baselines: Record<OptimizeMode, string>;
  /// Called with the updated overrides (caller saves to Convex).
  onChange: (overrides: AiPromptOverrides) => void;
}

export default function SectionPromptEditor({
  open,
  onOpenChange,
  sectionTitle,
  aiPromptOverrides,
  globalSettings,
  baselines,
  onChange,
}: SectionPromptEditorProps) {
  /// Track which modes are expanded in the accordion.
  const [expanded, setExpanded] = useState<Set<OptimizeMode>>(new Set());

  const toggleExpanded = (mode: OptimizeMode) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  };

  /// Updates a single mode's override fields.
  const updateMode = useCallback(
    (mode: OptimizeMode, patch: Partial<AiPromptOverride>) => {
      const current = aiPromptOverrides?.[mode] ?? {};
      onChange({
        ...aiPromptOverrides,
        [mode]: { ...current, ...patch },
      });
    },
    [aiPromptOverrides, onChange]
  );

  /// Clears all overrides for a single mode (falls back to global/baseline).
  const resetMode = useCallback(
    (mode: OptimizeMode) => {
      onChange({
        ...aiPromptOverrides,
        [mode]: undefined,
      });
    },
    [aiPromptOverrides, onChange]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="!w-full !max-w-md overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle className="text-sm">
            AI Prompts — {sectionTitle}
          </SheetTitle>
          <p className="text-[10px] text-muted-foreground">
            Customize how AI optimizes text in this section. Overrides apply
            only to this section.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-2 mt-4">
          {MODES.map((mode) => {
            const override = aiPromptOverrides?.[mode];
            const tier = getPromptTier(mode, globalSettings, aiPromptOverrides);
            const hasOverride = !!override?.prompt?.trim() || !!override?.extraContext?.trim();
            const isExpanded = expanded.has(mode);

            // The effective base prompt this section inherits (global or baseline).
            const globalPrompt = globalSettings?.[mode];
            const effectiveBase = globalPrompt?.trim()
              ? globalPrompt
              : baselines[mode];

            return (
              <div
                key={mode}
                className="rounded-lg border border-border/30 overflow-hidden"
              >
                {/* Accordion header */}
                <button
                  onClick={() => toggleExpanded(mode)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? (
                      <ChevronDown className="size-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3 text-muted-foreground" />
                    )}
                    <span className="text-xs font-medium">
                      {MODE_LABELS[mode]}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full ${TIER_COLORS[tier]}`}
                    >
                      {TIER_LABELS[tier]}
                    </span>
                    {hasOverride && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          resetMode(mode);
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Remove section override"
                      >
                        <RotateCcw className="size-3" />
                      </button>
                    )}
                  </div>
                </button>

                {/* Accordion body */}
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-3 border-t border-border/20 pt-3">
                    {/* Read-only preview of effective base prompt */}
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
                        Inherited prompt {globalPrompt?.trim() ? "(global)" : "(baseline)"}
                      </label>
                      <div className="rounded-md border border-border/30 bg-muted/20 px-2 py-1.5 text-xs text-muted-foreground leading-relaxed max-h-20 overflow-y-auto">
                        {effectiveBase}
                      </div>
                    </div>

                    {/* Full prompt override */}
                    <div>
                      <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider mb-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!override?.prompt?.trim()}
                          onChange={(e) => {
                            if (e.target.checked) {
                              // Pre-fill with the effective base so the user has a starting point.
                              updateMode(mode, { prompt: effectiveBase });
                            } else {
                              updateMode(mode, { prompt: undefined });
                            }
                          }}
                          className="rounded border-border/40 text-amber focus:ring-amber/40"
                        />
                        Override base prompt for this section
                      </label>
                      {override?.prompt?.trim() && (
                        <textarea
                          value={override.prompt ?? ""}
                          onChange={(e) =>
                            updateMode(mode, { prompt: e.target.value })
                          }
                          maxLength={2000}
                          rows={4}
                          className="w-full rounded-md border border-amber/30 bg-background px-2 py-1.5 text-xs leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-amber/40 text-foreground"
                        />
                      )}
                    </div>

                    {/* Extra context / instructions */}
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
                        Extra instructions (appended)
                      </label>
                      <textarea
                        value={override?.extraContext ?? ""}
                        onChange={(e) =>
                          updateMode(mode, { extraContext: e.target.value })
                        }
                        maxLength={2000}
                        rows={3}
                        placeholder="e.g. Focus on technical precision. This section covers machine learning methods."
                        className="w-full rounded-md border border-border/40 bg-background px-2 py-1.5 text-xs leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-amber/40 text-foreground placeholder:text-muted-foreground/50"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
