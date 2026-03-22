import { useCurrentFrame, interpolate } from "remotion";
import { AbsoluteFill } from "remotion";
import { COLORS, FONTS } from "../constants";
import { AnimatedText } from "../components/AnimatedText";
import { ParticleField } from "../components/ParticleField";
import { loadFonts } from "../fonts";

export const Scene08ValueProp: React.FC = () => {
  loadFonts();
  const frame = useCurrentFrame();

  // Background pulse
  const pulse = interpolate(
    Math.sin(frame * 0.04),
    [-1, 1],
    [0.03, 0.08]
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
      }}
    >
      <ParticleField count={35} />

      {/* Ambient glow */}
      <div
        style={{
          position: "absolute",
          width: "80%",
          height: "40%",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.primary}${Math.round(pulse * 255).toString(16).padStart(2, "0")} 0%, transparent 70%)`,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 40,
        }}
      >
        {/* Line 1 */}
        <AnimatedText
          text="Weniger Zeit mit Organisation"
          mode="fade-up"
          startFrame={0}
          fontSize={46}
          fontFamily={FONTS.serif}
          color={COLORS.dustyBlue}
          fontWeight={400}
        />

        {/* Line 2 - bigger, golden */}
        <AnimatedText
          text="Mehr Zeit fürs Schreiben."
          mode="highlight"
          startFrame={40}
          durationInFrames={100}
          fontSize={62}
          fontFamily={FONTS.serif}
          color={COLORS.primary}
          highlightColor={COLORS.primary}
          fontWeight={400}
        />
      </div>
    </AbsoluteFill>
  );
};
