/// Fetches the baseline AI optimization prompts per language from the
/// Python backend. Falls back to hardcoded constants if the endpoint
/// is unreachable.

import { useEffect, useState } from "react";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import { FALLBACK_BASELINES } from "@/lib/promptResolver";
import type { Language } from "@/lib/LanguageContext";
import type { OptimizeMode } from "@/lib/types";

export function useBaselinePrompts() {
  const [baselines, setBaselines] =
    useState<Record<Language, Record<OptimizeMode, string>>>(FALLBACK_BASELINES);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchDefaults() {
      try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/optimize/defaults`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled && data.modes) {
          setBaselines(data.modes as Record<Language, Record<OptimizeMode, string>>);
        }
      } catch {
        // Keep fallback baselines on failure — they match optimizer.py.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchDefaults();
    return () => {
      cancelled = true;
    };
  }, []);

  return { baselines, isLoading };
}
