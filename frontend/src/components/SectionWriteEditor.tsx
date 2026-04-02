import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Check, Loader2, Sparkles, GraduationCap, Feather, Maximize2, X } from "lucide-react";
import CitationPicker from "./CitationPicker";
import {
  extractCitationIds,
  insertCitationMarker,
  getAtTriggerContext,
  getCaretCoordinates,
  renderCitationsApa,
  renderCitationsIeee,
  buildIeeeOrderMap,
  buildCitationLabel,
} from "@/lib/citationUtils";
import { useTextOptimize } from "@/hooks/useTextOptimize";
import { useLanguage } from "@/lib/LanguageContext";
import type { ActiveSection, CitationStyle, OptimizeMode } from "@/lib/types";

/// Debounce delay in ms before auto-saving content.
const SAVE_DEBOUNCE_MS = 1500;

interface SectionWriteEditorProps {
  activeSection: ActiveSection;
}

/// Main write-mode editor for composing thesis text with inline citations.
/// Provides a plain textarea with @-triggered citation picker, debounced
/// auto-save to Convex, and a preview pane with configurable citation style.
export default function SectionWriteEditor({
  activeSection,
}: SectionWriteEditorProps) {
  const { sectionId } = activeSection;

  // ── Data queries ──────────────────────────────────────────────────────
  const content = useQuery(api.sectionContent.getSectionContent, { sectionId });
  const matches =
    useQuery(api.matches.getMatchesBySection, { sectionId }) ?? [];
  const saveMutation = useMutation(api.sectionContent.saveSectionContent);

  // ── Local state ───────────────────────────────────────────────────────
  const [body, setBody] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const [citationStyle, setCitationStyle] = useState<CitationStyle>("apa");
  const [showPreview, setShowPreview] = useState(false);

  // Text selection state for optimize toolbar
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Language context for AI optimization
  const { language } = useLanguage();

  // AI text optimization hook
  const {
    state: optimizeState,
    requestOptimize,
    acceptOptimize,
    discardOptimize,
  } = useTextOptimize(body, language);

  // Citation picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerStartPos, setPickerStartPos] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState({ top: 0, left: 0 });

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /// Tracks the sectionId at save-invocation time to prevent cross-section writes.
  const sectionIdRef = useRef(sectionId);
  /// Tracks the last body sent to Convex so we don't overwrite local state
  /// when the reactive query pushes back the server version.
  const lastSavedBodyRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  // Keep sectionId ref current
  useEffect(() => {
    sectionIdRef.current = sectionId;
  }, [sectionId]);

  // ── Sync from server on mount / section switch ────────────────────────
  useEffect(() => {
    // Reset on section change
    initializedRef.current = false;
    lastSavedBodyRef.current = null;
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
      const currentBody = textareaRef.current?.value;
      const targetId = sectionIdRef.current;
      if (
        currentBody !== undefined &&
        currentBody !== lastSavedBodyRef.current
      ) {
        flushSave(currentBody, targetId);
      }
    };
  }, [sectionId, flushSave]);

  // ── Text change handler ───────────────────────────────────────────────
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newBody = e.target.value;
      setBody(newBody);
      scheduleSave(newBody);

      // Check for @ trigger
      const cursorPos = e.target.selectionStart;
      const ctx = getAtTriggerContext(newBody, cursorPos);
      if (ctx) {
        setPickerQuery(ctx.query);
        setPickerStartPos(ctx.startPos);
        if (!pickerOpen) {
          // Compute anchor position for the picker dropdown
          const coords = getCaretCoordinates(e.target, ctx.startPos);
          setPickerAnchor(coords);
          setPickerOpen(true);
        }
      } else {
        setPickerOpen(false);
      }
    },
    [scheduleSave, pickerOpen]
  );

  // Also check @ trigger on cursor movement (click / arrow keys),
  // and track the current text selection for the optimize toolbar.
  const handleSelect = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const ctx = getAtTriggerContext(body, cursorPos);
    if (ctx) {
      setPickerQuery(ctx.query);
      setPickerStartPos(ctx.startPos);
      if (!pickerOpen) {
        const coords = getCaretCoordinates(textarea, ctx.startPos);
        setPickerAnchor(coords);
        setPickerOpen(true);
      }
    } else {
      setPickerOpen(false);
    }

    // Track selection for optimize buttons (only when not in a preview state).
    if (optimizeState.status === "idle") {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (start !== end) {
        setSelection({ start, end });
      } else {
        setSelection(null);
      }
    }
  }, [body, pickerOpen, optimizeState.status]);

  // ── Citation selection ────────────────────────────────────────────────
  const handleCitationSelect = useCallback(
    (paperId: string, label: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      const { newBody, newCursorPos } = insertCitationMarker(
        body,
        pickerStartPos,
        cursorPos,
        paperId,
        label
      );

      setBody(newBody);
      setPickerOpen(false);
      scheduleSave(newBody);

      // Restore focus and cursor position
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      });
    },
    [body, pickerStartPos, scheduleSave]
  );

  // Handle keyboard events for picker navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  // ── Preview rendering ─────────────────────────────────────────────────
  const paperMap = useMemo(() => {
    const map = new Map<string, { authors: string[]; year?: number }>();
    for (const m of matches) {
      map.set(m.paperId, { authors: m.authors, year: m.year });
    }
    return map;
  }, [matches]);

  const previewText = useMemo(() => {
    if (!showPreview) return "";
    if (citationStyle === "apa") {
      return renderCitationsApa(body, paperMap);
    }
    const orderMap = buildIeeeOrderMap(body);
    return renderCitationsIeee(body, orderMap);
  }, [body, citationStyle, paperMap, showPreview]);

  // ── Optimize mode config ────────────────────────────────────────────
  const optimizeModes: {
    mode: OptimizeMode;
    icon: typeof Sparkles;
    label: string;
    gerund: string;
  }[] = [
    { mode: "enhance", icon: Sparkles, label: "Enhance", gerund: "Enhancing" },
    { mode: "formalize", icon: GraduationCap, label: "Formalize", gerund: "Formalizing" },
    { mode: "simplify", icon: Feather, label: "Simplify", gerund: "Simplifying" },
    { mode: "expand", icon: Maximize2, label: "Expand", gerund: "Expanding" },
  ];

  /// Handles accepting the AI-optimized text and updating the editor body.
  const handleAcceptOptimize = useCallback(() => {
    const { newBody } = acceptOptimize();
    setBody(newBody);
    scheduleSave(newBody);
    setSelection(null);
  }, [acceptOptimize, scheduleSave]);

  /// Handles discarding the optimize preview.
  const handleDiscardOptimize = useCallback(() => {
    discardOptimize();
    setSelection(null);
  }, [discardOptimize]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Type <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">@</kbd> to
          insert a citation
        </p>
        <div className="flex items-center gap-3">
          {/* Preview toggle */}
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
              showPreview
                ? "bg-amber/10 text-amber"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Preview
          </button>

          {/* Save status */}
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            {saveStatus === "saving" && (
              <>
                <Loader2 className="size-3 animate-spin" />
                Saving...
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <Check className="size-3 text-sage" />
                Saved
              </>
            )}
          </span>
        </div>
      </div>

      {/* Optimize toolbar — visible when text is selected and no optimization is in progress */}
      {selection && optimizeState.status === "idle" && (
        <div className="flex items-center gap-1.5 px-1">
          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mr-1">
            Optimize
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
        </div>
      )}

      {/* Loading indicator */}
      {optimizeState.status === "loading" && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-amber/20 bg-amber/5">
          <Loader2 className="size-3 animate-spin text-amber" />
          <span className="text-[11px] text-amber-dim">
            {optimizeModes.find((m) => m.mode === optimizeState.mode)?.gerund ?? "Optimizing"} selected text…
          </span>
        </div>
      )}

      {/* Preview panel — shows AI result with Accept/Discard controls */}
      {optimizeState.status === "preview" && (
        <div className="rounded-lg border border-amber/20 bg-muted/10 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-amber/10">
            <span className="text-[10px] font-medium text-amber-dim uppercase tracking-wider">
              {optimizeState.mode} preview
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDiscardOptimize}
                className="text-[11px] px-3 py-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              >
                Discard
              </button>
              <button
                onClick={handleAcceptOptimize}
                className="text-[11px] px-3 py-0.5 rounded-full bg-amber/10 text-amber hover:bg-amber/20 transition-colors"
              >
                Accept
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

      {/* Editor area */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={handleChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          readOnly={optimizeState.status !== "idle"}
          placeholder="Start writing your thesis text here..."
          className={`w-full min-h-[400px] bg-transparent text-foreground/90 text-sm leading-relaxed resize-y rounded-lg border border-border/30 p-4 focus:outline-none focus:border-amber/30 transition-colors placeholder:text-muted-foreground/40 font-[inherit] ${
            optimizeState.status !== "idle" ? "opacity-50" : ""
          }`}
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

      {/* Preview pane */}
      {showPreview && (
        <div className="rounded-lg border border-border/30 p-4 bg-muted/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium text-amber-dim uppercase tracking-wider">
              Preview
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCitationStyle("apa")}
                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                  citationStyle === "apa"
                    ? "bg-amber/10 text-amber"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                APA
              </button>
              <button
                onClick={() => setCitationStyle("ieee")}
                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                  citationStyle === "ieee"
                    ? "bg-amber/10 text-amber"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                IEEE
              </button>
            </div>
          </div>
          {previewText ? (
            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
              {previewText}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground/50 italic">
              No content to preview yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
