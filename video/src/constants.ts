export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
} as const;

export const COLORS = {
  background: "#1a1612",
  foreground: "#e8e2d8",
  card: "#2a2520",
  cardBorder: "rgba(255,255,255,0.08)",
  primary: "#FFC211",
  primaryDim: "#b8860b",
  sage: "#7ab07a",
  sageDim: "#4a7a4a",
  dustyBlue: "#7a9ab0",
  dustyBlueDim: "#4a6a80",
  navy: "#102B4E",
  muted: "#999080",
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
  white: "#ffffff",
} as const;

export const FONTS = {
  sans: "Geist Variable, sans-serif",
  serif: "Instrument Serif, Georgia, serif",
} as const;

// Scene durations in frames (at 30fps)
export const SCENES = {
  hook: 120, // 4s
  problem: 180, // 6s
  solutionReveal: 210, // 7s
  featureUpload: 300, // 10s
  featureOutline: 300, // 10s
  featureMatching: 360, // 12s
  featureNotes: 240, // 8s
  valueProp: 180, // 6s
  cta: 210, // 7s
} as const;

export const TRANSITION_DURATION = 15; // 0.5s fade/slide between scenes
