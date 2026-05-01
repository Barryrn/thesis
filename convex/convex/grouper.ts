"use node";

/// DEPRECATED — kept only so existing references in _generated/api.d.ts
/// resolve cleanly until the next `convex dev` regenerates the bindings.
///
/// The matcher used to live here as a Convex action that POSTed to the
/// user's local Python service. That doesn't work: Convex actions run in
/// Convex's cloud Node runtime, where `localhost:8000` resolves to the
/// cloud machine — every fetch failed with ECONNREFUSED. See
/// frontend/src/lib/runGroupMatcher.ts for the working browser-side
/// implementation.
///
/// The exported actions below are stubs that return immediately. They
/// exist so that any leftover `api.grouper.*` references in regenerated
/// type files don't throw at runtime; nothing should actually call them.
import { v } from "convex/values";
import { action } from "./_generated/server";

export const runForPaper = action({
  args: { paperId: v.id("papers") },
  handler: async () => {
    // Intentionally empty — the browser drives the matcher now.
  },
});

export const runForGroupBackfill = action({
  args: { groupId: v.id("paperGroups") },
  handler: async () => {
    // Intentionally empty — the browser drives the matcher now.
  },
});

export const runForGroupRerun = action({
  args: { groupId: v.id("paperGroups") },
  handler: async () => {
    // Intentionally empty — the browser drives the matcher now.
  },
});
