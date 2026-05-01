import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { Check, Loader2, Sparkles, GraduationCap, Feather, Maximize2, X, Sigma, Settings2, Wand2, Compass, MessageCircleQuestion, Eraser, Square } from "lucide-react";
import CitationPicker from "./CitationPicker";
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
  getAtTriggerContext,
  buildFootnotes,
  renderFootnoteText,
  formatBibliographyEntry,
  parsePendingCitations,
  extractPendingPlaceholderIds,
  replacePendingMarker,
  stripAllPendingMarkers,
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
import type { ActiveSection, CitationType, OptimizeMode, AiPromptSettingsByLang, AiPromptOverridesByLang } from "@/lib/types";
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

  // ── Citation selection ────────────────────────────────────────────────
  /// Handles the completed citation picker flow: paper + type + page ref.
  const handleCitationSelect = useCallback(
    (
      paperId: string,
      citationType: CitationType,
      pageRef: string,
      secondaryPaperId?: string,
      secondaryPageRef?: string
    ) => {
      const editor = editorRef.current;
      if (!editor) return;

      const cursorPos = getCaretOffsetInRawText(editor);
      const { newBody, newCursorPos } = insertCitationMarker(
        body,
        pickerStartPos,
        cursorPos >= 0 ? cursorPos : body.length,
        paperId,
        citationType,
        pageRef,
        secondaryPaperId,
        secondaryPageRef
      );

      setBody(newBody);
      setPickerOpen(false);
      scheduleSave(newBody);
      rerenderEditor(newBody, newCursorPos);
    },
    [body, pickerStartPos, scheduleSave, rerenderEditor]
  );

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

  /// Clicks on a `.ce-cite-needed` chip in the editor. Opens the popover
  /// anchored to the chip's rect so the user can pick a candidate or
  /// dismiss the placeholder.
  const handleEditorClick = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-placeholder-id]"
    );
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const id = target.getAttribute("data-placeholder-id") || "";
    if (!id) return;
    const livePending = parsePendingCitations(body);
    const reason = livePending.find((p) => p.id === id)?.reason ?? "";
    const rect = target.getBoundingClientRect();
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
    const marker = `{{cite:${paperId}::${citationType}::${pageRef}}}`;
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
            onDismiss={() => setPickerOpen(false)}
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
                  className="text-sm text-foreground/80 leading-relaxed"
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
