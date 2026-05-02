import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { Check, Loader2, Sparkles, GraduationCap, Feather, Maximize2, X, Sigma, Settings2, Wand2, Compass, MessageCircleQuestion, Eraser, Square, Quote } from "lucide-react";
import CitationPicker from "./CitationPicker";
import HighlightCitationPopover, { type FindCiteScope } from "./HighlightCitationPopover";
import SectionPromptEditor from "./SectionPromptEditor";
import FormulaPreviewPanel from "./FormulaPreviewPanel";
import FigurePanel from "./FigurePanel";
import GenerateSectionPopover from "./GenerateSectionPopover";
import CitationRecommendSheet from "./CitationRecommendSheet";
import PendingCitationPopover, { type AnchorRect, type CandidatePaperMeta } from "./PendingCitationPopover";
import SectionTodoPanel from "./SectionTodoPanel";
import {
  extractCitationIds,
  insertCitationMarker,
  buildCitationMarker,
  getAtTriggerContext,
  buildFootnotes,
  renderFootnoteText,
  formatBibliographyEntry,
  parsePendingCitations,
  extractPendingPlaceholderIds,
  replacePendingMarker,
  stripAllPendingMarkers,
  stripCitationMarkers,
  extractEnclosingParagraph,
  computeInsertPos,
} from "@/lib/citationUtils";
import { useDetectCitations } from "@/hooks/useDetectCitations";
import { useValidateCitations, type ValidateResult } from "@/hooks/useValidateCitations";
import { extractFormulasForPreview, insertFormulaMarker } from "@/lib/formulaUtils";
import { insertFigureMarker } from "@/lib/figureUtils";
import {
  rawTextToDecoratedHtml,
  decoratedDomToRawText,
  getCaretOffsetInRawText,
  setCaretFromRawTextOffset,
  setSelectionRangeFromRawTextOffsets,
  getCaretPixelPosition,
  getSelectionRangeInRawText,
} from "@/lib/contentEditableUtils";
import { useTextOptimize } from "@/hooks/useTextOptimize";
import {
  openAIToastProgress,
  type AIToastProgressHandle,
} from "@/components/ai-progress";
import { useBaselinePrompts } from "@/hooks/useBaselinePrompts";
import { resolvePrompt } from "@/lib/promptResolver";
import { useLanguage } from "@/lib/LanguageContext";
import { useProvider } from "@/lib/ProviderContext";
import type { ActiveSection, CitationType, OptimizeMode, AiPromptSettingsByLang, AiPromptOverridesByLang, CitationRecommendation, GroupId, PaperId } from "@/lib/types";
import "katex/dist/katex.min.css";
import type { Doc, Id } from "../../convex/_generated/dataModel";

/// Debounce delay in ms before auto-saving content.
const SAVE_DEBOUNCE_MS = 1500;

/// Extracts the first integer it can find in a free-form page string. Used to
/// reconcile citation `pageRef` ("p.1", "S. 12 f.", "12-15", "S.12ff.") with
/// the structured `pageNumber` stored on excerpts ("12", "~3"). Returns null
/// when no digits are present so callers can fall back to "show all" mode.
function firstPageNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const match = /\d+/.exec(raw);
  return match ? Number(match[0]) : null;
}

interface SectionWriteEditorProps {
  activeSection: ActiveSection;
}

