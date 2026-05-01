/// Barrel export for the shared AI / parsing progress affordances.
///
/// All long-running AI calls and Python parsing operations should use
/// one of these three composite components to keep loading + cancel UI
/// visually consistent across the app.
export { Spinner, type SpinnerSize } from "./Spinner";
export { StopButton } from "./StopButton";
export { AIButtonProgress } from "./AIButtonProgress";
export { AISurfaceProgress } from "./AISurfaceProgress";
export {
  openAIToastProgress,
  type AIToastProgressHandle,
} from "./AIToastProgress";
