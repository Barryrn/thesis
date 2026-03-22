import { useCurrentFrame, interpolate } from "remotion";
import { AbsoluteFill } from "remotion";
import { COLORS, FONTS } from "../constants";
import { AnimatedText } from "../components/AnimatedText";
import { Logo } from "../components/Logo";
import { ParticleField } from "../components/ParticleField";
import { loadFonts } from "../fonts";

export const Scene03SolutionReveal: React.FC = () => {
  loadFonts();
  const frame = useCurrentFrame();

  // Golden glow expands from center
  const glowSize = interpolate(frame, [60, 150], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <ParticleField count={20} />

      {/* Expanding golden glow */}
      <div
        style={{
          position: "absolute",
          width: `${glowSize}%`,
          height: `${glowSize}%`,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.primary}12 0%, transparent 70%)`,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          padding: 60,
        }}
      >
        {/* "Genau dieses Problem löst diese App" */}
        <AnimatedText
          text="Genau dieses Problem löst diese App."
          mode="fade-up"
          startFrame={0}
          fontSize={44}
          fontFamily={FONTS.sans}
          color={COLORS.foreground}
          fontWeight={600}
          style={{ marginBottom: 40 }}
        />

        {/* Animated Logo */}
        <Logo startFrame={25} size={350} />

        {/* App name typewriter */}
        <AnimatedText
          text="Thesis Paper Organizer"
          mode="typewriter"
          startFrame={100}
          durationInFrames={80}
          fontSize={52}
          fontFamily={FONTS.serif}
          color={COLORS.primary}
          fontWeight={400}
          style={{ marginTop: 30 }}
        />

        {/* Tagline */}
        <AnimatedText
          text="AI-powered research organization"
          mode="fade-up"
          startFrame={160}
          fontSize={28}
          fontFamily={FONTS.sans}
          color={COLORS.muted}
          fontWeight={400}
        />
      </div>
    </AbsoluteFill>
  );
};
