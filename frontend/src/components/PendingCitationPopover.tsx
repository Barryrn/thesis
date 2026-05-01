/// Popover anchored to a `.ce-cite-needed` chip in the editor.
///
/// Renders the validate-phase candidate ranking for a single placeholder.
/// User actions:
///   • "Insert as direct" / "Insert as indirect" — replace the chip with a
///     real `{{cite:paperId::type::pageRef}}` marker and close the popover.
///   • "Dismiss" — strip just this placeholder from the body without
///     creating a citation.
///
/// The popover is intentionally dumb: it takes a candidate list and emits
/// callbacks. State (open/closed, anchored chip, body rewrite) lives in
/// the parent SectionWriteEditor.
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { ValidateCandidate } from "@/hooks/useValidateCitations";
import type { CitationType } from "@/lib/types";

/// Anchor rect (DOMRect-shaped). The popover positions itself just below
/// the chip; the parent measures `chipEl.getBoundingClientRect()` and
/// passes the result.
export interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  width: number;
}

/// Paper metadata used for display; merged in by the parent so we don't
/// re-query Convex inside the popover.
export interface CandidatePaperMeta {
  paperId: string;
  title: string;
  kuerzel: string | null;
}

interface Props {
  placeholderId: string;
  reason: string;
  /// Validate-phase ranking. Empty when validate has not been run yet —
  /// the popover renders an empty-state hint in that case.
  candidates: ValidateCandidate[];
  /// Look up paper title + Kürzel by paperId so each row can show enough
  /// context for the user to decide.
  paperMetaById: Map<string, CandidatePaperMeta>;
  /// Anchor rect of the clicked chip in viewport coordinates.
  anchor: AnchorRect;
  onInsert: (paperId: string, citationType: CitationType, pageRef: string) => void;
  onDismiss: () => void;
  onClose: () => void;
}

export default function PendingCitationPopover({
  placeholderId: _placeholderId,
  reason,
  candidates,
  paperMetaById,
  anchor,
  onInsert,
  onDismiss,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);

  /// Close on outside click or Escape — matches the picker's existing UX.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  /// Compute final position. The anchor is in viewport coords and the
  /// popover is fixed-positioned, so we only need to clamp against the
  /// viewport edges.
  const style = useMemo<React.CSSProperties>(() => {
    const POPOVER_W = 360;
    const VIEW_PAD = 12;
    const left = Math.max(
      VIEW_PAD,
      Math.min(anchor.left, window.innerWidth - POPOVER_W - VIEW_PAD)
    );
    const top = anchor.bottom + 6;
    return {
      position: "fixed",
      top,
      left,
      width: POPOVER_W,
      zIndex: 50,
    };
  }, [anchor]);

  return (
    <div
      ref={popoverRef}
      style={style}
      className="rounded-lg border border-amber/30 bg-background shadow-lg p-3 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-medium text-amber-dim uppercase tracking-wider">
          {t("pendingChip.popoverTitle")}
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-3" />
        </button>
      </div>

      {reason && (
        <p className="text-[11px] text-muted-foreground italic">
          {reason}
        </p>
      )}

      {candidates.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {t("pendingChip.noCandidates")}
        </p>
      ) : (
        <ul className="space-y-2">
          {candidates.map((c) => {
            const meta = paperMetaById.get(c.paper_id);
            return (
              <li
                key={c.paper_id}
                className="rounded-md border border-border bg-muted/20 p-2 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium truncate" title={meta?.title}>
                    {meta?.kuerzel ?? "??"} — {meta?.title ?? c.paper_id}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber/15 text-amber-dim font-mono"
                    title={t("pendingChip.scoreLabel")}
                  >
                    {(c.score * 100).toFixed(0)}%
                  </span>
                </div>
                {c.justification && (
                  <p className="text-[10px] text-muted-foreground">
                    {c.justification}
                  </p>
                )}
                <div className="flex items-center gap-1 pt-1">
                  <button
                    onClick={() =>
                      onInsert(c.paper_id, "indirect", c.page_ref_from_excerpt)
                    }
                    className="text-[10px] px-2 py-0.5 rounded-full bg-amber/20 hover:bg-amber/30 text-amber-dim transition-colors"
                  >
                    {t("pendingChip.insertIndirect")}
                  </button>
                  <button
                    onClick={() =>
                      onInsert(c.paper_id, "direct", c.page_ref_from_excerpt)
                    }
                    className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 hover:bg-muted/60 text-foreground transition-colors"
                  >
                    {t("pendingChip.insertDirect")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex justify-end pt-1">
        <button
          onClick={onDismiss}
          className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
        >
          {t("pendingChip.dismiss")}
        </button>
      </div>
    </div>
  );
}
