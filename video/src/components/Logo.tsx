import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { evolvePath } from "@remotion/paths";
import { COLORS } from "../constants";

interface LogoProps {
  startFrame?: number;
  size?: number;
}

export const Logo: React.FC<LogoProps> = ({ startFrame = 0, size = 400 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rel = frame - startFrame;

  if (rel < 0) return null;

  const scale = size / 800;

  // Phase 1: Document outline draws in (frames 0-40)
  const docProgress = interpolate(rel, [0, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Phase 2: Text lines appear (frames 20-60)
  const linesProgress = interpolate(rel, [20, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Phase 3: Magnifying glass (frames 35-70)
  const magProgress = interpolate(rel, [35, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Phase 4: Sparkle stars pop in (frames 55-90)
  const sparkleScale = (delay: number) =>
    spring({
      frame: rel - delay,
      fps,
      config: { damping: 8, stiffness: 300, mass: 0.3 },
    });

  const star1 = sparkleScale(55);
  const star2 = sparkleScale(62);
  const star3 = sparkleScale(68);
  const star4 = sparkleScale(74);

  // Document outline path
  const docPath =
    "M 415 520 H 325 A 15 15 0 0 1 310 505 V 295 A 15 15 0 0 1 325 280 H 450 L 490 320 V 430";
  const docFoldPath =
    "M 450 280 V 305 A 15 15 0 0 0 465 320 H 490";

  const docEvolved = evolvePath(docProgress, docPath);
  const foldEvolved = evolvePath(docProgress, docFoldPath);

  // Text lines inside document
  const lines = [
    { x1: 335, y1: 345, x2: 405, y2: 345 },
    { x1: 335, y1: 375, x2: 465, y2: 375 },
    { x1: 335, y1: 405, x2: 465, y2: 405 },
    { x1: 335, y1: 435, x2: 465, y2: 435 },
    { x1: 335, y1: 465, x2: 445, y2: 465 },
    { x1: 335, y1: 495, x2: 405, y2: 495 },
  ];

  // Magnifying glass handle
  const handlePath = "M 475 500 L 515 540";
  const handleEvolved = evolvePath(magProgress, handlePath);

  return (
    <svg
      viewBox="0 0 800 800"
      width={size}
      height={size}
      style={{ overflow: "visible" }}
    >
      {/* Sparkle stars */}
      <g transform={`translate(400, 240) scale(${star1})`}>
        <path
          d="M 0 -50 Q 0 0 50 0 Q 0 0 0 50 Q 0 0 -50 0 Q 0 0 0 -50 Z"
          fill={COLORS.primary}
        />
      </g>
      <g transform={`translate(340, 180) scale(${star2 * 0.6})`}>
        <path
          d="M 0 -25 Q 0 0 25 0 Q 0 0 0 25 Q 0 0 -25 0 Q 0 0 0 -25 Z"
          fill={COLORS.primary}
        />
      </g>
      <g transform={`translate(435, 165) scale(${star3 * 0.8})`}>
        <path
          d="M 0 -30 Q 0 0 30 0 Q 0 0 0 30 Q 0 0 -30 0 Q 0 0 0 -30 Z"
          fill={COLORS.primary}
        />
      </g>
      <g transform={`translate(485, 205) scale(${star4 * 0.5})`}>
        <path
          d="M 0 -20 Q 0 0 20 0 Q 0 0 0 20 Q 0 0 -20 0 Q 0 0 0 -20 Z"
          fill={COLORS.primary}
        />
      </g>

      {/* Document outline */}
      <path
        d={docPath}
        fill="none"
        stroke={COLORS.navy}
        strokeWidth={12}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={docEvolved.strokeDasharray}
        strokeDashoffset={docEvolved.strokeDashoffset}
      />
      <path
        d={docFoldPath}
        fill="none"
        stroke={COLORS.navy}
        strokeWidth={12}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={foldEvolved.strokeDasharray}
        strokeDashoffset={foldEvolved.strokeDashoffset}
      />

      {/* Text lines */}
      {lines.map((line, i) => {
        const lineDelay = i / lines.length;
        const lineOpacity = interpolate(
          linesProgress,
          [lineDelay, Math.min(lineDelay + 0.3, 1)],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        return (
          <line
            key={i}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="#D4DEE7"
            strokeWidth={10}
            strokeLinecap="round"
            opacity={lineOpacity}
          />
        );
      })}

      {/* Magnifying glass handle */}
      <line
        x1={475}
        y1={500}
        x2={515}
        y2={540}
        stroke={COLORS.navy}
        strokeWidth={24}
        strokeLinecap="round"
        strokeDasharray={handleEvolved.strokeDasharray}
        strokeDashoffset={handleEvolved.strokeDashoffset}
      />
      <line
        x1={485}
        y1={510}
        x2={505}
        y2={530}
        stroke={COLORS.primary}
        strokeWidth={8}
        strokeLinecap="round"
        opacity={magProgress}
      />

      {/* Magnifying glass circle */}
      <circle
        cx={450}
        cy={475}
        r={36}
        fill={COLORS.white}
        stroke={COLORS.navy}
        strokeWidth={12}
        opacity={magProgress}
      />
      <path
        d="M 432 464 A 22 22 0 0 1 444 454"
        fill="none"
        stroke={COLORS.primary}
        strokeWidth={6}
        strokeLinecap="round"
        opacity={magProgress}
      />
    </svg>
  );
};
