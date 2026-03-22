import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, staticFile } from "remotion";
import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";

export const AudioBars: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: staticFile("V1_audio.wav"),
    frame,
    fps,
    windowInSeconds: 30,
  });

  if (!audioData) {
    return null;
  }

  const frequencies = visualizeAudio({
    fps,
    frame,
    audioData,
    numberOfSamples: 64,
    optimizeFor: "speed",
    dataOffsetInSeconds,
  });

  // Take middle frequencies for a cleaner look
  const bars = frequencies.slice(4, 36);
  const barWidth = (width - 80) / bars.length;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          height: 60,
          gap: 2,
          opacity: 0.6,
        }}
      >
        {bars.map((v, i) => {
          const height = Math.max(3, v * 60);
          const hue = 40 + i * 2; // gold gradient
          return (
            <div
              key={i}
              style={{
                width: barWidth - 2,
                height,
                backgroundColor: `hsl(${hue}, 80%, 55%)`,
                borderRadius: 2,
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
