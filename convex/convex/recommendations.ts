"use node";

/// Smart paper recommender for citations. The action assembles the input text
/// (section title + body + notes), filters candidate papers by scope, drops
/// already-matched papers, and dispatches to the Python /recommend-papers
/// endpoint. The action is the single networked layer; queries and mutations
/// stay deterministic. Recommendations are NOT persisted — the client uses
/// `addMatch` (matches.ts) to commit accepted ones.
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

// `process.env` is available in the Node.js runtime (`"use node"`) but the
// shared TypeScript checker can't see Node types. Read it via globalThis to
// keep tsc happy without pulling in @types/node for the whole project.
const PYTHON_URL =
  (globalThis as { process?: { env?: { PYTHON_URL?: string } } }).process?.env
    ?.PYTHON_URL ?? "http://localhost:8000";

/// Threshold used by both the Python recommender and the UI banner.
/// Mirrors recommender.LOW_CONTEXT_CHAR_THRESHOLD; duplicated here so the
/// Convex action can decide locally whether body+notes have enough signal.
const LOW_CONTEXT_CHAR_THRESHOLD = 50;

/// Per-paper payload sent to Python — must match recommender.py expectations.
type PaperPayload = {
  paperId: string;
  title: string;
  authors: string[];
  year?: number;
  summary: {
    researchQuestion: string;
    methodology: string;
    keyFindings: string[];
    keywords: string[];
  };
};

/// One scored row returned by Python.
type RecommendationRow = {
  paperId: string;
  score: number;
  reasoning: string;
};

/// What the action returns to the client. Title/authors/year are denormalised
/// here so the sheet can render without a second round of queries.
type EnrichedRecommendation = RecommendationRow & {
  title: string;
  authors: string[];
  year?: number;
};

/// Heuristic mirror of section_writer.detect_language. Picks "de" when the
/// body has German diacritics or 3+ stopword hits; otherwise "en". Lives here
/// because Convex can't import Python — and we want the same answer the
/// Python writer would give so reasoning text matches the user's prose.
function detectLanguage(body: string, fallback: "en" | "de"): "en" | "de" {
  const cleaned = body.trim();
  if (cleaned.length < 80) return fallback;
  const lowered = cleaned.toLowerCase();
  if (/[äöüß]/.test(lowered)) return "de";
  const tokens = lowered.match(/[a-zäöüß]+/g) ?? [];
  const stopwords = new Set([
    "der", "die", "das", "und", "ist", "nicht", "ein", "eine", "mit",
    "auch", "von", "auf", "aber", "wenn", "noch", "schon", "über",
    "werden", "wird", "wurde", "sich", "dass", "weil", "durch",
  ]);
  let hits = 0;
  for (const t of tokens) if (stopwords.has(t)) hits++;
  if (hits >= 3) return "de";
  return "en";
}

