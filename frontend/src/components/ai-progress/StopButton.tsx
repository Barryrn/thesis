import { Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StopButtonProps {
  /// Click handler — should abort the in-flight operation. The wrapper is
  /// responsible for any state cleanup (status → "cancelled", etc.).
  onStop: () => void;
  /// Accessible label. Wrappers must supply something descriptive
  /// (e.g. `t("optimize.stop")`) since this lives in user-facing UX.
  label: string;
  /// Optional className passthrough for layout-specific tweaks.
  className?: string;
  /// When true, the button can't be clicked. Used by parents to gate the
  /// stop affordance behind connection / state checks if needed.
  disabled?: boolean;
}

/// Compact destructive-tinted icon button used by every AI progress
/// component to abort the underlying operation. Filled square is the
/// established stop glyph used in `GroupsSection` runpills.
export function StopButton({
  onStop,
  label,
  className,
  disabled,
}: StopButtonProps) {
  return (
    <Button
      type="button"
      variant="destructive"
      size="icon-xs"
      title={label}
      aria-label={label}
      onClick={(event) => {
        // Don't let parent components (e.g. cards with onClick) react to
        // the user stopping a background operation — the click is purely
        // about cancelling.
        event.stopPropagation();
        onStop();
      }}
      disabled={disabled}
      className={cn("shrink-0", className)}
    >
      <Square className="fill-current" />
    </Button>
  );
}
