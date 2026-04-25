/// Pure functions for resolving the effective AI optimization prompt
/// through the two-tier override chain: baseline → global → section.

import type { OptimizeMode, AiPromptSettings, AiPromptOverrides } from "./types";

/// Hardcoded baseline prompts matching MODE_INSTRUCTIONS in optimizer.py.
/// Used as a fallback when the /optimize/defaults endpoint is unreachable.
export const FALLBACK_BASELINES: Record<OptimizeMode, string> = {
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
};

/**
 * Resolves the effective prompt for a given mode by applying the two-tier
 * override chain: baseline → global → section (replace or append).
 *
 * Returns the final prompt string to send to the backend, or undefined
 * when no customization exists (so the backend uses its own hardcoded default).
 */
export function resolvePrompt(
  mode: OptimizeMode,
  baselines: Record<OptimizeMode, string>,
  globalSettings?: AiPromptSettings,
  sectionOverrides?: AiPromptOverrides
): string | undefined {
  const tier = getPromptTier(mode, globalSettings, sectionOverrides);
  // No customization at any level — let the backend use its own default.
  if (tier === "baseline") return undefined;

  // Determine effective base: global override or baseline.
  const globalPrompt = globalSettings?.[mode];
  const base = globalPrompt?.trim() ? globalPrompt : baselines[mode];

  // Apply section-level override.
  const sectionOverride = sectionOverrides?.[mode];
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

/// Returns which tier is active for a given mode, used for UI badges.
export function getPromptTier(
  mode: OptimizeMode,
  globalSettings?: AiPromptSettings,
  sectionOverrides?: AiPromptOverrides
): "baseline" | "global" | "section" {
  const sectionOverride = sectionOverrides?.[mode];
  if (sectionOverride?.prompt?.trim() || sectionOverride?.extraContext?.trim()) {
    return "section";
  }
  if (globalSettings?.[mode]?.trim()) {
    return "global";
  }
  return "baseline";
}
