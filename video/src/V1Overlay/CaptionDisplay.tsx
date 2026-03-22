import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Sequence } from "remotion";
import type { TikTokPage } from "@remotion/captions";

const HIGHLIGHT_COLOR = "#FFC211";
const TEXT_COLOR = "#ffffff";
const SWITCH_CAPTIONS_EVERY_MS = 1200;

const CaptionPage: React.FC<{ page: TikTokPage }> = ({ page }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentTimeMs = (frame / fps) * 1000;
  const absoluteTimeMs = page.startMs + currentTimeMs;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 220,
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(0,0,0,0.6)",
          borderRadius: 16,
          padding: "16px 28px",
          maxWidth: "85%",
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          style={{
            fontSize: 42,
            fontWeight: 700,
            whiteSpace: "pre-wrap",
            textAlign: "center",
            lineHeight: 1.3,
            fontFamily: "Geist Variable, sans-serif",
          }}
        >
          {page.tokens.map((token, i) => {
            const isActive =
              token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;

            return (
              <span
                key={`${token.fromMs}-${i}`}
                style={{
                  color: isActive ? HIGHLIGHT_COLOR : TEXT_COLOR,
                  textShadow: isActive
                    ? `0 0 20px ${HIGHLIGHT_COLOR}80`
                    : "0 2px 4px rgba(0,0,0,0.8)",
                  transition: "none",
                }}
              >
                {token.text}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const CaptionDisplay: React.FC<{ pages: TikTokPage[] }> = ({
  pages,
}) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const nextPage = pages[index + 1] ?? null;
        const startFrame = (page.startMs / 1000) * fps;
        const endFrame = Math.min(
          nextPage ? (nextPage.startMs / 1000) * fps : Infinity,
          startFrame + (SWITCH_CAPTIONS_EVERY_MS / 1000) * fps,
        );
        const durationInFrames = Math.round(endFrame - startFrame);

        if (durationInFrames <= 0) {
          return null;
        }

        return (
          <Sequence
            key={index}
            from={Math.round(startFrame)}
            durationInFrames={durationInFrames}
            premountFor={Math.round(0.5 * fps)}
          >
            <CaptionPage page={page} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
