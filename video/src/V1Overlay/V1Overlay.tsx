import React, { useState, useEffect, useCallback } from "react";
import { AbsoluteFill, staticFile, useDelayRender } from "remotion";
import { Video } from "@remotion/media";
import { createTikTokStyleCaptions } from "@remotion/captions";
import type { Caption } from "@remotion/captions";
import { CaptionDisplay } from "./CaptionDisplay";
import { SegmentBadge } from "./SegmentBadge";
import { AudioBars } from "./AudioBars";
import { ProgressBar } from "./ProgressBar";

const SWITCH_CAPTIONS_EVERY_MS = 1200;

export const V1Overlay: React.FC = () => {
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender());

  const fetchCaptions = useCallback(async () => {
    try {
      const response = await fetch(staticFile("captions.json"));
      const data = await response.json();
      setCaptions(data);
      continueRender(handle);
    } catch (e) {
      cancelRender(e);
    }
  }, [continueRender, cancelRender, handle]);

  useEffect(() => {
    fetchCaptions();
  }, [fetchCaptions]);

  if (!captions) {
    return null;
  }

  const { pages } = createTikTokStyleCaptions({
    captions,
    combineTokensWithinMilliseconds: SWITCH_CAPTIONS_EVERY_MS,
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Original video as background */}
      <Video
        src={staticFile("V1.mov")}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />

      {/* Progress bar at top */}
      <ProgressBar />

      {/* Segment badge */}
      <SegmentBadge />

      {/* Audio visualization bars at bottom */}
      <AudioBars />

      {/* Animated captions */}
      <CaptionDisplay pages={pages} />
    </AbsoluteFill>
  );
};
