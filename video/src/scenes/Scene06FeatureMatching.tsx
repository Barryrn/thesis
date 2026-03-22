import { useCurrentFrame } from "remotion";
import { AbsoluteFill } from "remotion";
import { COLORS, FONTS } from "../constants";
import { AnimatedText } from "../components/AnimatedText";
import { ScreenshotFrame } from "../components/ScreenshotFrame";
import { RelevanceBadge } from "../components/RelevanceBadge";
import { ParticleField } from "../components/ParticleField";
import { loadFonts } from "../fonts";

export const Scene06FeatureMatching: React.FC = () => {
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
      <ParticleField count={15} color={COLORS.sage} />

      {/* Title */}
      <div style={{ position: "absolute", top: 120, zIndex: 10, width: "100%", padding: "0 60px" }}>
        <AnimatedText
          text="Automatische Relevanz-Bewertung"
          mode="fade-up"
          startFrame={0}
          fontSize={44}
          fontFamily={FONTS.sans}
          color={COLORS.primary}
          fontWeight={700}
        />
      </div>

      {/* Screenshot */}
      <div style={{ marginTop: 40 }}>
        <ScreenshotFrame
          src="section-detail.png"
          startFrame={15}
          highlights={[
            // Section content area with matched papers
            { x: 18, y: 5, width: 60, height: 90, delay: 40 },
            // Right panel with paper list
            { x: 78, y: 5, width: 21, height: 90, delay: 70 },
          ]}
        />
      </div>

      {/* Animated relevance badges overlay */}
      <div style={{ position: "absolute", bottom: 360, right: 80, zIndex: 10 }}>
        <RelevanceBadge score={0.87} startFrame={120} />
      </div>
      <div style={{ position: "absolute", bottom: 300, right: 80, zIndex: 10 }}>
        <RelevanceBadge score={0.65} startFrame={145} />
      </div>
      <div style={{ position: "absolute", bottom: 240, right: 80, zIndex: 10 }}>
        <RelevanceBadge score={0.38} startFrame={170} />
      </div>

      {/* Description text */}
      <div style={{ position: "absolute", bottom: 100, zIndex: 10, width: "100%", padding: "0 60px" }}>
        <AnimatedText
          text="Quellen werden analysiert, bewertet und den passenden Kapiteln zugeordnet."
          mode="word-by-word"
          startFrame={130}
          durationInFrames={150}
          fontSize={34}
          fontFamily={FONTS.sans}
          color={COLORS.foreground}
          fontWeight={500}
          lineHeight={1.5}
        />
      </div>
    </AbsoluteFill>
  );
};
