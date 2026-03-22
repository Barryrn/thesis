import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { SEGMENTS } from "./segments";

export const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames } = useVideoConfig();
  const currentSec = frame / fps;

  const progress = frame / durationInFrames;
  const barWidth = width - 60;

  // Find current segment
  const currentSegment = SEGMENTS.find(
    (s) => currentSec >= s.startSec && currentSec < s.endSec,
  );
  const color = currentSegment?.color ?? "#FFC211";

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: 60,
      }}
    >
      <div
        style={{
          width: barWidth,
          height: 4,
          backgroundColor: "rgba(255,255,255,0.15)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            backgroundColor: color,
            borderRadius: 2,
            boxShadow: `0 0 10px ${color}80`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
