import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { COLORS, FONTS } from "../constants";

interface RelevanceBadgeProps {
  score: number;
  startFrame?: number;
  x?: number;
  y?: number;
}

function getScoreInfo(score: number) {
  if (score >= 0.7) return { label: "Strong", color: COLORS.green };
  if (score >= 0.5) return { label: "Possible", color: COLORS.yellow };
  return { label: "Weak", color: COLORS.red };
}

export const RelevanceBadge: React.FC<RelevanceBadgeProps> = ({
  score,
  startFrame = 0,
  x = 0,
  y = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rel = frame - startFrame;

  if (rel < 0) return null;

  const info = getScoreInfo(score);

  // Counter animation: counts up from 0 to score
  const displayScore = interpolate(rel, [0, 40], [0, score], {
    extrapolateRight: "clamp",
  });

  // Badge pops in
  const badgeScale = spring({
    frame: rel - 30,
    fps,
    config: { damping: 10, stiffness: 200, mass: 0.4 },
  });

  // Overall entrance
  const opacity = interpolate(rel, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity,
        fontFamily: FONTS.sans,
      }}
    >
      <span
        style={{
          fontSize: 36,
          fontWeight: 700,
          color: info.color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {displayScore.toFixed(2)}
      </span>
      <span
        style={{
          display: "inline-block",
          transform: `scale(${badgeScale})`,
          backgroundColor: info.color,
          color: COLORS.white,
          fontSize: 20,
          fontWeight: 600,
          padding: "4px 14px",
          borderRadius: 8,
        }}
      >
        {info.label}
      </span>
    </div>
  );
};
