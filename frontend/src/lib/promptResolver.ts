/// Pure functions for resolving the effective AI optimization prompt
/// through the two-tier override chain: baseline → global → section.
/// All functions accept a language parameter so each language has
/// independent prompt customization.

import type { Language } from "./LanguageContext";
import type {
  OptimizeMode,
  AiPromptSettings,
  AiPromptOverrides,
  AiPromptSettingsByLang,
  AiPromptOverridesByLang,
} from "./types";

/// Hardcoded baseline prompts per language, matching MODE_INSTRUCTIONS
/// and MODE_INSTRUCTIONS_DE in optimizer.py.
/// Used as a fallback when the /optimize/defaults endpoint is unreachable.
export const FALLBACK_BASELINES: Record<Language, Record<OptimizeMode, string>> = {
  en: {
    enhance:
      "Improve the clarity, flow, and word choice of the following text. " +
      "Keep the same meaning, tone, and approximate length.",
    formalize:
      "Rewrite the following text in formal academic tone suitable for a thesis. " +
      "Keep the same meaning. Use scholarly vocabulary and sentence structure.",
    simplify:
      "Simplify the following text for clearer, more concise reading. " +
      "Remove unnecessary complexity while keeping the same meaning.",
    expand:
      "Expand the following text with more detail, depth, and supporting explanation. " +
      "Elaborate on the ideas while maintaining the original meaning and direction.",
  },
  de: {
    enhance:
      "Verbessere die Klarheit, den Lesefluss und die Wortwahl des folgenden Textes. " +
      "Behalte die gleiche Bedeutung, den gleichen Ton und die ungefähre Länge bei.",
    formalize:
      "Schreibe den folgenden Text in einem formalen akademischen Stil um, der für eine Abschlussarbeit geeignet ist. " +
      "Behalte die gleiche Bedeutung bei. Verwende wissenschaftliches Vokabular und Satzstrukturen.",
    simplify:
      "Vereinfache den folgenden Text für ein klareres, prägnanteres Lesen. " +
      "Entferne unnötige Komplexität, aber behalte die gleiche Bedeutung bei.",
    expand:
      "Erweitere den folgenden Text mit mehr Details, Tiefe und unterstützenden Erläuterungen. " +
      "Führe die Ideen weiter aus, ohne die ursprüngliche Bedeutung und Richtung zu ändern.",
  },
};

/**
 * Resolves the effective prompt for a given mode and language by applying
 * the two-tier override chain: baseline → global → section (replace or append).
 *
 * Returns the final prompt string to send to the backend, or undefined
 * when no customization exists (so the backend uses its own hardcoded default).
 */
export function resolvePrompt(
  mode: OptimizeMode,
  language: Language,
  baselines: Record<Language, Record<OptimizeMode, string>>,
  globalSettings?: AiPromptSettingsByLang,
  sectionOverrides?: AiPromptOverridesByLang
): string | undefined {
  const langBaselines = baselines[language] ?? baselines.en;
  const langGlobal = globalSettings?.[language];
  const langSection = sectionOverrides?.[language];

  const tier = getPromptTier(mode, language, globalSettings, sectionOverrides);
  // No customization at any level — let the backend use its own default.
  if (tier === "baseline") return undefined;

  // Determine effective base: global override or baseline.
  const globalPrompt = langGlobal?.[mode];
  const base = globalPrompt?.trim() ? globalPrompt : langBaselines[mode];

  // Apply section-level override.
  const sectionOverride = langSection?.[mode];
  if (!sectionOverride) return base;

  // Full replacement takes precedence.
  if (sectionOverride.prompt?.trim()) {
    const replaced = sectionOverride.prompt;
    if (sectionOverride.extraContext?.trim()) {
      return replaced + "\n\n" + sectionOverride.extraContext;
    }
    return replaced;
  }

  // Extra context only: append to the effective base.
  if (sectionOverride.extraContext?.trim()) {
    return base + "\n\n" + sectionOverride.extraContext;
  }

  return base;
}

/// Returns which tier is active for a given mode and language, used for UI badges.
export function getPromptTier(
  mode: OptimizeMode,
  language: Language,
  globalSettings?: AiPromptSettingsByLang,
  sectionOverrides?: AiPromptOverridesByLang
): "baseline" | "global" | "section" {
  const langSection = sectionOverrides?.[language];
  const sectionOverride = langSection?.[mode];
  if (sectionOverride?.prompt?.trim() || sectionOverride?.extraContext?.trim()) {
    return "section";
  }
  const langGlobal = globalSettings?.[language];
  if (langGlobal?.[mode]?.trim()) {
    return "global";
  }
  return "baseline";
}
