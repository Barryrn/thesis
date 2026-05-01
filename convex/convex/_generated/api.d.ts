/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as figures from "../figures.js";
import type * as grouper from "../grouper.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as matches from "../matches.js";
import type * as outline from "../outline.js";
import type * as papers from "../papers.js";
import type * as recommendations from "../recommendations.js";
import type * as sectionContent from "../sectionContent.js";
import type * as sources from "../sources.js";
import type * as summaries from "../summaries.js";
import type * as thesisExport from "../thesisExport.js";
import type * as thesisMetadata from "../thesisMetadata.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  figures: typeof figures;
  grouper: typeof grouper;
  groups: typeof groups;
  http: typeof http;
  matches: typeof matches;
  outline: typeof outline;
  papers: typeof papers;
  recommendations: typeof recommendations;
  sectionContent: typeof sectionContent;
  sources: typeof sources;
  summaries: typeof summaries;
  thesisExport: typeof thesisExport;
  thesisMetadata: typeof thesisMetadata;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