/// Main write-mode editor for composing thesis text with HKA-style footnote
/// citations. Uses a contentEditable div that renders citation markers as
/// superscript numbers inline, with @-triggered citation picker, debounced
/// auto-save to Convex, and a footnote panel below the editor.
export default function SectionWriteEditor({
  activeSection,
}: SectionWriteEditorProps) {
  const { t } = useTranslation();
  const { sectionId } = activeSection;

  // ── Data queries ──────────────────────────────────────────────────────
  const content = useQuery(api.sectionContent.getSectionContent, { sectionId });
  const matches =
    useQuery(api.matches.getMatchesBySection, { sectionId }) ?? [];
  const saveMutation = useMutation(api.sectionContent.saveSectionContent);

  // ── AI prompt customization queries ───────────────────────────────────
  const metadata = useQuery(api.thesisMetadata.getMetadata);
  const { baselines } = useBaselinePrompts();
  const updatePromptOverrides = useMutation(api.sectionContent.updateAiPromptOverrides);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  /// Open state for the AI section-writer popover (toolbar Generate button).
  const [generatePopoverOpen, setGeneratePopoverOpen] = useState(false);
  /// Open state for the smart paper recommendation sheet.
  const [recommendSheetOpen, setRecommendSheetOpen] = useState(false);

  // ── Local state ───────────────────────────────────────────────────────
  const [body, setBody] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle"
  );

  // Text selection state for optimize toolbar
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Language context for AI optimization
  const { language } = useLanguage();
  const { provider } = useProvider();

  /// Resolves the custom prompt for a given mode at request time,
  /// applying the two-tier override chain: baseline → global → section.
  const getCustomPrompt = useCallback(
    (mode: OptimizeMode): string | undefined => {
      return resolvePrompt(
        mode,
        language,
        baselines,
        metadata?.aiPromptSettings as AiPromptSettingsByLang | undefined,
        content?.aiPromptOverrides as AiPromptOverridesByLang | undefined,
      );
    },
    [baselines, language, metadata?.aiPromptSettings, content?.aiPromptOverrides]
  );

  // AI text optimization hook
  const {
    state: optimizeState,
    requestOptimize,
    acceptOptimize,
    discardOptimize,
    cancelOptimize,
  } = useTextOptimize(body, language, provider, getCustomPrompt);

  /// Holds the live Sonner toast handle while an optimize call is in
  /// flight. The toast surfaces a Stop button so the user can abort the
  /// AI call from anywhere on the page even after the selection toolbar
  /// collapses on click.
  const optimizeToastRef = useRef<AIToastProgressHandle | null>(null);

  /// Open / dismiss the optimize toast in lockstep with hook status.
  /// Effect runs whenever the status changes — `loading` opens the
  /// toast, every other state dismisses it.
  useEffect(() => {
    if (optimizeState.status === "loading") {
      // Ignore if a toast is already on screen for the current run.
      if (optimizeToastRef.current) return;
      optimizeToastRef.current = openAIToastProgress({
        label: t("optimize.optimizingToast"),
        stopLabel: t("optimize.stop"),
        onStop: () => {
          cancelOptimize();
        },
      });
    } else {
      optimizeToastRef.current?.dismiss();
      optimizeToastRef.current = null;
    }
    // No cleanup return — dismissal is handled by the next status
    // transition (idle / preview / error / cancelled). On unmount,
    // sonner cleans up its own portal.
  }, [optimizeState.status, t, cancelOptimize]);

  // Citation picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerStartPos, setPickerStartPos] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState({ top: 0, left: 0 });
  /// PaperId preselected for the picker via the highlight-to-cite flow.
  /// When non-null, the picker skips Stage 1 and jumps to Stage 2.
  const [pickerInitialPaperId, setPickerInitialPaperId] = useState<
    string | null
  >(null);
  /// Forces `handleCitationSelect` to insert at this offset instead of the
  /// caret/atStartPos. Set by the highlight-to-cite flow so the marker lands
  /// at the end of the selection rather than at the cursor.
  const [forcedInsertPos, setForcedInsertPos] = useState<number | null>(null);

  // ── Highlight-to-cite popover state ──────────────────────────────────
  const [findCiteOpen, setFindCiteOpen] = useState(false);
  const [findCiteScope, setFindCiteScope] = useState<FindCiteScope>({
    type: "section",
  });
  const [findCiteResults, setFindCiteResults] = useState<
    CitationRecommendation[] | null
  >(null);
  const [findCiteExcluded, setFindCiteExcluded] = useState<
    { paperId: PaperId; reason: "no-summary" }[]
  >([]);
  const [findCiteLoading, setFindCiteLoading] = useState(false);
  const [findCiteLowContext, setFindCiteLowContext] = useState(false);
  const [findCiteAnchor, setFindCiteAnchor] = useState({ top: 0, left: 0 });
  /// Snapshot of the selection at the moment the popover opened. Tracking it
  /// separately from `selection` means the user can click around inside the
  /// popover (which collapses the selection) without losing the insert target.
  const [findCiteSelection, setFindCiteSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  /// Counter used to discard stale recommendation results when the user
  /// re-highlights / re-runs while a request is in flight.
  const findCiteRequestIdRef = useRef(0);

  // Convex action handle for the highlight-to-cite recommender.
  const recommendForSelection = useAction(
    api.recommendations.recommendForSelection
  );
  // Mutation used to ensure a chosen paper is linked to the section before
  // we hand off to CitationPicker Stage 2 — Stage 2 reads from `matches`.
  const addMatchMutation = useMutation(api.matches.addMatch);
  // Group list for the popover's group dropdown. Reactive — new groups show
  // up automatically without reopening the popover.
  const availableGroups = useQuery(api.groups.listGroups) ?? [];

  // Refs
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /// Tracks the sectionId at save-invocation time to prevent cross-section writes.
  const sectionIdRef = useRef(sectionId);
  /// Tracks the last body sent to Convex so we don't overwrite local state
  /// when the reactive query pushes back the server version.
  const lastSavedBodyRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  /// Tracks the last body rendered into the contentEditable div to avoid
  /// re-rendering on every keystroke (only re-render when markers change).
  const lastRenderedBodyRef = useRef("");
  /// Suppresses re-render during IME composition (e.g. Chinese/Japanese input).
  const composingRef = useRef(false);
  /// Suppresses external re-render while the user is actively typing.
  const isTypingRef = useRef(false);

  // Keep refs current
  useEffect(() => {
    sectionIdRef.current = sectionId;
  }, [sectionId]);

  // ── Source queries for footnote rendering ─────────────────────────────
  /// Build a source map from cited paper IDs for footnote generation.
  const citedPaperIds = useMemo(() => extractCitationIds(body), [body]);

  // Query sources for all cited papers — we need their Kürzel for footnotes.
  // Note: Convex queries are reactive, so this updates automatically.
  const allSources = useQuery(api.sources.listAllSources) ?? [];
  const createSource = useMutation(api.sources.createSource);
  /// Persists user-entered cited passages from the @-picker into the
  /// matchExcerpts table so the footnote panel can render them under the
  /// matching footnote (auto-matched by paperId + page).
  const addExcerptMutation = useMutation(api.matches.addExcerpt);

  const sourceMap = useMemo(() => {
    const map = new Map<string, Doc<"sources">>();
    for (const source of allSources) {
      map.set(source.paperId, source);
    }
    return map;
  }, [allSources]);

  /// Auto-create source records for cited papers that don't have one yet.
  /// Handles papers uploaded before the sources table was added.
  const autoCreatedRef = useRef(new Set<string>());
  useEffect(() => {
    for (const id of citedPaperIds) {
      if (!sourceMap.has(id) && !autoCreatedRef.current.has(id)) {
        autoCreatedRef.current.add(id);
        createSource({ paperId: id as any, sourceType: "book" }).catch(() => {
          // Ignore — may already exist from another auto-create
        });
      }
    }
  }, [citedPaperIds, sourceMap, createSource]);

  /// Footnote entries generated from current body text and source data.
  const footnotes = useMemo(
    () => buildFootnotes(body, sourceMap),
    [body, sourceMap]
  );

  /// All excerpts for the papers cited in the current body, regardless of
  /// which section those excerpts were originally collected under. Citations
  /// reference papers, not paper-in-section pairs, so a section-scoped lookup
  /// would hide the relevance-note explanation whenever the cited paper was
  /// matched under a different section.
  const sectionExcerpts =
    useQuery(
      api.matches.getExcerptsByPaperIds,
      citedPaperIds.length > 0
        ? { paperIds: citedPaperIds as Id<"papers">[] }
        : "skip"
    ) ?? [];

  /// Map paperId → excerpts from this section, ordered by orderIndex. Drives
  /// the per-footnote excerpt preview in the FUSSNOTEN panel.
  const excerptsByPaper = useMemo(() => {
    const map = new Map<string, typeof sectionExcerpts>();
    for (const ex of sectionExcerpts) {
      const list = map.get(ex.paperId) ?? [];
      list.push(ex);
      map.set(ex.paperId, list);
    }
    return map;
  }, [sectionExcerpts]);

  /// Unique sources cited in the current section, in first-citation order.
  /// Drives the "Quellen in diesem Abschnitt" panel so the user can see, at a
  /// glance, which paper each Kürzel in the footnote list refers to.
  const citedSourcesInOrder = useMemo(() => {
    const byPaperId = new Map<string, (typeof allSources)[number]>();
    for (const s of allSources) byPaperId.set(s.paperId, s);
    const seen = new Set<string>();
    const out: Array<(typeof allSources)[number]> = [];
    for (const fn of footnotes) {
      if (seen.has(fn.paperId)) continue;
      const src = byPaperId.get(fn.paperId);
      if (!src) continue;
      seen.add(fn.paperId);
      out.push(src);
    }
    return out;
  }, [footnotes, allSources]);

  /// Formula preview entries extracted from body text.
  const formulaEntries = useMemo(
    () => extractFormulasForPreview(body),
    [body]
  );

  // ── Sync from server on mount / section switch ────────────────────────
  useEffect(() => {
    // Reset on section change. We must also clear the contentEditable DOM
    // directly: the body→DOM sync effect bails when `body === lastRenderedBodyRef`,
    // so resetting both to "" would leave the previous section's HTML on
    // screen until the new section's content arrives.
    initializedRef.current = false;
    lastSavedBodyRef.current = null;
    setBody("");
    if (editorRef.current) {
      editorRef.current.innerHTML = "";
    }
    lastRenderedBodyRef.current = "";
    setSaveStatus("idle");
    setPickerOpen(false);
  }, [sectionId]);

  // Sync from server whenever the latest server body differs from what we
  // last saved. Earlier code gated this with `initializedRef` to fire only
  // once per section, but Convex's reactive subscription can deliver an old
  // snapshot before the latest value during reconnects/reloads — gating
  // would lock `body` to the stale value, and the next save would write it
  // back, corrupting other sections via the cleanup path.
  // Don't overwrite while the user is mid-keystroke — `handleInput`'s
  // `setBody` is the source of truth then.
  useEffect(() => {
    if (content === undefined) return;
    if (isTypingRef.current || composingRef.current) return;
    const serverBody = content?.body ?? "";
    if (serverBody === lastSavedBodyRef.current) {
      initializedRef.current = true;
      return;
    }
    setBody(serverBody);
    lastSavedBodyRef.current = serverBody;
    initializedRef.current = true;

    // Hydrate the in-memory suggestion cache from the persisted column so
    // chip popovers retain their candidate list across page refreshes.
    pendingSuggestionsRef.current.clear();
    for (const p of content?.pendingCitations ?? []) {
      pendingSuggestionsRef.current.set(p.id, (p.suggestedPaperIds ?? []) as unknown as string[]);
    }
  }, [content, sectionId]);

  // ── Render body into contentEditable when body changes externally ─────
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // Skip re-render if the user is actively typing or composing IME
    if (isTypingRef.current || composingRef.current) return;
    // Only re-render if the body actually changed from what's displayed
    if (body === lastRenderedBodyRef.current) return;

    const html = rawTextToDecoratedHtml(body, sourceMap);
    editor.innerHTML = html;
    // Strip stray <br> / empty <div> blocks at both ends.
    // - Trailing: browsers auto-insert a caret-landing block into any
    //   contentEditable, which on the next serialization round-trips as an
    //   extra newline at the end of the saved body.
    // - Leading: existing bodies in the DB may have a leading "\n" baked in
    //   from a past serialization bug; without stripping it here the user
    //   sees a permanent blank first line above the real content.
    const isEmptyBlock = (n: ChildNode | null): n is HTMLElement =>
      n instanceof HTMLBRElement ||
      (n instanceof HTMLDivElement &&
        (n.childNodes.length === 0 ||
          (n.childNodes.length === 1 && n.firstChild instanceof HTMLBRElement)));
    while (isEmptyBlock(editor.firstChild)) editor.firstChild!.remove();
    while (isEmptyBlock(editor.lastChild)) editor.lastChild!.remove();
    lastRenderedBodyRef.current = body;
  }, [body, sourceMap]);

  // ── Pending citation cache ────────────────────────────────────────────
  /// Cache of suggested paperIds per `{{citeNeeded:...}}` placeholder.
  /// Truth lives in `body`; this map is rebuilt from detect responses
  /// and kept in sync with the body via `extractPendingPlaceholderIds`
  /// so deleted chips drop their suggestions automatically.
  const pendingSuggestionsRef = useRef<Map<string, string[]>>(new Map());

  // ── Debounced auto-save ───────────────────────────────────────────────
  const flushSave = useCallback(
    async (bodyToSave: string, targetSectionId: string) => {
      // Guard: don't save if section changed since the timer was set
      if (targetSectionId !== sectionIdRef.current) return;
      if (bodyToSave === lastSavedBodyRef.current) return;

      setSaveStatus("saving");
      try {
        const citedIds = extractCitationIds(bodyToSave);
        // Keep the pendingCitations cache aligned with the body before
        // shipping it to Convex. Drop any suggestion whose chip has been
        // deleted by the user; the cascade in saveSectionContent does the
        // mirror cleanup on the auto-citation TODO rows.
        const livePending = parsePendingCitations(bodyToSave);
        const pendingPayload = livePending.map((p) => ({
          id: p.id,
          reason: p.reason,
          suggestedPaperIds: (pendingSuggestionsRef.current.get(p.id) ?? []) as any,
        }));

        await saveMutation({
          sectionId: targetSectionId as any,
          body: bodyToSave,
          citedPaperIds: citedIds as any,
          pendingCitations: pendingPayload as any,
        });
        // Drop entries whose chip is gone so the cache doesn't grow unbounded.
        const liveIds = new Set(livePending.map((p) => p.id));
        for (const cachedId of Array.from(pendingSuggestionsRef.current.keys())) {
          if (!liveIds.has(cachedId)) pendingSuggestionsRef.current.delete(cachedId);
        }
        lastSavedBodyRef.current = bodyToSave;
        // Only show "saved" if we're still on the same section
        if (sectionIdRef.current === targetSectionId) {
          setSaveStatus("saved");
          setTimeout(() => {
            if (sectionIdRef.current === targetSectionId) {
              setSaveStatus("idle");
            }
          }, 2000);
        }
      } catch (err) {
        console.error("[WRITE] Save failed:", err);
        setSaveStatus("idle");
      }
    },
    [saveMutation]
  );

  const scheduleSave = useCallback(
    (newBody: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const targetId = sectionIdRef.current;
      saveTimerRef.current = setTimeout(() => {
        flushSave(newBody, targetId);
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave]
  );

  // Cancel any pending debounced save on section switch / unmount.
  // We deliberately do NOT flush-on-unmount: the captured body and sectionId
  // can disagree under StrictMode double-effects and HMR remounts, which
  // caused section A's body to be written into section B's row. Any in-flight
  // user-typed change has already been scheduled via scheduleSave and will
  // hit the server unless the user navigates within SAVE_DEBOUNCE_MS.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [sectionId]);

  // ── ContentEditable input handler ─────────────────────────────────────
  /// Extracts raw text from the contentEditable DOM on every input event,
  /// updates body state, and checks for @-trigger.
  const handleInput = useCallback(() => {
    if (composingRef.current) return; // Don't process during IME composition

    const editor = editorRef.current;
    if (!editor) return;

    isTypingRef.current = true;
    const newRawText = decoratedDomToRawText(editor);
    setBody(newRawText);
    lastRenderedBodyRef.current = newRawText;
    scheduleSave(newRawText);

    // Check for @ trigger
    const cursorPos = getCaretOffsetInRawText(editor);
    if (cursorPos >= 0) {
      const ctx = getAtTriggerContext(newRawText, cursorPos);
      if (ctx) {
        setPickerQuery(ctx.query);
        setPickerStartPos(ctx.startPos);
        if (!pickerOpen) {
          const coords = getCaretPixelPosition(editor);
          setPickerAnchor(coords);
          setPickerOpen(true);
        }
      } else {
        setPickerOpen(false);
      }
    }

    // Reset typing flag after React has had time to process the state update.
    // Using setTimeout ensures the re-render effect (which checks isTypingRef)
    // doesn't fight with the user's input during the same frame.
    setTimeout(() => {
      isTypingRef.current = false;
    }, 50);
  }, [scheduleSave, pickerOpen]);

  // ── Selection tracking (click / arrow keys) ───────────────────────────
  const handleSelect = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const cursorPos = getCaretOffsetInRawText(editor);
    if (cursorPos >= 0) {
      const ctx = getAtTriggerContext(body, cursorPos);
      if (ctx) {
        setPickerQuery(ctx.query);
        setPickerStartPos(ctx.startPos);
        if (!pickerOpen) {
          const coords = getCaretPixelPosition(editor);
          setPickerAnchor(coords);
          setPickerOpen(true);
        }
      } else {
        setPickerOpen(false);
      }
    }

    // Track selection for optimize buttons (only when not in a preview state).
    if (optimizeState.status === "idle") {
      const range = getSelectionRangeInRawText(editor);
      if (range) {
        setSelection((prev) =>
          prev && prev.start === range.start && prev.end === range.end
            ? prev
            : range
        );
      } else {
        setSelection((prev) => (prev === null ? prev : null));
      }
    }
  }, [body, pickerOpen, optimizeState.status]);

  // ── Helper: re-render editor HTML and restore caret ───────────────────
  const rerenderEditor = useCallback(
    (newBody: string, caretOffset: number) => {
      const editor = editorRef.current;
      if (!editor) return;

      const html = rawTextToDecoratedHtml(newBody, sourceMap);
      editor.innerHTML = html;
      lastRenderedBodyRef.current = newBody;

      requestAnimationFrame(() => {
        // Re-read ref in case the component unmounted during the RAF delay
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        try {
          setCaretFromRawTextOffset(el, Math.min(caretOffset, newBody.length));
        } catch {
          // Fallback: place caret at end
        }
      });
    },
    [sourceMap]
  );

  // ── Helper: undoable full re-render via execCommand ──────────────────
  /// Like `rerenderEditor`, but issues the swap through
  /// `document.execCommand("insertHTML", …)` so the change is recorded as a
  /// single step in the browser's native undo stack. Used by single-action
  /// user edits (citation insert / pending-marker resolve) so Cmd+Z reverts
  /// the marker. Returns `true` on success; the caller falls back to
  /// `rerenderEditor` when the command isn't available (e.g. in JSDOM tests
  /// or environments where `execCommand` is disabled).
  const rerenderEditorUndoable = useCallback(
    (newBody: string, caretOffset: number): boolean => {
      const editor = editorRef.current;
      if (!editor) return false;

      // execCommand requires the editor to be the active element so that the
      // current selection lives inside it.
      editor.focus();

      // Select the entire editor contents in raw-text terms. The existing body
      // length is derived from the live DOM so the selection is correct even
      // if React state has lagged behind the user's keystrokes.
      const liveLen = decoratedDomToRawText(editor).length;
      const selected = setSelectionRangeFromRawTextOffsets(editor, 0, liveLen);
      if (!selected) return false;

      const html = rawTextToDecoratedHtml(newBody, sourceMap);
      let ok = false;
      try {
        ok = document.execCommand("insertHTML", false, html);
      } catch {
        ok = false;
      }
      if (!ok) return false;

      // Trust the DOM that execCommand just produced as the rendered state so
      // the [body, sourceMap] effect doesn't re-paint and clobber undo.
      lastRenderedBodyRef.current = newBody;

      requestAnimationFrame(() => {
        const el = editorRef.current;
        if (!el) return;
        try {
          setCaretFromRawTextOffset(el, Math.min(caretOffset, newBody.length));
        } catch {
          // Fallback: leave caret where insertHTML parked it.
        }
      });
      return true;
    },
    [sourceMap]
  );

  // ── Citation selection ────────────────────────────────────────────────
  /// Handles the completed citation picker flow: paper + type + page ref +
  /// optional excerpt. Inserts the marker into the body and (when an excerpt
  /// was provided) persists it via `addExcerpt` so the footnote panel can
  /// render the cited passage alongside AI-generated excerpts. Excerpt
  /// persistence is fire-and-forget — a failure here doesn't block the
  /// in-body marker from being saved.
  const handleCitationSelect = useCallback(
    (
      paperId: string,
      citationType: CitationType,
      pageRef: string,
      secondaryPaperId?: string,
      secondaryPageRef?: string,
      excerptText?: string
    ) => {
      const editor = editorRef.current;
      if (!editor) return;

      // Always derive the body from the live DOM rather than React's `body`
      // state. `setBody` is async; if the user types and immediately picks a
      // citation result, the closure still holds the pre-keystroke body and
      // would silently drop the freshly-typed text on insert.
      const liveBody = decoratedDomToRawText(editor);

      // Highlight-to-cite flow forces the insertion offset so the marker lands
      // after the selection instead of at the caret. Otherwise we use the
      // existing @-trigger range (atStart..end-of-query).
      const insertStart =
        forcedInsertPos !== null ? forcedInsertPos : pickerStartPos;
      // The end of the @-query span is `pickerStartPos + 1 + pickerQuery.length`
      // (1 for the "@" itself). DO NOT fall back to `cursorPos` or
      // `liveBody.length`: by the time the picker fires `onSelect`, focus has
      // moved into the picker's Stage 2 inputs and the editor's selection is
      // gone. `getCaretOffsetInRawText` would return -1 and a `liveBody.length`
      // fallback would delete every character after the "@" — which is exactly
      // the "text after the citation vanishes" bug. The query length is kept
      // in sync by `handleInput` on every keystroke, so it's always current.
      const queryEnd = pickerStartPos + 1 + pickerQuery.length;
      const insertEnd =
        forcedInsertPos !== null ? forcedInsertPos : queryEnd;
      const { newBody, newCursorPos } = insertCitationMarker(
        liveBody,
        insertStart,
        insertEnd,
        paperId,
        citationType,
        pageRef,
        secondaryPaperId,
        secondaryPageRef
      );

      setBody(newBody);
      setPickerOpen(false);
      // Reset the highlight-to-cite handoff state so subsequent @-picker uses
      // are not contaminated by a stale forced-insert offset.
      setForcedInsertPos(null);
      setPickerInitialPaperId(null);
      scheduleSave(newBody);
      // Prefer the undoable path so Cmd+Z rolls the marker back. Fall back to
      // the destructive innerHTML rerender when execCommand is unavailable
      // (e.g. older browsers or test environments).
      if (!rerenderEditorUndoable(newBody, newCursorPos)) {
        rerenderEditor(newBody, newCursorPos);
      }

      const trimmedExcerpt = excerptText?.trim();
      if (trimmedExcerpt) {
        // Use the same first-integer heuristic the footnote renderer uses
        // (`firstPageNumber`) so the new excerpt automatically surfaces
        // under the matching footnote without needing an explicit join id.
        const pageDigits = pageRef.match(/\d+/)?.[0];
        addExcerptMutation({
          paperId: paperId as Id<"papers">,
          sectionId: sectionId as Id<"outlineSections">,
          excerptText: trimmedExcerpt,
          relevanceNote: "",
          pageNumber: pageDigits ?? pageRef,
        }).catch((err: unknown) => {
          console.error("[citation] failed to persist self-cite excerpt", err);
        });
      }
    },
    [
      pickerStartPos,
      pickerQuery,
      forcedInsertPos,
      scheduleSave,
      rerenderEditor,
      rerenderEditorUndoable,
      sectionId,
      addExcerptMutation,
    ]
  );

  // ── Highlight-to-cite handlers ─────────────────────────────────────────
  /// Runs the recommender for the current selection under the given scope.
  /// Stale-response guard: each call increments the request id and only the
  /// most recent response is allowed to update state.
  const runFindCitation = useCallback(
    async (
      sel: { start: number; end: number },
      scope: FindCiteScope,
      currentBody: string
    ) => {
      const rawSelection = currentBody.slice(sel.start, sel.end);
      const selectionText = stripCitationMarkers(rawSelection);
      const para = extractEnclosingParagraph(currentBody, sel.start, sel.end);
      const paragraphText = stripCitationMarkers(para.text);

      findCiteRequestIdRef.current += 1;
      const requestId = findCiteRequestIdRef.current;
      setFindCiteLoading(true);
      setFindCiteResults(null);
      setFindCiteExcluded([]);
      setFindCiteLowContext(false);

      try {
        const scopeArg =
          scope.type === "group"
            ? { type: "group" as const, groupId: scope.groupId }
            : scope.type === "section"
              ? { type: "section" as const }
              : { type: "all" as const };
        const result = await recommendForSelection({
          sectionId,
          selectionText,
          paragraphText,
          scope: scopeArg,
          provider,
          language,
        });
        // Drop the result if a newer request has been issued.
        if (requestId !== findCiteRequestIdRef.current) return;
        // The action returns `paperId: string`; the UI type uses the branded
        // `PaperId`. They wire-encode identically — cast through `unknown`
        // to satisfy the structural check.
        setFindCiteResults(
          result.recommendations as unknown as CitationRecommendation[]
        );
        setFindCiteExcluded(
          (result.excluded ?? []) as { paperId: PaperId; reason: "no-summary" }[]
        );
        setFindCiteLowContext(result.lowContext);
      } catch (err) {
        if (requestId !== findCiteRequestIdRef.current) return;
        console.error("[findCitation] failed:", err);
        toast.error(
          t("findCitation.errorToast", "Recommendation request failed")
        );
        setFindCiteResults([]);
      } finally {
        if (requestId === findCiteRequestIdRef.current) {
          setFindCiteLoading(false);
        }
      }
    },
    [recommendForSelection, sectionId, provider, language, t]
  );

  /// Click handler for the new "Find citation" toolbar pill. Captures the
  /// selection, opens the popover anchored to the editor selection, and kicks
  /// off the first recommendation request.
  const handleFindCitation = useCallback(() => {
    if (!selection || selection.start === selection.end) return;
    const editor = editorRef.current;
    if (!editor) return;

    const anchor = getCaretPixelPosition(editor);
    setFindCiteAnchor(anchor);
    setFindCiteSelection({ start: selection.start, end: selection.end });
    setFindCiteScope({ type: "section" });
    setFindCiteOpen(true);
    void runFindCitation(selection, { type: "section" }, body);
  }, [selection, body, runFindCitation]);

  /// Scope change handler. Re-runs the recommender against the captured
  /// selection — never the live `selection` state, which may have collapsed
  /// when the user clicked into the popover.
  const handleFindCiteScopeChange = useCallback(
    (next: FindCiteScope) => {
      setFindCiteScope(next);
      if (!findCiteSelection) return;
      void runFindCitation(findCiteSelection, next, body);
    },
    [findCiteSelection, body, runFindCitation]
  );

  /// User picked a paper from the recommender results. Ensures the paper is
  /// linked to the section (so CitationPicker Stage 2 can render it), wires
  /// up the forced insertion offset, and opens the picker preselected.
  const handleFindCitePick = useCallback(
    async (paperId: PaperId) => {
      if (!findCiteSelection) return;

      // Idempotently link the paper to the section. `addMatch` upserts based
      // on (paperId, sectionId), so a no-op when the paper is already linked.
      try {
        await addMatchMutation({
          paperId,
          sectionId: sectionId as Id<"outlineSections">,
          // 0.5 is a neutral score; the picker doesn't display it. Manual
          // inserts elsewhere use the same convention.
          relevanceScore: 0.5,
        });
      } catch (err) {
        console.error("[findCitation] addMatch failed:", err);
        toast.error(
          t("findCitation.addMatchFailed", "Failed to link paper to section")
        );
        return;
      }

      // Read the body off the live DOM rather than the closure-captured
      // `body` state — same lag-by-a-render hazard as `handleCitationSelect`.
      // The selection offset must be measured against whatever the user
      // actually has on screen, not whatever React last committed.
      const editor = editorRef.current;
      const liveBody = editor ? decoratedDomToRawText(editor) : "";
      const insertOffset = computeInsertPos(liveBody, findCiteSelection.end);
      setForcedInsertPos(insertOffset);
      setPickerInitialPaperId(paperId);
      // Re-anchor the picker to the selection's end position so it doesn't
      // float at the caret (which may be elsewhere by now).
      setPickerAnchor(findCiteAnchor);
      setPickerOpen(true);

      // Close the recommendation popover; the picker takes over.
      setFindCiteOpen(false);
      setFindCiteResults(null);
    },
    [
      findCiteSelection,
      addMatchMutation,
      sectionId,
      findCiteAnchor,
      t,
    ]
  );

  /// Dismisses the highlight-to-cite popover without inserting anything.
  const handleFindCiteDismiss = useCallback(() => {
    setFindCiteOpen(false);
    setFindCiteResults(null);
    findCiteRequestIdRef.current += 1; // Invalidate any in-flight request
  }, []);

  // Handle keyboard events for picker navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!pickerOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerOpen(false);
      }
      // ArrowUp, ArrowDown, Enter are handled by the CitationPicker itself
      if (["ArrowUp", "ArrowDown", "Enter"].includes(e.key)) {
        e.preventDefault();
      }
    },
    [pickerOpen]
  );

  // ── Paste handler — strip HTML, insert plain text only ────────────────
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;

      const editor = editorRef.current;
      if (!editor) return;

      // Replace selected text (if any) or insert at caret position
      const selRange = getSelectionRangeInRawText(editor);
      let start: number;
      let end: number;
      if (selRange) {
        start = selRange.start;
        end = selRange.end;
      } else {
        const cursorPos = getCaretOffsetInRawText(editor);
        start = cursorPos >= 0 ? cursorPos : body.length;
        end = start;
      }
      const before = body.slice(0, start);
      const after = body.slice(end);
      const newBody = before + text + after;
      const newCursorPos = start + text.length;

      setBody(newBody);
      scheduleSave(newBody);
      rerenderEditor(newBody, newCursorPos);
    },
    [body, scheduleSave, rerenderEditor]
  );

  // ── IME composition handlers ──────────────────────────────────────────
  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    // Process the input now that composition is complete
    handleInput();
  }, [handleInput]);

  // ── Optimize mode config ────────────────────────────────────────────
  const optimizeModes: {
    mode: OptimizeMode;
    icon: typeof Sparkles;
    label: string;
    gerund: string;
  }[] = [
    { mode: "enhance", icon: Sparkles, label: t("optimize.enhance"), gerund: t("optimize.enhancing") },
    { mode: "formalize", icon: GraduationCap, label: t("optimize.formalize"), gerund: t("optimize.formalizing") },
    { mode: "simplify", icon: Feather, label: t("optimize.simplify"), gerund: t("optimize.simplifying") },
    { mode: "expand", icon: Maximize2, label: t("optimize.expand"), gerund: t("optimize.expanding") },
  ];

  /// Handles accepting the AI-optimized text and updating the editor body.
  const handleAcceptOptimize = useCallback(() => {
    const { newBody } = acceptOptimize();
    setBody(newBody);
    scheduleSave(newBody);
    setSelection(null);
    // Force re-render of the contentEditable with the new body
    rerenderEditor(newBody, newBody.length);
  }, [acceptOptimize, scheduleSave, rerenderEditor]);

  /// Handles discarding the optimize preview.
  const handleDiscardOptimize = useCallback(() => {
    discardOptimize();
    setSelection(null);
  }, [discardOptimize]);

  /// Adopts a body produced by the section-writer popover.
  ///
  /// The popover already decided whether the user picked Replace or
  /// Append (it has the existing body) and hands us the final string.
  /// We just splice it into local state, schedule the autosave, and
  /// force the contentEditable to re-render so footnote markers show
  /// up immediately.
  const handleGeneratedInsert = useCallback(
    (newBody: string) => {
      setBody(newBody);
      scheduleSave(newBody);
      rerenderEditor(newBody, newBody.length);
    },
    [scheduleSave, rerenderEditor]
  );

  /// Inserts a display formula template ($$  $$) at the current cursor position.
  const handleInsertFormula = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const cursorPos = getCaretOffsetInRawText(editor);
    const pos = cursorPos >= 0 ? cursorPos : body.length;
    const { newBody, newCursorPos } = insertFormulaMarker(
      body, pos, "  ", true
    );
    setBody(newBody);
    scheduleSave(newBody);

    // Place cursor between the $$ delimiters (on the space)
    const innerPos = newCursorPos - 3;
    rerenderEditor(newBody, innerPos);
  }, [body, scheduleSave, rerenderEditor]);

  /// Inserts a figure marker at the current cursor position.
  const handleInsertFigureMarker = useCallback(
    (figureId: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      const cursorPos = getCaretOffsetInRawText(editor);
      const pos = cursorPos >= 0 ? cursorPos : body.length;
      const { newBody, newCursorPos } = insertFigureMarker(
        body, pos, figureId
      );
      setBody(newBody);
      scheduleSave(newBody);
      rerenderEditor(newBody, newCursorPos);
    },
    [body, scheduleSave, rerenderEditor]
  );

  // ── Auto-citation phase A (detect) and phase B (validate) ─────────────
  const detect = useDetectCitations({ sectionId, provider });
  const validate = useValidateCitations({ sectionId, provider });

  /// Validate-phase results keyed by placeholderId. Populated when the
  /// user clicks "Validate & resolve" — the popover reads from here.
  const [validateResults, setValidateResults] = useState<
    Record<string, ValidateResult>
  >({});
  /// Currently-open popover state (null when no chip is active). The
  /// anchor rect is captured at click time so the popover stays in place
  /// even when the editor scrolls underneath it.
  const [popoverState, setPopoverState] = useState<{
    placeholderId: string;
    reason: string;
    anchor: AnchorRect;
  } | null>(null);

  /// Currently-selected footnote number for body↔footnote highlighting.
  /// `null` when nothing is selected. A single number can correspond to
  /// multiple chips in the body (`buildFootnotes` deduplicates by paperId
  /// + page), so the highlight effect targets *all* matching chips.
  const [selectedFootnote, setSelectedFootnote] = useState<number | null>(null);

  /// Applies / clears the citation highlight CSS classes whenever the
  /// selection changes. Touches the contenteditable DOM directly because
  /// the editor body is rendered via `dangerouslySetInnerHTML` (see
  /// `rerenderEditor`), not React children — toggling React state alone
  /// would not reach the chips.
  ///
  /// Re-runs on `body` so a re-render that replaces the DOM (e.g. after
  /// any insertion) re-applies the highlight to the freshly created chips
  /// at the same index.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // Always start by clearing any prior highlight classes — the chip and
    // its enclosing block element are what we touch, plus any footnote
    // row in the panel below.
    const clearAll = () => {
      editor
        .querySelectorAll(".ce-citation--selected")
        .forEach((el) => el.classList.remove("ce-citation--selected"));
      // Paragraph highlights live on ancestors in the contenteditable, so
      // we have to query the whole document — they're scoped by class name.
      document
        .querySelectorAll(".ce-paragraph--selected")
        .forEach((el) => el.classList.remove("ce-paragraph--selected"));
      document
        .querySelectorAll(".ce-footnote--selected")
        .forEach((el) => el.classList.remove("ce-footnote--selected"));
    };

    clearAll();
    if (selectedFootnote === null) return;

    const chips = editor.querySelectorAll<HTMLElement>(".ce-citation");
    const chip = chips[selectedFootnote - 1];
    if (chip) {
      chip.classList.add("ce-citation--selected");
      // Walk up to the nearest block ancestor (paragraph, heading, list
      // item) and tint it. Stop at the editor root so we never decorate
      // unrelated layout containers.
      let node: HTMLElement | null = chip.parentElement;
      const blockTags = new Set([
        "P", "DIV", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6",
      ]);
      while (node && node !== editor) {
        if (blockTags.has(node.tagName)) {
          node.classList.add("ce-paragraph--selected");
          break;
        }
        node = node.parentElement;
      }
    }

    const footnoteRow = document.querySelector<HTMLElement>(
      `[data-footnote-number="${selectedFootnote}"]`
    );
    if (footnoteRow) {
      footnoteRow.classList.add("ce-footnote--selected");
      // Bring it into view if scrolled past — `nearest` so we don't yank
      // the user's scroll position when the row is already visible.
      footnoteRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // Also bring the body chip into view so the user always sees both
    // sides of the link, no matter which one was clicked.
    if (chip) {
      chip.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedFootnote, body]);

  /// Esc clears any active citation highlight. Bound at the document level
  /// so it works whether the focus is in the editor or on a footnote row.
  useEffect(() => {
    if (selectedFootnote === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedFootnote(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedFootnote]);

  /// Number of `{{citeNeeded:...}}` chips currently in the body. Drives
  /// the enabled state of the Validate / Clear buttons.
  const pendingCount = useMemo(
    () => extractPendingPlaceholderIds(body).length,
    [body]
  );

  /// Map of paperId → display metadata used by PendingCitationPopover.
  /// Built from the section's matches so the popover can show Kürzel +
  /// title without an extra query.
  const matchPaperMeta = useMemo<Map<string, CandidatePaperMeta>>(() => {
    const map = new Map<string, CandidatePaperMeta>();
    for (const m of matches) {
      const source = sourceMap.get(m.paperId);
      map.set(m.paperId, {
        paperId: m.paperId,
        title: m.title,
        kuerzel: source?.kuerzel ?? null,
      });
    }
    return map;
  }, [matches, sourceMap]);

  const createTodoMutation = useMutation(api.sectionTodos.create);

  /// Clicks "Auto-cite section". Runs detect, splices yellow chips at the
  /// claim sentences, then flushes the body to Convex through the existing
  /// autosave path. The validate phase stays a separate explicit click so
  /// the user has a chance to dismiss bad detections first.
  const handleAutoCiteDetect = useCallback(async () => {
    const result = await detect.run(body);
    if (!result) {
      // User-initiated cancellation lands silently (no toast); only
      // show the error toast for genuine failures. Read the synchronous
      // ref via wasCancelled() — `status` lags by one render after
      // `await run()` returns and would be unreliable here.
      if (!detect.wasCancelled()) {
        toast.error(detect.error ?? t("optimize.autoCiteDetectError"));
      }
      return;
    }
    if (result.body === body) {
      // Nothing to do — empty body or no items.
      toast.message(
        t("optimize.autoCiteDetectSummary", { count: 0 })
      );
      return;
    }
    // Cache suggested paperIds before flushing so the save sees the right
    // pendingCitations payload.
    for (const pc of result.pendingCitations) {
      pendingSuggestionsRef.current.set(pc.id, pc.suggestedPaperIds as unknown as string[]);
    }
    setBody(result.body);
    rerenderEditor(result.body, result.body.length);
    await flushSave(result.body, sectionIdRef.current);

    toast.success(
      t("optimize.autoCiteDetectSummary", { count: result.insertedCount })
    );
    if (result.unmatchedCount > 0) {
      toast.message(
        t("optimize.autoCiteUnmatched", { count: result.unmatchedCount })
      );
    }
  }, [body, detect, flushSave, rerenderEditor, t]);

  /// Clicks "Validate & resolve". Scores each pending placeholder's
  /// suggested paperIds, swaps high-confidence ones into real
  /// `{{cite:...}}` markers, and creates a sectionTodo for each
  /// remaining unresolved chip.
  const handleAutoCiteValidate = useCallback(async () => {
    const livePending = parsePendingCitations(body);
    const pendingForRun = livePending.map((p) => ({
      id: p.id,
      reason: p.reason,
      suggestedPaperIds: (pendingSuggestionsRef.current.get(p.id) ?? []) as any,
    }));

    const result = await validate.run(body, pendingForRun);
    if (!result) {
      if (!validate.wasCancelled()) {
        toast.error(validate.error ?? t("optimize.autoCiteDetectError"));
      }
      return;
    }

    setValidateResults(result.resultsById);

    if (result.body !== body) {
      setBody(result.body);
      rerenderEditor(result.body, result.body.length);
      await flushSave(result.body, sectionIdRef.current);
    }

    // Create one auto-citation TODO per unresolved placeholder so the
    // drawer surfaces work-remaining without the user opening every chip.
    for (const r of result.unresolved) {
      const reason =
        livePending.find((p) => p.id === r.placeholder_id)?.reason ?? "";
      const text = reason
        ? t("optimize.autoCiteDetectSummary", { count: 0 }) // fallback never used
        : "";
      // Build a clear, locale-agnostic line: "Find citation: <reason>"
      const todoText = reason
        ? `${t("pendingChip.popoverTitle")}: ${reason}`
        : t("pendingChip.popoverTitle");
      // `text` is intentionally unused but constructed above to keep the
      // i18n key list stable; suppress the unused-var lint via void.
      void text;
      await createTodoMutation({
        sectionId,
        text: todoText,
        source: "auto-citation",
        placeholderId: r.placeholder_id,
      });
    }

    toast.success(
      t("optimize.autoCiteDetectSummary", { count: result.promoted.length })
    );
  }, [
    body,
    validate,
    flushSave,
    rerenderEditor,
    createTodoMutation,
    sectionId,
    t,
  ]);

  /// Clicks "Clear pending citations". Strips all `{{citeNeeded:...}}`
  /// markers from the body in one mutation. Resolved citations are left
  /// untouched. The cascade then deletes orphaned auto-citation TODOs.
  const handleClearPending = useCallback(async () => {
    if (pendingCount === 0) return;
    if (!window.confirm(t("optimize.autoCiteClearConfirm"))) return;
    const newBody = stripAllPendingMarkers(body);
    setBody(newBody);
    rerenderEditor(newBody, newBody.length);
    pendingSuggestionsRef.current.clear();
    setValidateResults({});
    setPopoverState(null);
    await flushSave(newBody, sectionIdRef.current);
  }, [body, pendingCount, flushSave, rerenderEditor, t]);

  /// Clicks inside the editor surface. Two distinct chip types are handled:
  ///
  /// 1. `.ce-cite-needed` (yellow pending placeholder) → opens the popover
  ///    anchored to the chip's rect so the user can pick a candidate or
  ///    dismiss the placeholder.
  /// 2. `.ce-citation` (resolved citation) → toggles the body↔footnote
  ///    selection so the matching footnote row in the panel below highlights
  ///    and scrolls into view.
  ///
  /// Anything else (including plain text) clears the citation selection so
  /// the highlight doesn't linger after the user moves on.
  const handleEditorClick = useCallback((e: React.MouseEvent) => {
    const targetEl = e.target as HTMLElement;

    const pendingChip = targetEl.closest<HTMLElement>("[data-placeholder-id]");
    if (pendingChip) {
      e.preventDefault();
      e.stopPropagation();
      const id = pendingChip.getAttribute("data-placeholder-id") || "";
      if (!id) return;
      const livePending = parsePendingCitations(body);
      const reason = livePending.find((p) => p.id === id)?.reason ?? "";
      const rect = pendingChip.getBoundingClientRect();
      setPopoverState({
        placeholderId: id,
        reason,
        anchor: {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          width: rect.width,
        },
      });
      return;
    }

    const citationChip = targetEl.closest<HTMLElement>(".ce-citation");
    if (citationChip && editorRef.current) {
      // Locate the chip's index among all citation chips — that's the
      // footnote number (1-based). The decorator and `buildFootnotes`
      // share the same document-order numbering, so this stays in sync.
      const allChips = editorRef.current.querySelectorAll(".ce-citation");
      const idx = Array.from(allChips).indexOf(citationChip);
      if (idx >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const num = idx + 1;
        // Toggle off when clicking the already-selected chip.
        setSelectedFootnote((prev) => (prev === num ? null : num));
      }
      return;
    }

    // Click landed elsewhere in the editor — drop any active citation
    // highlight so the user gets a clean writing surface.
    setSelectedFootnote(null);
  }, [body]);

  /// Replaces a pending placeholder with a real {{cite:...}} marker.
  /// Used by both the popover's "Insert as direct/indirect" buttons and
  /// triggered when handleAutoCiteValidate auto-promotes (in which case
  /// the body rewrite happens inside the hook).
  const handlePopoverInsert = useCallback(async (
    paperId: string,
    citationType: CitationType,
    pageRef: string,
  ) => {
    if (!popoverState) return;
    // The candidate set was AI-ranked (validate phase), so even though the
    // user picks the final paper, the citation itself originates from AI work.
    const marker = buildCitationMarker({
      paperId,
      citationType,
      pageRef,
      origin: "ai",
    });
    const newBody = replacePendingMarker(body, popoverState.placeholderId, marker);
    if (newBody === body) {
      setPopoverState(null);
      return;
    }
    setBody(newBody);
    rerenderEditor(newBody, newBody.length);
    pendingSuggestionsRef.current.delete(popoverState.placeholderId);
    setValidateResults((prev) => {
      const next = { ...prev };
      delete next[popoverState.placeholderId];
      return next;
    });
    setPopoverState(null);
    await flushSave(newBody, sectionIdRef.current);
  }, [body, popoverState, flushSave, rerenderEditor]);

  /// Strips a single placeholder from the body without creating a citation.
  /// Used by the popover's "Dismiss" action.
  const handlePopoverDismiss = useCallback(async () => {
    if (!popoverState) return;
    const newBody = replacePendingMarker(body, popoverState.placeholderId, "");
    if (newBody === body) {
      setPopoverState(null);
      return;
    }
    setBody(newBody);
    rerenderEditor(newBody, newBody.length);
    pendingSuggestionsRef.current.delete(popoverState.placeholderId);
    setValidateResults((prev) => {
      const next = { ...prev };
      delete next[popoverState.placeholderId];
      return next;
    });
    setPopoverState(null);
    await flushSave(newBody, sectionIdRef.current);
  }, [body, popoverState, flushSave, rerenderEditor]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {t("optimize.typeAtToInsert")} <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">@</kbd>
          </p>
          <button
            onClick={handleInsertFormula}
            className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors flex items-center gap-1"
            title="Insert formula (LaTeX)"
          >
            <Sigma className="size-3" />
            {t("optimize.formula")}
          </button>
          {/*
            "Recommend papers" — opens the smart-recommendation sheet.
            Reads section title + body + notes and asks the LLM to score
            every candidate paper for citation relevance. Always enabled:
            the recommender falls back to title-only matching when the
            user hasn't drafted anything yet, surfaced as a banner.
          */}
          <button
            onClick={() => setRecommendSheetOpen(true)}
            className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors flex items-center gap-1"
            title={t("recommend.toolbarTitle")}
          >
            <Compass className="size-3" />
            {t("recommend.toolbarButton")}
          </button>
          {/*
            "Generate section" — opens the AI section-writer popover.
            Disabled when the section has no mapped papers, since the
            writer is forbidden from citing papers outside the match
            list and uncited prose isn't useful for a thesis.
          */}
          <button
            onClick={() => setGeneratePopoverOpen(true)}
            disabled={matches.length === 0}
            className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              matches.length === 0
                ? t("generateSection.toolbarTitleDisabled")
                : t("generateSection.toolbarTitleEnabled")
            }
          >
            <Wand2 className="size-3" />
            {t("generateSection.toolbarButton")}
          </button>
          {/*
            "Auto-cite section" — phase A of the auto-citation flow.
            Disabled when the section has no mapped papers, since the
            detection prompt constrains suggested paperIds to that pool.
            Reuses the same disabled-rationale title text as Generate.
          */}
          <button
            onClick={handleAutoCiteDetect}
            disabled={
              matches.length === 0 ||
              detect.status === "loading" ||
              !body.trim()
            }
            className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              matches.length === 0
                ? t("optimize.autoCiteTitleDisabled")
                : t("optimize.autoCiteTitle")
            }
          >
            {detect.status === "loading" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <MessageCircleQuestion className="size-3" />
            )}
            {detect.status === "loading"
              ? t("optimize.autoCiteRunning")
              : t("optimize.autoCite")}
          </button>
          {/*
            Stop pill rendered only while detect is in flight. Aborts the
            request via the hook's `cancel()` (silent → no error toast).
          */}
          {detect.status === "loading" && (
            <button
              onClick={() => detect.cancel()}
              className="text-[11px] px-2 py-0.5 rounded-full text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1"
              title={t("optimize.stopAutoCite")}
              aria-label={t("optimize.stopAutoCite")}
            >
              <Square className="size-3 fill-current" />
              {t("optimize.stop")}
            </button>
          )}
          {/*
            "Validate & resolve" — phase B. Only shown when there is at
            least one pending placeholder; otherwise it would be a dead
            button. Auto-promotes high-confidence resolutions and creates
            section TODOs for the rest.
          */}
          {pendingCount > 0 && (
            <button
              onClick={handleAutoCiteValidate}
              disabled={validate.status === "loading"}
              className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {validate.status === "loading" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" />
              )}
              {t("optimize.autoCiteValidate")} ({pendingCount})
            </button>
          )}
          {/* Stop pill for the validate phase, mirroring the detect one. */}
          {validate.status === "loading" && (
            <button
              onClick={() => validate.cancel()}
              className="text-[11px] px-2 py-0.5 rounded-full text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1"
              title={t("optimize.stopAutoCite")}
              aria-label={t("optimize.stopAutoCite")}
            >
              <Square className="size-3 fill-current" />
              {t("optimize.stop")}
            </button>
          )}
          {/*
            "Clear pending citations" — escape hatch that strips every
            `{{citeNeeded:...}}` marker from the body in one mutation.
            Hidden when there is nothing to clear.
          */}
          {pendingCount > 0 && (
            <button
              onClick={handleClearPending}
              className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1"
              title={t("optimize.autoCiteClear")}
            >
              <Eraser className="size-3" />
              {t("optimize.autoCiteClear")}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Save status */}
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            {saveStatus === "saving" && (
              <>
                <Loader2 className="size-3 animate-spin" />
                {t("common.saving")}
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <Check className="size-3 text-sage" />
                {t("common.saved")}
              </>
            )}
          </span>
        </div>
      </div>

      {/* Optimize toolbar — visible when text is selected and no optimization is in progress */}
      {selection && optimizeState.status === "idle" && (
        <div className="flex items-center gap-1.5 px-1">
          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mr-1">
            {t("optimize.toolbar")}
          </span>
          {optimizeModes.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() =>
                requestOptimize(mode, selection.start, selection.end)
              }
              className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors flex items-center gap-1"
            >
              <Icon className="size-3" />
              {label}
            </button>
          ))}
          {/* Divider before the find-citation pill so the visual grouping
              (optimize | citation) reflects the functional split. */}
          <span className="mx-1 h-3 w-px bg-border/50" aria-hidden="true" />
          {/*
            "Find citation" — opens the highlight-to-cite popover with the
            current selection. Disabled when the selection is collapsed (which
            means there is no text to score against).
          */}
          <button
            onClick={handleFindCitation}
            disabled={!selection || selection.start === selection.end}
            className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("findCitation.toolbarTitle", "Find a citation for this selection")}
          >
            <Quote className="size-3" />
            {t("findCitation.toolbarButton", "Find citation")}
          </button>
          <button
            onClick={() => setPromptEditorOpen(true)}
            className="text-[11px] px-1.5 py-0.5 rounded-full text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors ml-1"
            title={t("optimize.customizePrompts")}
          >
            <Settings2 className="size-3" />
          </button>
        </div>
      )}

      {/* Loading indicator */}
      {optimizeState.status === "loading" && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-amber/20 bg-amber/5">
          <Loader2 className="size-3 animate-spin text-amber" />
          <span className="text-[11px] text-amber-dim">
            {optimizeModes.find((m) => m.mode === optimizeState.mode)?.gerund ?? t("optimize.optimizing")} selected text…
          </span>
        </div>
      )}

      {/* Preview panel — shows AI result with Accept/Discard controls */}
      {optimizeState.status === "preview" && (
        <div className="rounded-lg border border-amber/20 bg-muted/10 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-amber/10">
            <span className="text-[10px] font-medium text-amber-dim uppercase tracking-wider">
              {optimizeModes.find((m) => m.mode === optimizeState.mode)?.label} {t("optimize.preview")}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDiscardOptimize}
                className="text-[11px] px-3 py-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              >
                {t("optimize.discard")}
              </button>
              <button
                onClick={handleAcceptOptimize}
                className="text-[11px] px-3 py-0.5 rounded-full bg-amber/10 text-amber hover:bg-amber/20 transition-colors"
              >
                {t("optimize.accept")}
              </button>
            </div>
          </div>
          <div className="px-4 py-3 space-y-2">
            <p className="text-sm text-foreground/40 line-through leading-relaxed">
              {optimizeState.originalText}
            </p>
            <p className="text-sm text-foreground/90 leading-relaxed">
              {optimizeState.optimizedText}
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {optimizeState.status === "error" && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-red-500/20 bg-red-500/5">
          <span className="text-[11px] text-red-400">
            {optimizeState.error}
          </span>
          <button
            onClick={handleDiscardOptimize}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Editor area — contentEditable div with inline citation rendering */}
      <div className="relative">
        <div
          ref={editorRef}
          contentEditable={optimizeState.status === "idle"}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onMouseUp={handleSelect}
          onKeyUp={handleSelect}
          onPaste={handlePaste}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          // Click capture for `.ce-cite-needed` chips. The editor's main
          // mousedown/up handlers fire after this; we stop propagation
          // inside handleEditorClick when a chip is the actual target so
          // text selection still works elsewhere.
          onClick={handleEditorClick}
          data-placeholder={t("optimize.startWriting")}
          suppressContentEditableWarning
          className={`w-full min-h-[400px] bg-transparent text-foreground/90 text-sm leading-relaxed rounded-lg border border-border/30 p-4 focus:outline-none focus:border-amber/30 transition-colors ${
            optimizeState.status !== "idle" ? "opacity-50" : ""
          }`}
          style={{ whiteSpace: "pre-wrap", wordWrap: "break-word" }}
        />

        {/* Citation picker dropdown */}
        {pickerOpen && (
          <CitationPicker
            matches={matches}
            query={pickerQuery}
            anchor={pickerAnchor}
            onSelect={handleCitationSelect}
            onDismiss={() => {
              setPickerOpen(false);
              // Clear the highlight-to-cite handoff if the user dismisses the
              // picker without inserting — otherwise a later @-trigger would
              // splice at the stale forced offset.
              setForcedInsertPos(null);
              setPickerInitialPaperId(null);
            }}
            initialPaperId={pickerInitialPaperId ?? undefined}
          />
        )}

        {/* Highlight-to-cite popover. Renders the recommender results for the
            current text selection so the user can pick a paper to cite without
            leaving the editor. */}
        {findCiteOpen && (
          <HighlightCitationPopover
            anchor={findCiteAnchor}
            scope={findCiteScope}
            onScopeChange={handleFindCiteScopeChange}
            loading={findCiteLoading}
            results={findCiteResults}
            excluded={findCiteExcluded}
            lowContext={findCiteLowContext}
            availableGroups={availableGroups.map((g) => ({
              _id: g._id as GroupId,
              name: g.name,
            }))}
            onPickResult={(paperId) => void handleFindCitePick(paperId)}
            onDismiss={handleFindCiteDismiss}
          />
        )}
      </div>

      {/* Formula preview panel — shows rendered KaTeX for formulas in the body */}
      {formulaEntries.length > 0 && (
        <FormulaPreviewPanel formulas={formulaEntries} />
      )}

      {/* Figure panel — upload, manage, and insert figure markers */}
      <FigurePanel
        sectionId={sectionId}
        body={body}
        onInsertMarker={handleInsertFigureMarker}
      />

      {/* Per-section TODO drawer. Renders below the editor (after the figure
          panel) so the writing surface stays the visual focus; the drawer
          starts collapsed and shows a badge count of incomplete items. */}
      <SectionTodoPanel sectionId={sectionId} editorRef={editorRef} />

      {/* Footnote panel — shows HKA-style footnotes for citations in the body */}
      {footnotes.length > 0 && (
        <div className="rounded-lg border border-border/30 p-4 bg-muted/10">
          <span className="text-[11px] font-medium text-amber-dim uppercase tracking-wider">
            {t("sectionWriteEditor.footnotes")}
          </span>
          <ol className="mt-2 space-y-3 list-none">
            {footnotes.map((fn) => {
              // Resolve the supporting excerpt(s) behind this footnote.
              // Citation markers don't carry an excerptId today, so we match
              // by paperId + page heuristically: prefer excerpt(s) whose
              // pageNumber's first integer equals the citation's pageRef
              // first integer; fall back to all excerpts from the cited paper
              // when no page-level match exists. This gives the writer a
              // visible anchor to the source quote without requiring a
              // schema/marker change.
              const allForPaper = excerptsByPaper.get(fn.paperId) ?? [];
              const citedPage = firstPageNumber(fn.pageRef);
              const exact =
                citedPage !== null
                  ? allForPaper.filter(
                      (e) => firstPageNumber(e.pageNumber) === citedPage
                    )
                  : [];
              const matched = exact.length > 0 ? exact : allForPaper;
              return (
                <li
                  key={fn.number}
                  data-footnote-number={fn.number}
                  // Clicking a footnote row highlights the matching <sup>
                  // chip and its enclosing paragraph in the editor above,
                  // and scrolls both into view. The visual tint comes from
                  // `.ce-footnote--selected` applied by the highlight
                  // effect — this handler just owns the state change.
                  onClick={() =>
                    setSelectedFootnote((prev) =>
                      prev === fn.number ? null : fn.number
                    )
                  }
                  className={`text-sm text-foreground/80 leading-relaxed cursor-pointer transition-colors${
                    fn.origin === "ai" ? " ce-footnote--ai" : ""
                  }`}
                >
                  <div>
                    <sup className="text-amber/70 mr-1">{fn.number}</sup>
                    {renderFootnoteText(fn)}
                  </div>
                  {matched.length > 0 && (
                    <ul className="mt-1.5 ml-5 space-y-1.5 list-none border-l border-border/30 pl-3">
                      {matched.map((ex) => (
                        <li key={ex._id} className="text-xs">
                          <div className="italic text-foreground/70">
                            “{ex.excerptText}”
                          </div>
                          {ex.pageNumber && (
                            <div className="mt-0.5 text-foreground/50">
                              {ex.pageNumberApproximate ? "~" : ""}p. {ex.pageNumber}
                              {exact.length === 0 && citedPage !== null && (
                                <span className="ml-2 text-amber-dim/70">
                                  ({t("sectionWriteEditor.excerptPageMismatch")})
                                </span>
                              )}
                            </div>
                          )}
                          {ex.relevanceNote?.trim() && (
                            <div className="mt-0.5 text-foreground/65">
                              {ex.relevanceNote}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Sources panel — resolves each Kürzel cited in this section to its
          paper (authors, year, title, source-type, full bibliography line) so
          the writer doesn't have to cross-reference the bibliography page. */}
      {citedSourcesInOrder.length > 0 && (
        <div className="rounded-lg border border-border/30 p-4 bg-muted/10">
          <span className="text-[11px] font-medium text-amber-dim uppercase tracking-wider">
            {t("sectionWriteEditor.sectionSources")}
          </span>
          <ul className="mt-2 space-y-3 list-none">
            {citedSourcesInOrder.map((source) => {
              const yearStr = source.year ? `(${source.year})` : "(o.J.)";
              const authorsLine =
                source.authors.length > 0
                  ? source.authors.join("; ")
                  : "";
              return (
                <li
                  key={source._id}
                  className="text-sm text-foreground/80 leading-relaxed"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-amber/80">
                      [{source.kuerzel}]
                    </span>
                    <span className="font-medium">
                      {authorsLine} {yearStr}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-foreground/50 px-1.5 py-0.5 rounded bg-muted/30">
                      {t(`sourceTypes.${source.sourceType}`)}
                    </span>
                  </div>
                  <div className="mt-0.5 italic">{source.title}</div>
                  <div className="mt-1 text-xs text-foreground/60">
                    {formatBibliographyEntry(source, {
                      title: source.title,
                      authors: source.authors,
                      year: source.year,
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Per-section AI prompt override editor */}
      <SectionPromptEditor
        open={promptEditorOpen}
        onOpenChange={setPromptEditorOpen}
        sectionTitle={`${activeSection.orderNumber} ${activeSection.title}`}
        language={language}
        aiPromptOverrides={content?.aiPromptOverrides as AiPromptOverridesByLang | undefined}
        globalSettings={metadata?.aiPromptSettings as AiPromptSettingsByLang | undefined}
        baselines={baselines}
        onChange={(overrides) => {
          updatePromptOverrides({
            sectionId,
            aiPromptOverrides: overrides,
          });
        }}
      />

      {/* AI section-writer popover (drafts prose with citations). */}
      <GenerateSectionPopover
        open={generatePopoverOpen}
        onOpenChange={setGeneratePopoverOpen}
        sectionId={sectionId}
        provider={provider}
        existingBody={body}
        hasMatches={matches.length > 0}
        onInsert={handleGeneratedInsert}
      />

      {/* Smart paper recommendation sheet. Recommendations are transient —
          the sheet calls api.matches.addMatch when the user clicks "Add",
          which feeds the existing AI run. */}
      {recommendSheetOpen && (
        <CitationRecommendSheet
          sectionId={sectionId}
          provider={provider}
          language={language}
          onClose={() => setRecommendSheetOpen(false)}
        />
      )}

      {/* Pending-citation popover. Anchored to the clicked chip's viewport
          rect; closes on outside click / Escape inside the component. */}
      {popoverState && (
        <PendingCitationPopover
          placeholderId={popoverState.placeholderId}
          reason={popoverState.reason}
          candidates={
            validateResults[popoverState.placeholderId]?.candidates ?? []
          }
          paperMetaById={matchPaperMeta}
          anchor={popoverState.anchor}
          onInsert={handlePopoverInsert}
          onDismiss={handlePopoverDismiss}
          onClose={() => setPopoverState(null)}
        />
      )}
    </div>
  );
}
