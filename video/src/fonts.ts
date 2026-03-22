import { continueRender, delayRender, staticFile } from "remotion";

let fontsInitiated = false;

export const loadFonts = () => {
  if (fontsInitiated) return;
  fontsInitiated = true;

  const handle = delayRender("Loading fonts");

  const geist = new FontFace(
    "Geist Variable",
    `url('${staticFile("GeistVF.woff2")}') format('woff2')`,
    { weight: "100 900", style: "normal" }
  );

  const instrumentSerif = new FontFace(
    "Instrument Serif",
    `url('${staticFile("InstrumentSerif.woff2")}') format('woff2')`,
    { weight: "400", style: "normal" }
  );

  Promise.all([geist.load(), instrumentSerif.load()])
    .then((fonts) => {
      fonts.forEach((font) => document.fonts.add(font));
      continueRender(handle);
    })
    .catch((err) => {
      console.error("Font loading failed, using fallbacks:", err);
      continueRender(handle);
    });
};
