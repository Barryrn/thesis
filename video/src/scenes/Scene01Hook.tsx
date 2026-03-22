import { useCurrentFrame } from "remotion";
import { AbsoluteFill } from "remotion";
import { COLORS, FONTS } from "../constants";
import { AnimatedText } from "../components/AnimatedText";
import { ParticleField } from "../components/ParticleField";
import { loadFonts } from "../fonts";

export const Scene01Hook: React.FC = () => {
  loadFonts();
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        justifyContent: "center",
        alignItems: "center",
        padding: 60,
      }}
    >
      <ParticleField count={25} />

      <div style={{ position: "relative", zIndex: 1, width: "100%" }}>
        {/* Graduation cap emoji */}
        <AnimatedText
          text="🎓"
          mode="fade-up"
          startFrame={0}
          fontSize={80}
          style={{ marginBottom: 40 }}
        />

        {/* Main hook text */}
        <AnimatedText
          text="Hey, falls du gerade an deiner Thesis arbeitest..."
          mode="word-by-word"
          startFrame={10}
          durationInFrames={80}
          fontSize={56}
          fontFamily={FONTS.serif}
          color={COLORS.foreground}
          fontWeight={400}
          lineHeight={1.4}
        />

        {/* "pass auf" highlight */}
        <AnimatedText
          text="pass auf."
          mode="highlight"
          startFrame={70}
          durationInFrames={40}
          fontSize={72}
          fontFamily={FONTS.serif}
          color={COLORS.primary}
          highlightColor={COLORS.primary}
          fontWeight={400}
          style={{ marginTop: 30 }}
        />
      </div>
    </AbsoluteFill>
  );
};
