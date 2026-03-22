import { useCurrentFrame } from "remotion";
import { AbsoluteFill } from "remotion";
import { COLORS, FONTS } from "../constants";
import { AnimatedText } from "../components/AnimatedText";
import { ScreenshotFrame } from "../components/ScreenshotFrame";
import { ParticleField } from "../components/ParticleField";
import { loadFonts } from "../fonts";

export const Scene05FeatureOutline: React.FC = () => {
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
      <ParticleField count={15} color={COLORS.dustyBlue} />

      {/* Title */}
      <div style={{ position: "absolute", top: 120, zIndex: 10, width: "100%", padding: "0 60px" }}>
        <AnimatedText
          text="Gliederung erstellen & Quellen zuordnen"
          mode="fade-up"
          startFrame={0}
          fontSize={42}
          fontFamily={FONTS.sans}
          color={COLORS.primary}
          fontWeight={700}
        />
      </div>

      {/* Screenshot */}
      <div style={{ marginTop: 80 }}>
        <ScreenshotFrame
          src="dashboard.png"
          startFrame={15}
          highlights={[
            // Outline sidebar
            { x: 0, y: 8, width: 20, height: 88, delay: 40 },
            // Documents panel
            { x: 76, y: 8, width: 23, height: 88, delay: 80 },
          ]}
        />
      </div>

      {/* Description text */}
      <div style={{ position: "absolute", bottom: 160, zIndex: 10, width: "100%", padding: "0 60px" }}>
        <AnimatedText
          text="Deine Quellen werden direkt den passenden Kapiteln deiner Gliederung zugeordnet."
          mode="word-by-word"
          startFrame={100}
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
