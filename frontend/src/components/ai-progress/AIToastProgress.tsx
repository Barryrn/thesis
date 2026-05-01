import { toast } from "sonner";

/// Options accepted when opening a progress toast.
interface AIToastProgressOptions {
  /// Headline label (e.g. "Optimizing text…").
  label: string;
  /// Optional secondary description rendered below the label.
  description?: string;
  /// Localized stop button label.
  stopLabel: string;
  /// Fires when the user clicks Stop. Owner is responsible for aborting
  /// the underlying request and resetting hook state to "cancelled".
  onStop: () => void;
}

/// Handle returned by `openAIToastProgress`. The caller dismisses the
/// toast on success/error and Sonner takes care of the unmount animation.
export interface AIToastProgressHandle {
  /// Dismiss the underlying loading toast. Idempotent — calling twice is
  /// a no-op because Sonner's `dismiss` already tolerates unknown ids.
  dismiss: () => void;
  /// Sonner toast id, exposed for callers that need to drive
  /// `toast.success(..., { id })` style transitions on the same surface.
  id: string | number;
}

/// Opens a persistent loading toast with a Stop action button. Used
/// where the trigger is no longer on screen at the moment the call is
/// running (e.g. text-selection optimize: the popover collapses on
/// click, so the user has no obvious place to abort otherwise).
///
/// The Stop button calls `onStop()` *and* dismisses the toast itself, so
/// callers do not need to chain a separate `handle.dismiss()`.
export function openAIToastProgress(
  options: AIToastProgressOptions,
): AIToastProgressHandle {
  const id = toast.loading(options.label, {
    description: options.description,
    duration: Infinity,
    action: {
      label: options.stopLabel,
      onClick: () => {
        options.onStop();
        toast.dismiss(id);
      },
    },
  });

  return {
    id,
    dismiss: () => toast.dismiss(id),
  };
}
