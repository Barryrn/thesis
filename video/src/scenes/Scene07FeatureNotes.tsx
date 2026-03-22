import { useCurrentFrame } from "remotion";
import { AbsoluteFill } from "remotion";
import { COLORS, FONTS } from "../constants";
import { AnimatedText } from "../components/AnimatedText";
import { ScreenshotFrame } from "../components/ScreenshotFrame";
import { ParticleField } from "../components/ParticleField";
import { loadFonts } from "../fonts";

export const Scene07FeatureNotes: React.FC = () => {
  loadFonts();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        justifyContent: "center",
        alignItems: "center",
        padding: 40,
      }}
    >
      <ParticleField count={12} color={COLORS.dustyBlue} />

      {/* Title */}
      <div style={{ position: "absolute", top: 120, zIndex: 10, width: "100%", padding: "0 60px" }}>
        <AnimatedText
          text="Notizen & Recherche organisieren"
          mode="fade-up"
          startFrame={0}
          fontSize={44}
          fontFamily={FONTS.sans}
          color={COLORS.primary}
          fontWeight={700}
        />
      </div>

      {/* Screenshot showing paper detail with tags and findings */}
      <div style={{ marginTop: 80 }}>
        <ScreenshotFrame
          src="paper-detail.png"
          startFrame={15}
          highlights={[
            // Tags area
            { x: 52, y: 20, width: 44, height: 10, delay: 40 },
            // Research question
            { x: 52, y: 32, width: 44, height: 15, delay: 65 },
            // Key findings
            { x: 52, y: 72, width: 44, height: 22, delay: 90 },
          ]}
        />
      </div>

      {/* Description text */}
      <div style={{ position: "absolute", bottom: 160, zIndex: 10, width: "100%", padding: "0 60px" }}>
        <AnimatedText
          text="Deine gesamte Recherche übersichtlich an einem Ort."
          mode="word-by-word"
          startFrame={80}
          durationInFrames={120}
          fontSize={36}
          fontFamily={FONTS.sans}
          color={COLORS.foreground}
          fontWeight={500}
          lineHeight={1.5}
        />
      </div>
    </AbsoluteFill>
  );
};
