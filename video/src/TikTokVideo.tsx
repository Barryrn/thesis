import { Sequence } from "remotion";
import { TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { linearTiming, springTiming } from "@remotion/transitions";
import { Audio } from "@remotion/media";
import { whoosh, uiSwitch, mouseClick, pageTurn } from "@remotion/sfx";

import { SCENES, TRANSITION_DURATION } from "./constants";
import { Scene01Hook } from "./scenes/Scene01Hook";
import { Scene02Problem } from "./scenes/Scene02Problem";
import { Scene03SolutionReveal } from "./scenes/Scene03SolutionReveal";
import { Scene04FeatureUpload } from "./scenes/Scene04FeatureUpload";
import { Scene05FeatureOutline } from "./scenes/Scene05FeatureOutline";
import { Scene06FeatureMatching } from "./scenes/Scene06FeatureMatching";
import { Scene07FeatureNotes } from "./scenes/Scene07FeatureNotes";
import { Scene08ValueProp } from "./scenes/Scene08ValueProp";
import { Scene09CTA } from "./scenes/Scene09CTA";

export const TikTokVideo: React.FC = () => {
  const T = TRANSITION_DURATION;

  // Calculate cumulative start frames for SFX placement
  // Each transition overlaps by T frames
  const starts = {
    scene1: 0,
    scene2: SCENES.hook - T,
    scene3: SCENES.hook + SCENES.problem - 2 * T,
    scene4: SCENES.hook + SCENES.problem + SCENES.solutionReveal - 3 * T,
    scene5:
      SCENES.hook +
      SCENES.problem +
      SCENES.solutionReveal +
      SCENES.featureUpload -
      4 * T,
    scene6:
      SCENES.hook +
      SCENES.problem +
      SCENES.solutionReveal +
      SCENES.featureUpload +
      SCENES.featureOutline -
      5 * T,
    scene7:
      SCENES.hook +
      SCENES.problem +
      SCENES.solutionReveal +
      SCENES.featureUpload +
      SCENES.featureOutline +
      SCENES.featureMatching -
      6 * T,
    scene8:
      SCENES.hook +
      SCENES.problem +
      SCENES.solutionReveal +
      SCENES.featureUpload +
      SCENES.featureOutline +
      SCENES.featureMatching +
      SCENES.featureNotes -
      7 * T,
  };

  return (
    <>
      <TransitionSeries>
        {/* Scene 1: Hook */}
        <TransitionSeries.Sequence durationInFrames={SCENES.hook}>
          <Scene01Hook />
        </TransitionSeries.Sequence>

        {/* Transition: fade */}
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: T })}
        />

        {/* Scene 2: Problem */}
        <TransitionSeries.Sequence durationInFrames={SCENES.problem}>
          <Scene02Problem />
        </TransitionSeries.Sequence>

        {/* Transition: wipe (satisfying clear to solution) */}
        <TransitionSeries.Transition
          presentation={wipe({ direction: "from-left" })}
          timing={linearTiming({ durationInFrames: T + 5 })}
        />

        {/* Scene 3: Solution Reveal */}
        <TransitionSeries.Sequence durationInFrames={SCENES.solutionReveal}>
          <Scene03SolutionReveal />
        </TransitionSeries.Sequence>

        {/* Transition: slide from bottom */}
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={springTiming({ config: { damping: 15 } })}
        />

        {/* Scene 4: Upload Feature */}
        <TransitionSeries.Sequence durationInFrames={SCENES.featureUpload}>
          <Scene04FeatureUpload />
        </TransitionSeries.Sequence>

        {/* Transition: slide right */}
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: T })}
        />

        {/* Scene 5: Outline Feature */}
        <TransitionSeries.Sequence durationInFrames={SCENES.featureOutline}>
          <Scene05FeatureOutline />
        </TransitionSeries.Sequence>

        {/* Transition: slide right */}
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: T })}
        />

        {/* Scene 6: Matching Feature */}
        <TransitionSeries.Sequence durationInFrames={SCENES.featureMatching}>
          <Scene06FeatureMatching />
        </TransitionSeries.Sequence>

        {/* Transition: slide right */}
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: T })}
        />

        {/* Scene 7: Notes Feature */}
        <TransitionSeries.Sequence durationInFrames={SCENES.featureNotes}>
          <Scene07FeatureNotes />
        </TransitionSeries.Sequence>

        {/* Transition: fade */}
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: T + 5 })}
        />

        {/* Scene 8: Value Prop */}
        <TransitionSeries.Sequence durationInFrames={SCENES.valueProp}>
          <Scene08ValueProp />
        </TransitionSeries.Sequence>

        {/* Transition: fade */}
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: T })}
        />

        {/* Scene 9: CTA */}
        <TransitionSeries.Sequence durationInFrames={SCENES.cta}>
          <Scene09CTA />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {/* Sound Effects - placed at scene transition points */}

      <Sequence from={starts.scene2}>
        <Audio src={whoosh} />
      </Sequence>

      <Sequence from={starts.scene3}>
        <Audio src={uiSwitch} />
      </Sequence>

      <Sequence from={starts.scene4}>
        <Audio src={mouseClick} />
      </Sequence>

      <Sequence from={starts.scene4 + 80}>
        <Audio src={whoosh} />
      </Sequence>

      <Sequence from={starts.scene5}>
        <Audio src={uiSwitch} />
      </Sequence>

      <Sequence from={starts.scene6}>
        <Audio src={whoosh} />
      </Sequence>

      <Sequence from={starts.scene7}>
        <Audio src={pageTurn} />
      </Sequence>

      <Sequence from={starts.scene8}>
        <Audio src={uiSwitch} />
      </Sequence>
    </>
  );
};