/// Recommend papers for citation in a specific section.
///
/// Reads `outlineSections.title`, `outlineSections.notes`, and
/// `sectionContent.body` for the input text. Filters papers by `scope`:
///   - "all"     → every completed paper
///   - "groups"  → papers in any of the supplied group IDs
///   - "papers"  → exactly the supplied paper IDs
/// Already-matched papers (rows in `paperSectionMatches` for this section)
/// are excluded before scoring. Returns a ranked list with reasoning in the
/// section's detected language.
export const recommendPapersForSection = action({
  args: {
    sectionId: v.id("outlineSections"),
    scope: v.union(
      v.object({ type: v.literal("all") }),
      v.object({
        type: v.literal("groups"),
        groupIds: v.array(v.id("paperGroups")),
      }),
      v.object({
        type: v.literal("papers"),
        paperIds: v.array(v.id("papers")),
      })
    ),
    /// Provider override; defaults to anthropic to match the rest of the app.
    provider: v.optional(v.string()),
    /// Explicit reasoning language. When set, the UI's choice wins and we skip
    /// auto-detection — the user's selected app locale is the source of truth.
    language: v.optional(v.union(v.literal("en"), v.literal("de"))),
    /// Fallback language hint. Used only if `language` is omitted *and* the
    /// body is too short for the heuristic to decide. Kept for back-compat.
    fallbackLanguage: v.optional(v.union(v.literal("en"), v.literal("de"))),
  },
  handler: async (ctx, args) => {
    const provider = args.provider ?? "anthropic";
    const fallback = args.fallbackLanguage ?? "en";

    // ------------------------------------------------------------------
    // 1. Load section + draft body + existing matches.
    // ------------------------------------------------------------------
    const section = await ctx.runQuery(api.outline.getSectionById, {
      sectionId: args.sectionId,
    });
    if (!section) {
      throw new Error(`Section not found: ${args.sectionId}`);
    }

    const sectionContentRow = await ctx.runQuery(
      api.sectionContent.getSectionContent,
      { sectionId: args.sectionId }
    );
    const body: string = sectionContentRow?.body ?? "";
    const notes: string = section.notes ?? "";
    const title: string = section.title ?? "";

    const existingMatches = await ctx.runQuery(api.matches.getMatchesBySection, {
      sectionId: args.sectionId,
    });
    const alreadyMatched = new Set(
      (existingMatches ?? []).map((m: any) => m.paperId as string)
    );

    // ------------------------------------------------------------------
    // 2. Pick the candidate paper set based on scope.
    // ------------------------------------------------------------------
    const allPapers = await ctx.runQuery(api.papers.listPapers);
    let scopedPaperIds: Set<string>;

    if (args.scope.type === "all") {
      scopedPaperIds = new Set(
        allPapers
          .filter((p: any) => p.status === "completed")
          .map((p: any) => p._id as string)
      );
    } else if (args.scope.type === "groups") {
      const memberships = await ctx.runQuery(api.groups.listAllMemberships);
      const groupSet = new Set(args.scope.groupIds.map((g) => g as string));
      scopedPaperIds = new Set(
        memberships
          .filter((m: any) => groupSet.has(m.groupId as string))
          .map((m: any) => m.paperId as string)
      );
    } else {
      scopedPaperIds = new Set(args.scope.paperIds.map((p) => p as string));
    }

    // ------------------------------------------------------------------
    // 3. Drop already-matched papers and any without a summary row, then
    //    build the Python payload.
    // ------------------------------------------------------------------
    const candidates: PaperPayload[] = [];
    const titleByPaper = new Map<string, { title: string; authors: string[]; year?: number }>();

    for (const paper of allPapers) {
      const pid = paper._id as string;
      if (!scopedPaperIds.has(pid)) continue;
      if (alreadyMatched.has(pid)) continue;
      if (paper.status !== "completed") continue;

      const summary = await ctx.runQuery(api.summaries.getSummaryByPaper, {
        paperId: paper._id,
      });
      if (!summary) continue;

      candidates.push({
        paperId: pid,
        title: paper.title ?? "",
        authors: paper.authors ?? [],
        year: paper.year ?? undefined,
        summary: {
          researchQuestion: summary.researchQuestion ?? "",
          methodology: summary.methodology ?? "",
          keyFindings: summary.keyFindings ?? [],
          keywords: summary.keywords ?? [],
        },
      });
      titleByPaper.set(pid, {
        title: paper.title ?? "",
        authors: paper.authors ?? [],
        year: paper.year ?? undefined,
      });
    }

    // If the caller passed an explicit `language` (the UI does — it knows the
    // app locale), trust it. Otherwise fall back to body-based detection so
    // older callers still get prose-matching reasoning.
    const language = args.language ?? detectLanguage(body, fallback);
    const lowContextLocal =
      (body.trim().length + notes.trim().length) < LOW_CONTEXT_CHAR_THRESHOLD;

    if (candidates.length === 0) {
      // Nothing to score — return cleanly so the UI can show "no candidates".
      return {
        recommendations: [] as EnrichedRecommendation[],
        lowContext: lowContextLocal,
        language,
      };
    }

    // ------------------------------------------------------------------
    // 4. Dispatch to Python.
    // ------------------------------------------------------------------
    let response: Response;
    try {
      response = await fetch(`${PYTHON_URL}/recommend-papers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputText: { title, body, notes },
          papers: candidates,
          language,
          provider,
        }),
      });
    } catch (err) {
      console.error("[recommendations] fetch failed:", err);
      throw new Error("Recommendation service unreachable");
    }

    if (!response.ok) {
      console.error(
        "[recommendations] non-OK response:",
        response.status,
        await response.text().catch(() => "")
      );
      throw new Error(`Recommendation service returned ${response.status}`);
    }

    const body_json = (await response.json()) as {
      recommendations: RecommendationRow[];
      lowContext: boolean;
    };

    // ------------------------------------------------------------------
    // 5. Enrich with denormalised paper metadata for the UI.
    // ------------------------------------------------------------------
    const enriched: EnrichedRecommendation[] = [];
    for (const r of body_json.recommendations ?? []) {
      const meta = titleByPaper.get(r.paperId);
      if (!meta) continue;
      enriched.push({
        paperId: r.paperId,
        score: r.score,
        reasoning: r.reasoning,
        title: meta.title,
        authors: meta.authors,
        year: meta.year,
      });
    }

    return {
      recommendations: enriched,
      lowContext: body_json.lowContext,
      language,
    };
  },
});

/// Threshold for the selection-mode "low context" banner. Selections shorter
/// than this don't carry enough signal for the recommender to do useful work.
const LOW_SELECTION_CHAR_THRESHOLD = 20;

/// Recommend papers for a specific selection inside a section. Powers the
/// highlight-to-cite flow: the user highlights a sentence and asks "which
/// paper supports this?". Inputs are the selection text plus its enclosing
/// paragraph (already stripped of `{{cite:...}}` markers on the client),
/// scored against the chosen pool — the section's already-matched papers,
/// a specific group, or every completed paper.
///
/// Unlike `recommendPapersForSection`, papers already linked to the section
/// are NOT excluded — re-citing a paper already in the matches list is the
/// common case here.
export const recommendForSelection = action({
  args: {
    sectionId: v.id("outlineSections"),
    /// The highlighted text (cite markers stripped on the client).
    selectionText: v.string(),
    /// Enclosing paragraph(s) for additional context. Same stripping rules.
    paragraphText: v.string(),
    scope: v.union(
      v.object({ type: v.literal("section") }),
      v.object({
        type: v.literal("group"),
        groupId: v.id("paperGroups"),
      }),
      v.object({ type: v.literal("all") })
    ),
    provider: v.optional(v.string()),
    language: v.optional(v.union(v.literal("en"), v.literal("de"))),
    fallbackLanguage: v.optional(
      v.union(v.literal("en"), v.literal("de"))
    ),
  },
  handler: async (ctx, args) => {
    const provider = args.provider ?? "anthropic";
    const fallback = args.fallbackLanguage ?? "en";

    const selectionText = args.selectionText.trim();
    const paragraphText = args.paragraphText.trim();
    const lowContext =
      selectionText.length < LOW_SELECTION_CHAR_THRESHOLD;

    // Determine candidate paperIds based on scope.
    const allPapers = await ctx.runQuery(api.papers.listPapers);
    const completedById = new Map<string, (typeof allPapers)[number]>();
    for (const p of allPapers) {
      if (p.status !== "completed") continue;
      completedById.set(p._id as string, p);
    }

    let scopedPaperIds: Set<string>;
    if (args.scope.type === "section") {
      const existingMatches = await ctx.runQuery(
        api.matches.getMatchesBySection,
        { sectionId: args.sectionId }
      );
      scopedPaperIds = new Set(
        (existingMatches ?? []).map((m: any) => m.paperId as string)
      );
    } else if (args.scope.type === "group") {
      const memberships = await ctx.runQuery(api.groups.listAllMemberships);
      const groupId = args.scope.groupId as string;
      scopedPaperIds = new Set(
        memberships
          .filter((m: any) => (m.groupId as string) === groupId)
          .map((m: any) => m.paperId as string)
      );
    } else {
      scopedPaperIds = new Set(completedById.keys());
    }

    // Build candidates from the scoped pool. Skip papers without summaries —
    // they have no signal for the recommender — and report them as excluded.
    const candidates: PaperPayload[] = [];
    const titleByPaper = new Map<string, { title: string; authors: string[]; year?: number }>();
    const excluded: { paperId: string; reason: "no-summary" }[] = [];

    for (const pid of scopedPaperIds) {
      const paper = completedById.get(pid);
      if (!paper) continue;

      const summary = await ctx.runQuery(api.summaries.getSummaryByPaper, {
        paperId: paper._id,
      });
      if (!summary) {
        excluded.push({ paperId: pid, reason: "no-summary" });
        continue;
      }

      candidates.push({
        paperId: pid,
        title: paper.title ?? "",
        authors: paper.authors ?? [],
        year: paper.year ?? undefined,
        summary: {
          researchQuestion: summary.researchQuestion ?? "",
          methodology: summary.methodology ?? "",
          keyFindings: summary.keyFindings ?? [],
          keywords: summary.keywords ?? [],
        },
      });
      titleByPaper.set(pid, {
        title: paper.title ?? "",
        authors: paper.authors ?? [],
        year: paper.year ?? undefined,
      });
    }

    const language =
      args.language ?? detectLanguage(paragraphText || selectionText, fallback);

    if (candidates.length === 0) {
      return {
        recommendations: [] as EnrichedRecommendation[],
        lowContext,
        language,
        excluded,
      };
    }

    let response: Response;
    try {
      response = await fetch(`${PYTHON_URL}/recommend-papers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Discriminator the Python service uses to swap the prompt template.
          // Older Python builds that ignore `mode` and only read `inputText`
          // still get a usable result because we still send `body`/`notes` —
          // the selection text doubles as the body for fallback.
          mode: "selection",
          inputText: {
            title: "",
            body: selectionText,
            notes: paragraphText,
            selectionText,
            paragraphText,
          },
          papers: candidates,
          language,
          provider,
        }),
      });
    } catch (err) {
      console.error("[recommendations] selection fetch failed:", err);
      throw new Error("Recommendation service unreachable");
    }

    if (!response.ok) {
      console.error(
        "[recommendations] selection non-OK:",
        response.status,
        await response.text().catch(() => "")
      );
      throw new Error(`Recommendation service returned ${response.status}`);
    }

    const body_json = (await response.json()) as {
      recommendations: RecommendationRow[];
      lowContext?: boolean;
    };

    const enriched: EnrichedRecommendation[] = [];
    for (const r of body_json.recommendations ?? []) {
      const meta = titleByPaper.get(r.paperId);
      if (!meta) continue;
      enriched.push({
        paperId: r.paperId,
        score: r.score,
        reasoning: r.reasoning,
        title: meta.title,
        authors: meta.authors,
        year: meta.year,
      });
    }

    return {
      recommendations: enriched,
      // Trust the local check first — the Python service may not understand
      // selection-mode and might return its section-mode lowContext flag.
      lowContext: lowContext || (body_json.lowContext ?? false),
      language,
      excluded,
    };
  },
});
