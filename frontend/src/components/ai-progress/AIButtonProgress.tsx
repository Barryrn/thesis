import { type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Spinner } from "./Spinner";
import { StopButton } from "./StopButton";

interface AIButtonProgressProps {
  /// Whether an AI/parsing call is currently in flight. When true the
  /// button collapses to a spinner + label + stop affordance.
  loading: boolean;
  /// Fires when the user clicks the trigger in its idle state.
  onClick: () => void;
  /// Fires when the user clicks Stop while loading. Optional: pass
  /// `undefined` to render a loading-only indicator (no cancel UI), used
  /// for fast operations like DOI lookup.
  onStop?: () => void;
  /// Idle state contents — typically an icon plus localized label.
  children: ReactNode;
  /// Localized label shown next to the spinner while loading. Also used
  /// as the StopButton's accessible label.
  loadingLabel: string;
  /// Localized accessible label for the stop button. Falls back to
  /// `loadingLabel` if not supplied.
  stopLabel?: string;
  /// Disabled state for the idle button. Ignored while loading — the
  /// stop affordance must remain interactive.
  disabled?: boolean;
  /// Class name forwarded to the rendered button (idle state) so each
  /// caller can keep its own size/variant styling.
  className?: string;
  /// Button variant for the idle state. Defaults to `outline`.
  variant?: "default" | "outline" | "secondary" | "ghost";
  /// Button size for the idle state. Defaults to `sm`.
  size?: "default" | "xs" | "sm" | "lg";
  /// Optional title (HTML tooltip) for the idle state.
  title?: string;
}

/// Wraps a trigger button so it visually flips between an idle CTA and an
/// in-flight spinner + Stop pair. Used wherever the original trigger is
/// still on screen during the operation (toolbar buttons, inline CTAs).
///
/// The component renders two sibling buttons during `loading` rather than
/// stuffing both behaviors into one button — that keeps the click target
/// for "Stop" obviously distinct from the "Run" trigger and avoids the
/// double-tap footgun where users accidentally re-trigger by clicking the
/// only visible button.
export function AIButtonProgress({
  loading,
  onClick,
  onStop,
  children,
  loadingLabel,
  stopLabel,
  disabled,
  className,
  variant = "outline",
  size = "sm",
  title,
}: AIButtonProgressProps) {
  if (loading) {
    return (
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-amber/30 bg-amber/10 px-2 py-1 text-amber",
          className,
        )}
      >
        <Spinner size="xs" className="text-amber" />
        <span className="text-xs font-medium">{loadingLabel}</span>
        {onStop ? (
          <StopButton
            onStop={onStop}
            label={stopLabel ?? loadingLabel}
            className="ml-0.5"
          />
        ) : null}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={className}
    >
      {children}
    </Button>
  );
}
