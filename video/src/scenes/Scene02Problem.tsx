import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { AbsoluteFill } from "remotion";
import { COLORS, FONTS } from "../constants";
import { AnimatedText } from "../components/AnimatedText";
import { loadFonts } from "../fonts";

const seededRandom = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
};

const PAPERS = [
  { title: "Deep Learning for NLP", color: "#3a3530" },
  { title: "Transformer Models", color: "#352f2a" },
  { title: "Neural Networks", color: "#3d3632" },
  { title: "Research Methods", color: "#38322d" },
  { title: "Statistical Analysis", color: "#333028" },
  { title: "Literature Review", color: "#3b3530" },
  { title: "Data Mining", color: "#36302b" },
  { title: "Machine Learning", color: "#39342f" },
];

export const Scene02Problem: React.FC = () => {
  loadFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        overflow: "hidden",
      }}
    >
      {/* Chaotic paper cards */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          padding: 40,
        }}
      >
        {PAPERS.map((paper, i) => {
          const delay = i * 8;
          const entrance = spring({
            frame: frame - delay,
            fps,
            config: { damping: 8, stiffness: 100, mass: 0.6 },
          });

          const rotation = (seededRandom(i * 5) - 0.5) * 30;
          const offsetX = (seededRandom(i * 7) - 0.5) * 200;
          const offsetY = (seededRandom(i * 11) - 0.5) * 300;

          // Cards get more chaotic over time
          const chaos = interpolate(frame, [60, 140], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          const chaosRotation = rotation + chaos * (seededRandom(i * 13) - 0.5) * 20;
          const chaosX = offsetX + chaos * (seededRandom(i * 17) - 0.5) * 100;
          const chaosY = offsetY + chaos * (seededRandom(i * 19) - 0.5) * 100;

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${30 + (i % 3) * 20}%`,
                top: `${25 + Math.floor(i / 3) * 18}%`,
                width: 280,
                padding: "16px 20px",
                backgroundColor: paper.color,
                borderRadius: 12,
                border: `1px solid ${COLORS.cardBorder}`,
                transform: `translate(${chaosX * entrance}px, ${chaosY * entrance}px) rotate(${chaosRotation * entrance}deg) scale(${entrance})`,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                opacity: entrance,
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontFamily: FONTS.sans,
                  fontWeight: 600,
                  color: COLORS.foreground,
                  marginBottom: 6,
                }}
              >
                {paper.title}
              </div>
              <div
                style={{
                  height: 6,
                  backgroundColor: COLORS.muted,
                  borderRadius: 3,
                  opacity: 0.3,
                  width: "80%",
                  marginBottom: 4,
                }}
              />
              <div
                style={{
                  height: 6,
                  backgroundColor: COLORS.muted,
                  borderRadius: 3,
                  opacity: 0.2,
                  width: "60%",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Red stress glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at center, ${COLORS.red}15 0%, transparent 70%)`,
          opacity: interpolate(frame, [80, 140], [0, 0.8], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />

      {/* Text overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 200,
          left: 0,
          right: 0,
          padding: "0 60px",
          zIndex: 10,
        }}
      >
        <AnimatedText
          text="Zu viele Papers, zu viele Notizen, keine klare Struktur."
          mode="word-by-word"
          startFrame={30}
          durationInFrames={100}
          fontSize={48}
          fontFamily={FONTS.sans}
          color={COLORS.foreground}
          fontWeight={700}
        />
      </div>
    </AbsoluteFill>
  );
};
