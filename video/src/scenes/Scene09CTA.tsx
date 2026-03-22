import { useCurrentFrame, useVideoConfig, interpolate, spring, Img } from "remotion";
import { AbsoluteFill, staticFile } from "remotion";
import { COLORS, FONTS } from "../constants";
import { AnimatedText } from "../components/AnimatedText";
import { ParticleField } from "../components/ParticleField";
import { loadFonts } from "../fonts";

export const Scene09CTA: React.FC = () => {
  loadFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo gentle pulse
  const logoScale = 1 + Math.sin(frame * 0.06) * 0.02;

  // Border draw-in
  const borderProgress = interpolate(frame, [100, 180], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
      }}
    >
      <ParticleField count={20} />

      {/* Golden border frame */}
      <div
        style={{
          position: "absolute",
          inset: 40,
          border: `2px solid ${COLORS.primary}`,
          borderRadius: 20,
          opacity: borderProgress * 0.5,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 30,
          width: "100%",
        }}
      >
        {/* "Kostenlos verfügbar" */}
        <AnimatedText
          text="Kostenlos verfügbar:"
          mode="fade-up"
          startFrame={0}
          fontSize={38}
          fontFamily={FONTS.sans}
          color={COLORS.foreground}
          fontWeight={500}
        />

        {/* GitHub icon + URL */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginTop: 10,
          }}
        >
          {/* GitHub SVG icon */}
          <svg
            width={48}
            height={48}
            viewBox="0 0 24 24"
            fill={COLORS.foreground}
            style={{
              opacity: interpolate(frame, [15, 30], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>

          <AnimatedText
            text="github.com/Barryrn/thesis"
            mode="typewriter"
            startFrame={20}
            durationInFrames={80}
            fontSize={36}
            fontFamily={FONTS.sans}
            color={COLORS.primary}
            fontWeight={600}
          />
        </div>

        {/* API key note */}
        <AnimatedText
          text="Du brauchst nur einen AI-API-Key, um direkt loszulegen."
          mode="fade-up"
          startFrame={90}
          fontSize={30}
          fontFamily={FONTS.sans}
          color={COLORS.muted}
          fontWeight={400}
          style={{ marginTop: 20 }}
        />

        {/* Logo with pulse */}
        <div style={{ marginTop: 40 }}>
          <Img
            src={staticFile("svg_logo.svg")}
            style={{
              width: 120,
              height: 120,
              transform: `scale(${logoScale})`,
              opacity: interpolate(frame, [130, 150], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
