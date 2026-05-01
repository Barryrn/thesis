import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Check, Loader2, Sparkles, GraduationCap, Feather, Maximize2, X, Sigma, Settings2, Wand2 } from "lucide-react";
import CitationPicker from "./CitationPicker";
import SectionPromptEditor from "./SectionPromptEditor";
import FormulaPreviewPanel from "./FormulaPreviewPanel";
import FigurePanel from "./FigurePanel";
import GenerateSectionPopover from "./GenerateSectionPopover";
import {
  extractCitationIds,
  insertCitationMarker,
  getAtTriggerContext,
  buildFootnotes,
  renderFootnoteText,
} from "@/lib/citationUtils";
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
import { useBaselinePrompts } from "@/hooks/useBaselinePrompts";
import { resolvePrompt } from "@/lib/promptResolver";
import { useLanguage } from "@/lib/LanguageContext";
import { useProvider } from "@/lib/ProviderContext";
import type { ActiveSection, CitationType, OptimizeMode, AiPromptSettingsByLang, AiPromptOverridesByLang } from "@/lib/types";
import "katex/dist/katex.min.css";
import type { Doc } from "../../convex/_generated/dataModel";

/// Debounce delay in ms before auto-saving content.
const SAVE_DEBOUNCE_MS = 1500;

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
  } = useTextOptimize(body, language, provider, getCustomPrompt);

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
  /// Tracks latest body for cleanup/flush on unmount.
  const bodyRef = useRef(body);
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
  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

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

  /// Formula preview entries extracted from body text.
  const formulaEntries = useMemo(
    () => extractFormulasForPreview(body),
    [body]
  );

  // ── Sync from server on mount / section switch ────────────────────────
  useEffect(() => {
    // Reset on section change
    initializedRef.current = false;
    lastSavedBodyRef.current = null;
    lastRenderedBodyRef.current = "";
    setSaveStatus("idle");
    setPickerOpen(false);
  }, [sectionId]);

  useEffect(() => {
    // Only sync from server once on initial load or section switch
    if (content !== undefined && !initializedRef.current) {
      const serverBody = content?.body ?? "";
      setBody(serverBody);
      lastSavedBodyRef.current = serverBody;
      initializedRef.current = true;
    }
  }, [content]);

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

  // ── Debounced auto-save ───────────────────────────────────────────────
  const flushSave = useCallback(
    async (bodyToSave: string, targetSectionId: string) => {
      // Guard: don't save if section changed since the timer was set
      if (targetSectionId !== sectionIdRef.current) return;
      if (bodyToSave === lastSavedBodyRef.current) return;

      setSaveStatus("saving");
      try {
        const citedIds = extractCitationIds(bodyToSave);
        await saveMutation({
          sectionId: targetSectionId as any,
          body: bodyToSave,
          citedPaperIds: citedIds as any,
        });
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

  // Flush pending save on section switch or unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Flush immediately with captured values
      const currentBody = bodyRef.current;
      const targetId = sectionIdRef.current;
      if (currentBody !== lastSavedBodyRef.current) {
        flushSave(currentBody, targetId);
      }
    };
  }, [sectionId, flushSave]);

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

      {/* Footnote panel — shows HKA-style footnotes for citations in the body */}
      {footnotes.length > 0 && (
        <div className="rounded-lg border border-border/30 p-4 bg-muted/10">
          <span className="text-[11px] font-medium text-amber-dim uppercase tracking-wider">
            {t("sectionWriteEditor.footnotes")}
          </span>
          <ol className="mt-2 space-y-1 list-none">
            {footnotes.map((fn) => (
              <li
                key={fn.number}
                className="text-sm text-foreground/80 leading-relaxed"
              >
                <sup className="text-amber/70 mr-1">{fn.number}</sup>
                {renderFootnoteText(fn)}
              </li>
            ))}
          </ol>
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
    </div>
  );
}
