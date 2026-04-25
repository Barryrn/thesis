import { useMemo } from "react";
import katex from "katex";
import type { FormulaPreviewEntry } from "@/lib/formulaUtils";

interface FormulaPreviewPanelProps {
  formulas: FormulaPreviewEntry[];
}

/// Renders a preview panel showing KaTeX-rendered formulas found in the body.
/// Follows the same visual pattern as the footnote panel in SectionWriteEditor.
export default function FormulaPreviewPanel({
  formulas,
}: FormulaPreviewPanelProps) {
  /// Pre-render all formulas to HTML strings via KaTeX.
  const rendered = useMemo(
    () =>
      formulas.map((f) => {
        try {
          return {
            ...f,
            html: katex.renderToString(f.latex, {
              displayMode: f.displayMode,
              throwOnError: false,
              output: "html",
            }),
            error: null,
          };
        } catch {
          return { ...f, html: "", error: `Invalid LaTeX: ${f.latex}` };
        }
      }),
    [formulas]
  );

  return (
    <div className="rounded-lg border border-border/30 p-4 bg-muted/10">
      <span className="text-[11px] font-medium text-amber-dim uppercase tracking-wider">
        Formulas
      </span>
      <div className="mt-2 space-y-2">
        {rendered.map((f) => (
          <div
            key={f.index}
            className="flex items-start gap-2 text-sm text-foreground/80"
          >
            <span className="text-[10px] text-muted-foreground/60 mt-1 shrink-0">
              ({f.index})
            </span>
            {f.error ? (
              <span className="text-red-400 text-xs italic">{f.error}</span>
            ) : (
              <span
                className={f.displayMode ? "block w-full text-center" : ""}
                dangerouslySetInnerHTML={{ __html: f.html }}
              />
            )}
            <span className="text-[9px] text-muted-foreground/40 mt-1 shrink-0">
              {f.displayMode ? "display" : "inline"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
