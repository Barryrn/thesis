/// Settings panel for global AI optimization prompt customization.
/// Rendered inside ThesisPreviewModal's left sidebar when the
/// Sparkles icon is toggled. Each mode has an editable textarea
/// and a per-mode reset button.

import { useCallback } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OptimizeMode, AiPromptSettings } from "@/lib/types";

/// Labels displayed above each mode's textarea.
const MODE_LABELS: Record<OptimizeMode, string> = {
  enhance: "Enhance",
  formalize: "Formalize",
  simplify: "Simplify",
  expand: "Expand",
};

const MODES: OptimizeMode[] = ["enhance", "formalize", "simplify", "expand"];

interface AiPromptsSettingsPanelProps {
  /// Current global prompt overrides from Convex (may be undefined/sparse).
  aiPromptSettings: AiPromptSettings | undefined;
  /// Hardcoded baseline prompts fetched from the Python backend.
  baselines: Record<OptimizeMode, string>;
  /// Called with the updated settings object on every edit (caller debounces).
  onChange: (settings: AiPromptSettings) => void;
  /// Clears all global overrides, reverting every mode to baseline.
  onReset: () => void;
}

/// True when no mode has a custom global override.
function isAllBaseline(settings: AiPromptSettings | undefined): boolean {
  if (!settings) return true;
  return MODES.every((m) => !settings[m]?.trim());
}

export default function AiPromptsSettingsPanel({
  aiPromptSettings,
  baselines,
  onChange,
  onReset,
}: AiPromptsSettingsPanelProps) {
  const allDefault = isAllBaseline(aiPromptSettings);

  /// Updates a single mode's global prompt override.
  /// Only persists when the value actually differs from the baseline.
  const updateMode = useCallback(
    (mode: OptimizeMode, value: string) => {
      // If the user typed the baseline text back, treat it as "no override".
      const effective = value.trim() === baselines[mode].trim() ? undefined : value;
      onChange({ ...aiPromptSettings, [mode]: effective });
    },
    [aiPromptSettings, baselines, onChange]
  );

  /// Resets a single mode to baseline (clears its global override).
  const resetMode = useCallback(
    (mode: OptimizeMode) => {
      onChange({ ...aiPromptSettings, [mode]: undefined });
    },
    [aiPromptSettings, onChange]
  );

  return (
    <div className="w-64 shrink-0 border-r border-border/30 overflow-y-auto p-3 space-y-4">
      {/* Header */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
          AI Prompts
        </p>
        <span className="text-[10px] text-amber/80 font-medium">
          {allDefault ? "All Baseline" : "Custom"}
        </span>
      </div>

      {/* Per-mode prompt editors */}
      {MODES.map((mode) => {
        const customValue = aiPromptSettings?.[mode];
        const isCustom = !!customValue?.trim();
        const displayValue = isCustom ? customValue : baselines[mode];

        return (
          <div key={mode}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {MODE_LABELS[mode]}
              </p>
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                    isCustom
                      ? "bg-amber/15 text-amber"
                      : "bg-muted/50 text-muted-foreground"
                  }`}
                >
                  {isCustom ? "Custom" : "Default"}
                </span>
                {isCustom && (
                  <button
                    onClick={() => resetMode(mode)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Reset to baseline"
                  >
                    <RotateCcw className="size-3" />
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={displayValue ?? ""}
              onChange={(e) => updateMode(mode, e.target.value)}
              maxLength={2000}
              rows={3}
              className={`w-full rounded-md border px-2 py-1.5 text-xs leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-amber/40 ${
                isCustom
                  ? "border-amber/30 bg-background text-foreground"
                  : "border-border/40 bg-muted/30 text-muted-foreground"
              }`}
            />
          </div>
        );
      })}

      {/* Reset all button */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full text-xs text-muted-foreground"
        onClick={onReset}
        disabled={allDefault}
      >
        <RotateCcw className="size-3 mr-1" />
        Reset All to Baseline
      </Button>
    </div>
  );
}
