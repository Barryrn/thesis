import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/// Pixel sizes for the spinner. The keys map to the same scale used by
/// the rest of the UI (size-3 / size-3.5 / size-4) so spinners line up
/// visually with adjacent text and icons.
const SIZE_CLASS = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
} as const;

export type SpinnerSize = keyof typeof SIZE_CLASS;

interface SpinnerProps {
  /// Visual size of the spinning glyph. Defaults to `sm` to match the
  /// most common inline-button context.
  size?: SpinnerSize;
  /// Extra classes (e.g. a tint color) layered on top of the size class.
  className?: string;
}

/// Bare spinner primitive used by every AI / parsing progress affordance.
/// Wraps lucide's `Loader2` with the project's standard rotation animation
/// so callers do not have to remember `animate-spin` every time.
export function Spinner({ size = "sm", className }: SpinnerProps) {
  return (
    <Loader2
      aria-hidden
      className={cn(SIZE_CLASS[size], "animate-spin", className)}
    />
  );
}
