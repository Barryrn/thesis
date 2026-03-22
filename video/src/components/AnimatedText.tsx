import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { FONTS, COLORS } from "../constants";

type AnimatedTextMode = "word-by-word" | "typewriter" | "fade-up" | "highlight";

interface AnimatedTextProps {
  text: string;
  mode?: AnimatedTextMode;
  startFrame?: number;
  durationInFrames?: number;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  highlightColor?: string;
  lineHeight?: number;
  textAlign?: React.CSSProperties["textAlign"];
  fontWeight?: number | string;
  style?: React.CSSProperties;
}

export const AnimatedText: React.FC<AnimatedTextProps> = ({
  text,
  mode = "fade-up",
  startFrame = 0,
  durationInFrames = 60,
  fontSize = 48,
  fontFamily = FONTS.sans,
  color = COLORS.foreground,
  highlightColor = COLORS.primary,
  lineHeight = 1.3,
  textAlign = "center",
  fontWeight = 600,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const relativeFrame = frame - startFrame;

  if (relativeFrame < 0) return null;

  if (mode === "typewriter") {
    const charCount = Math.floor(
      interpolate(relativeFrame, [0, durationInFrames * 0.7], [0, text.length], {
        extrapolateRight: "clamp",
      })
    );
    const displayText = text.slice(0, charCount);
    const showCursor = relativeFrame % 16 < 10;

    return (
      <div
        style={{
          fontSize,
          fontFamily,
          color,
          lineHeight,
          textAlign,
          fontWeight,
          ...style,
        }}
      >
        {displayText}
        <span style={{ opacity: showCursor ? 1 : 0, color: COLORS.primary }}>|</span>
      </div>
    );
  }

  if (mode === "word-by-word") {
    const words = text.split(" ");
    const framesPerWord = Math.floor(durationInFrames / (words.length + 2));

    return (
      <div
        style={{
          fontSize,
          fontFamily,
          color,
          lineHeight,
          textAlign,
          fontWeight,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: textAlign === "center" ? "center" : "flex-start",
          gap: fontSize * 0.25,
          ...style,
        }}
      >
        {words.map((word, i) => {
          const wordStart = i * framesPerWord;
          const scale = spring({
            frame: relativeFrame - wordStart,
            fps,
            config: { damping: 12, stiffness: 200, mass: 0.5 },
          });
          const opacity = interpolate(
            relativeFrame - wordStart,
            [0, 8],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                transform: `scale(${scale}) translateY(${(1 - scale) * 20}px)`,
                opacity,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    );
  }

  if (mode === "highlight") {
    const textOpacity = interpolate(relativeFrame, [0, 15], [0, 1], {
      extrapolateRight: "clamp",
    });
    const highlightWidth = interpolate(
      relativeFrame,
      [15, durationInFrames * 0.5],
      [0, 100],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );

    return (
      <div
        style={{
          position: "relative",
          display: "inline-block",
          fontSize,
          fontFamily,
          color,
          lineHeight,
          textAlign,
          fontWeight,
          opacity: textOpacity,
          ...style,
        }}
      >
        <span
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: `${highlightWidth}%`,
            height: "35%",
            backgroundColor: highlightColor,
            opacity: 0.3,
            zIndex: -1,
            borderRadius: 4,
          }}
        />
        {text}
      </div>
    );
  }

  // fade-up (default)
  const opacity = interpolate(relativeFrame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const translateY = interpolate(relativeFrame, [0, 20], [40, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        fontSize,
        fontFamily,
        color,
        lineHeight,
        textAlign,
        fontWeight,
        opacity,
        transform: `translateY(${translateY}px)`,
        ...style,
      }}
    >
      {text}
    </div>
  );
};
