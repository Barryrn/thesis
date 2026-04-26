/// Settings panel for global AI optimization prompt customization.
/// Rendered inside ThesisPreviewModal's left sidebar when the
/// Sparkles icon is toggled. Each mode has an editable textarea
/// and a per-mode reset button. Edits are scoped to the active
/// language — switching language shows/edits independent prompts.

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Language } from "@/lib/LanguageContext";
import type { OptimizeMode, AiPromptSettings, AiPromptSettingsByLang } from "@/lib/types";

/// Labels displayed above each mode's textarea.
const MODE_LABELS: Record<OptimizeMode, string> = {
  enhance: "Enhance",
  formalize: "Formalize",
  simplify: "Simplify",
  expand: "Expand",
};

/// Human-readable language names for the editing label.
const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  de: "Deutsch",
};

const MODES: OptimizeMode[] = ["enhance", "formalize", "simplify", "expand"];

interface AiPromptsSettingsPanelProps {
  /// Active language — determines which language's prompts are shown/edited.
  language: Language;
  /// Current global prompt overrides from Convex (per-language).
  aiPromptSettings: AiPromptSettingsByLang | undefined;
  /// Hardcoded baseline prompts per language from the Python backend.
  baselines: Record<Language, Record<OptimizeMode, string>>;
  /// Called with the updated per-language settings on every edit.
  onChange: (settings: AiPromptSettingsByLang) => void;
  /// Clears the current language's overrides, reverting to baseline.
  onReset: () => void;
}

/// True when no mode has a custom global override for the given language.
function isAllBaseline(settings: AiPromptSettings | undefined): boolean {
  if (!settings) return true;
  return MODES.every((m) => !settings[m]?.trim());
}

export default function AiPromptsSettingsPanel({
  language,
  aiPromptSettings,
  baselines,
  onChange,
  onReset,
}: AiPromptsSettingsPanelProps) {
  const { t } = useTranslation();
  const langSettings = aiPromptSettings?.[language];
  const langBaselines = baselines[language] ?? baselines.en;
  const allDefault = isAllBaseline(langSettings);

  /// Updates a single mode's global prompt override for the active language.
  const updateMode = useCallback(
    (mode: OptimizeMode, value: string) => {
      const effective = value.trim() === langBaselines[mode].trim() ? undefined : value;
      const updatedLang: AiPromptSettings = { ...langSettings, [mode]: effective };
      onChange({ ...aiPromptSettings, [language]: updatedLang });
    },
    [langSettings, langBaselines, onChange, aiPromptSettings, language]
  );

  /// Resets a single mode to baseline for the active language.
  const resetMode = useCallback(
    (mode: OptimizeMode) => {
      const updatedLang: AiPromptSettings = { ...langSettings, [mode]: undefined };
      onChange({ ...aiPromptSettings, [language]: updatedLang });
    },
    [langSettings, onChange, aiPromptSettings, language]
  );

  return (
    <div className="w-64 shrink-0 border-r border-border/30 overflow-y-auto p-3 space-y-4">
      {/* Header */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
          {t("promptEditor.aiPrompts")}
        </p>
        <span className="text-[10px] text-amber/80 font-medium">
          {allDefault ? t("promptEditor.allBaseline") : t("promptEditor.custom")}
        </span>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          {t("prompts.editingFor", { language: LANGUAGE_NAMES[language] })}
        </p>
      </div>

      {/* Per-mode prompt editors */}
      {MODES.map((mode) => {
        const customValue = langSettings?.[mode];
        const isCustom = !!customValue?.trim();
        const displayValue = isCustom ? customValue : langBaselines[mode];

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
                  {isCustom ? t("promptEditor.custom") : t("promptEditor.default")}
                </span>
                {isCustom && (
                  <button
                    onClick={() => resetMode(mode)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={t("promptEditor.resetToBaseline")}
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
        {t("promptEditor.resetAllToBaseline")}
      </Button>
    </div>
  );
}
