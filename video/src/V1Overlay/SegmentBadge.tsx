import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
} from "remotion";
import { SEGMENTS, type Segment } from "./segments";

const Badge: React.FC<{ segment: Segment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({ frame, fps, config: { damping: 200 } });
  const translateY = interpolate(entrance, [0, 1], [-60, 0]);
  const opacity = interpolate(entrance, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: 100,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          backgroundColor: `${segment.color}20`,
          border: `2px solid ${segment.color}`,
          borderRadius: 40,
          padding: "10px 24px",
          transform: `translateY(${translateY}px)`,
          opacity,
        }}
      >
        <span style={{ fontSize: 28 }}>{segment.emoji}</span>
        <span
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: segment.color,
            fontFamily: "Geist Variable, sans-serif",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {segment.label}
        </span>
      </div>
    </AbsoluteFill>
  );
};

export const SegmentBadge: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      {SEGMENTS.map((segment, i) => {
        const startFrame = Math.round(segment.startSec * fps);
        const endFrame = Math.round(segment.endSec * fps);
        const durationInFrames = endFrame - startFrame;

        if (durationInFrames <= 0) return null;

        return (
          <Sequence
            key={segment.id}
            from={startFrame}
            durationInFrames={durationInFrames}
            premountFor={Math.round(0.5 * fps)}
          >
            <Badge segment={segment} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
