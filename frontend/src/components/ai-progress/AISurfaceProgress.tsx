import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Spinner } from "./Spinner";
import { StopButton } from "./StopButton";

interface AISurfaceProgressProps {
  /// Headline label (e.g. "Generating section…").
  label: string;
  /// Optional secondary caption rendered below the label — surfaces
  /// progress like "5 / 12 papers" or the latest streamed sentence.
  detail?: ReactNode;
  /// Stop handler. When omitted, the surface renders without a Stop
  /// button (loading-only mode for non-cancellable operations).
  onStop?: () => void;
  /// Localized stop button label. Required when `onStop` is provided.
  stopLabel?: string;
  /// Optional progress fraction in [0, 1]. When supplied, the surface
  /// renders a determinate bar; otherwise it shows an indeterminate
  /// shimmer.
  progress?: number;
  /// Optional className for layout integration (margins, ring colors).
  className?: string;
}

/// Full-width progress strip used by surfaces that own a long-running
/// operation: the section-writer popover, the Zotero importer, and each
/// in-flight paper card during PDF processing.
export function AISurfaceProgress({
  label,
  detail,
  onStop,
  stopLabel,
  progress,
  className,
}: AISurfaceProgressProps) {
  // Clamp to [0, 100] for the determinate bar; undefined ⇒ indeterminate.
  const pct =
    typeof progress === "number"
      ? Math.max(0, Math.min(1, progress)) * 100
      : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-amber/30 bg-amber/5 px-3 py-2",
        className,
      )}
    >
      <Spinner size="sm" className="text-amber shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs font-medium text-amber">{label}</span>
        {detail ? (
          <span className="truncate text-[11px] text-muted-foreground">
            {detail}
          </span>
        ) : null}
        <div className="h-1 w-full overflow-hidden rounded-full bg-amber/15">
          {pct !== null ? (
            <div
              className="h-full bg-amber transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          ) : (
            // Indeterminate shimmer: a translucent bar travels left→right.
            <div className="h-full w-1/3 animate-pulse bg-amber/60" />
          )}
        </div>
      </div>
      {onStop ? (
        <StopButton
          onStop={onStop}
          label={stopLabel ?? label}
          className="self-center"
        />
      ) : null}
    </div>
  );
}
