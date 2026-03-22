import { useCurrentFrame } from "remotion";
import { AbsoluteFill } from "remotion";
import { COLORS, FONTS } from "../constants";
import { AnimatedText } from "../components/AnimatedText";
import { ScreenshotFrame } from "../components/ScreenshotFrame";
import { ParticleField } from "../components/ParticleField";
import { loadFonts } from "../fonts";

export const Scene04FeatureUpload: React.FC = () => {
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
          text="Papers hochladen & KI-Analyse"
          mode="fade-up"
          startFrame={0}
          fontSize={44}
          fontFamily={FONTS.sans}
          color={COLORS.primary}
          fontWeight={700}
        />
      </div>

      {/* Screenshot */}
      <div style={{ marginTop: 80 }}>
        <ScreenshotFrame
          src="upload.png"
          startFrame={15}
          highlights={[
            // Upload drop zone
            { x: 4, y: 10, width: 92, height: 28, delay: 40 },
            // Papers table
            { x: 4, y: 48, width: 92, height: 48, delay: 80 },
          ]}
        />
      </div>

      {/* Description text */}
      <div style={{ position: "absolute", bottom: 160, zIndex: 10, width: "100%", padding: "0 60px" }}>
        <AnimatedText
          text="Die App analysiert den Inhalt automatisch und erstellt strukturierte Zusammenfassungen."
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
