import { Composition } from "remotion";
import { TikTokVideo } from "./TikTokVideo";
import { V1Overlay } from "./V1Overlay/V1Overlay";
import { VIDEO, SCENES, TRANSITION_DURATION } from "./constants";

const totalDuration =
  Object.values(SCENES).reduce((sum, d) => sum + d, 0) -
  TRANSITION_DURATION * 8; // 8 transitions between 9 scenes

// V1.mov is 1:45.57 at 30fps
const V1_DURATION_FRAMES = Math.ceil(105.57 * 30);

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TikTokPromo"
        component={TikTokVideo}
        durationInFrames={totalDuration}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="V1Overlay"
        component={V1Overlay}
        durationInFrames={V1_DURATION_FRAMES}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
