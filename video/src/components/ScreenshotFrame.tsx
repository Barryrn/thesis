import { useCurrentFrame, useVideoConfig, interpolate, spring, Img } from "remotion";
import { staticFile } from "remotion";
import { COLORS } from "../constants";

interface HighlightRegion {
  x: number; // percentage 0-100
  y: number;
  width: number;
  height: number;
  delay?: number; // frames delay before highlight appears
}

interface ScreenshotFrameProps {
  src: string; // filename in public/
  startFrame?: number;
  highlights?: HighlightRegion[];
  scale?: number;
}

export const ScreenshotFrame: React.FC<ScreenshotFrameProps> = ({
  src,
  startFrame = 0,
  highlights = [],
  scale = 0.85,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rel = frame - startFrame;

  if (rel < 0) return null;

  // Phone frame slides up from bottom
  const slideUp = spring({
    frame: rel,
    fps,
    config: { damping: 15, stiffness: 80, mass: 0.8 },
  });

  const frameWidth = 1080 * scale;
  const frameHeight = 680 * scale;
  const borderRadius = 24;

  // Slight zoom effect on the screenshot
  const imgScale = interpolate(rel, [0, 120], [1.05, 1.0], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        width: "100%",
        transform: `translateY(${(1 - slideUp) * 400}px)`,
        opacity: slideUp,
      }}
    >
      <div
        style={{
          width: frameWidth,
          height: frameHeight,
          borderRadius,
          border: `3px solid ${COLORS.cardBorder}`,
          overflow: "hidden",
          position: "relative",
          boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(255,194,17,0.1)`,
          background: COLORS.card,
        }}
      >
        {/* Screenshot image */}
        <div style={{ overflow: "hidden", width: "100%", height: "100%" }}>
          <Img
            src={staticFile(src)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${imgScale})`,
            }}
          />
        </div>

        {/* Highlight overlays */}
        {highlights.map((hl, i) => {
          const hlDelay = hl.delay ?? 30 + i * 20;
          const hlOpacity = interpolate(
            rel - hlDelay,
            [0, 15],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          // Pulsing glow
          const pulse = interpolate(
            (rel - hlDelay) % 40,
            [0, 20, 40],
            [0.6, 1, 0.6],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${hl.x}%`,
                top: `${hl.y}%`,
                width: `${hl.width}%`,
                height: `${hl.height}%`,
                border: `3px solid ${COLORS.primary}`,
                borderRadius: 12,
                opacity: hlOpacity * pulse,
                boxShadow: `0 0 20px ${COLORS.primary}40, inset 0 0 20px ${COLORS.primary}10`,
                pointerEvents: "none",
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
