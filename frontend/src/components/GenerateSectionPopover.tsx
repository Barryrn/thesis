import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useGenerateSection } from "@/hooks/useGenerateSection";
import { parseCitations } from "@/lib/citationUtils";

interface GenerateSectionPopoverProps {
  /// Whether the sheet is open. Owned by the parent (the toolbar
  /// button toggles it).
  open: boolean;
  /// Sheet open/close events. Used both for the close button and for
  /// dismiss-via-overlay; we always abort the running stream on close
  /// so a half-finished draft never leaks costs after the user leaves.
  onOpenChange: (open: boolean) => void;
  /// Active section identifier — passed straight through to the hook.
  sectionId: string;
  /// AI provider ("anthropic" | "openai") propagated from the global
  /// provider context. The hook forwards it to the backend.
  provider: string;
  /// Current body of the section, used for two things:
  ///   1. Deciding whether Insert needs a Replace/Append confirm.
  ///   2. Computing the appended body when the user picks Append.
  existingBody: string;
  /// Whether any papers are mapped to this section. False suppresses
  /// the Generate button and shows a "map papers first" hint instead.
  hasMatches: boolean;
  /// Called with the final body the editor should adopt. The popover
  /// is responsible for the actual splice (Replace vs Append) so the
  /// editor stays simple. The popover closes itself after this fires.
  onInsert: (newBody: string) => void;
}

/// Sheet hosting the section-writer flow — guidance → clarify →
/// stream → insert. Encapsulates the three-state UI so
/// ``SectionWriteEditor`` can remain a thin caller.
export default function GenerateSectionPopover({
  open,
  onOpenChange,
  sectionId,
  provider,
  existingBody,
  hasMatches,
  onInsert,
}: GenerateSectionPopoverProps) {
  const { t } = useTranslation();
  const { state, start, submitAnswers, skipAnswers, abort, reset } =
    useGenerateSection(sectionId, provider);

  // The popover owns its form state — closing always discards it.
  const [guidance, setGuidance] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);

  // When the sheet closes (overlay click, ESC, X button, parent
  // toggle), abort any in-flight call and reset everything. Keeping
  // this in an effect rather than in onOpenChange catches all close
  // paths uniformly.
  useEffect(() => {
    if (!open) {
      abort();
      reset();
      setGuidance("");
      setAnswers([]);
    }
  }, [open, abort, reset]);

  // Resize the answers array whenever new questions arrive so the
  // controlled textareas have a stable initial value of "".
  useEffect(() => {
    if (state.status === "awaitingAnswers") {
      setAnswers(state.questions.map(() => ""));
    }
  }, [state.status, state.questions]);

  /// Whether the editor body already has prose. Drives Replace/Append.
  const hasExistingBody = existingBody.trim().length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-full !max-w-xl overflow-hidden flex flex-col"
      >
        <SheetHeader>
          <SheetTitle className="text-sm flex items-center gap-2">
            <Sparkles className="size-4 text-amber" />
            {t("generateSection.title")}
          </SheetTitle>
          <SheetDescription>
            {t("generateSection.description")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-4">
          {!hasMatches ? (
            <BlockedNoMatches />
          ) : (
            <>
              {(state.status === "idle" || state.status === "clarifying") && (
                <GuidanceView
                  guidance={guidance}
                  onGuidanceChange={setGuidance}
                  onGenerate={() => start(guidance)}
                  loading={state.status === "clarifying"}
                />
              )}

              {state.status === "awaitingAnswers" && (
                <AnswersView
                  questions={state.questions}
                  answers={answers}
                  onAnswerChange={(i, v) =>
                    setAnswers((prev) => {
                      const next = prev.slice();
                      next[i] = v;
                      return next;
                    })
                  }
                  onSubmit={() => submitAnswers(answers)}
                  onSkip={() => skipAnswers()}
                />
              )}

              {(state.status === "streaming" || state.status === "done") && (
                <StreamView
                  draft={state.draft}
                  warnings={state.warnings}
                  status={state.status}
                  hasExistingBody={hasExistingBody}
                  onInsertReplace={() => {
                    onInsert(state.draft);
                    onOpenChange(false);
                  }}
                  onInsertAppend={() => {
                    const sep = existingBody.endsWith("\n\n") ? "" : "\n\n";
                    onInsert(existingBody + sep + state.draft);
                    onOpenChange(false);
                  }}
                  onCancel={() => abort()}
                />
              )}

              {state.status === "error" && (
                <ErrorView
                  message={state.error ?? t("generateSection.unknownError")}
                  onRetry={() => start(guidance)}
                />
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-views
// ──────────────────────────────────────────────────────────────────────

function BlockedNoMatches() {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-amber/20 bg-amber/5 p-4 text-sm">
      <p className="font-medium mb-1">{t("generateSection.noMatchesTitle")}</p>
      <p className="text-muted-foreground">
        {t("generateSection.noMatchesBody")}
      </p>
    </div>
  );
}

function GuidanceView({
  guidance,
  onGuidanceChange,
  onGenerate,
  loading,
}: {
  guidance: string;
  onGuidanceChange: (v: string) => void;
  onGenerate: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs text-muted-foreground" htmlFor="gs-guidance">
        {t("generateSection.guidanceLabel")}
      </label>
      <textarea
        id="gs-guidance"
        value={guidance}
        onChange={(e) => onGuidanceChange(e.target.value)}
        placeholder={t("generateSection.guidancePlaceholder")}
        rows={5}
        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber/40"
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button
          onClick={onGenerate}
          disabled={loading}
          className="gap-1.5"
        >
          {loading ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t("generateSection.checking")}
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" />
              {t("generateSection.generate")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function AnswersView({
  questions,
  answers,
  onAnswerChange,
  onSubmit,
  onSkip,
}: {
  questions: string[];
  answers: string[];
  onAnswerChange: (i: number, v: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("generateSection.clarifyIntro")}
      </p>
      {questions.map((q, i) => (
        <div key={i} className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor={`gs-a-${i}`}>
            {q}
          </label>
          <textarea
            id={`gs-a-${i}`}
            value={answers[i] ?? ""}
            onChange={(e) => onAnswerChange(i, e.target.value)}
            rows={2}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber/40"
          />
        </div>
      ))}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onSkip}>
          {t("generateSection.skipAndWrite")}
        </Button>
        <Button onClick={onSubmit} className="gap-1.5">
          <Sparkles className="size-3.5" />
          {t("generateSection.continue")}
        </Button>
      </div>
    </div>
  );
}

function StreamView({
  draft,
  warnings,
  status,
  hasExistingBody,
  onInsertReplace,
  onInsertAppend,
  onCancel,
}: {
  draft: string;
  warnings: string[];
  status: "streaming" | "done";
  hasExistingBody: boolean;
  onInsertReplace: () => void;
  onInsertAppend: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // Memoise the rendered preview — we resolve every {{cite:…}} marker
  // to a small "[ref]" badge so the user can see grounding density at
  // a glance without us having to plumb the full source-map through.
  const rendered = useMemo(() => renderPreview(draft), [draft]);

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {status === "streaming"
            ? t("generateSection.drafting")
            : t("generateSection.draft")}
        </span>
        {status === "streaming" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="gap-1 text-xs"
          >
            <X className="size-3" />
            {t("generateSection.cancel")}
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-[200px] max-h-[55vh] overflow-y-auto rounded-md border border-border bg-muted/20 p-3 text-sm whitespace-pre-wrap leading-relaxed">
        {rendered.length > 0 ? rendered : (
          <span className="text-muted-foreground italic">
            {t("generateSection.waiting")}
          </span>
        )}
        {status === "streaming" && (
          <span className="inline-block w-1.5 h-4 ml-0.5 bg-foreground/40 animate-pulse align-middle" />
        )}
      </div>

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber/30 bg-amber/5 p-3 text-xs space-y-1">
          <p className="font-medium text-amber-dim">
            {t("generateSection.citationNotes")}
          </p>
          <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {status === "done" && (
        <div className="flex justify-end gap-2 pt-1">
          {hasExistingBody ? (
            <>
              <Button variant="ghost" onClick={onInsertAppend}>
                {t("generateSection.append")}
              </Button>
              <Button onClick={onInsertReplace} className="gap-1.5">
                {t("generateSection.replace")}
              </Button>
            </>
          ) : (
            <Button onClick={onInsertReplace} className="gap-1.5">
              {t("generateSection.insert")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm space-y-3">
      <p className="font-medium">{t("generateSection.failed")}</p>
      <p className="text-muted-foreground">{message}</p>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {t("generateSection.retry")}
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Preview rendering
// ──────────────────────────────────────────────────────────────────────

interface PreviewSegment {
  kind: "text" | "cite";
  /// Text content (for "text") or marker payload (for "cite", unused).
  content: string;
  /// Sequential footnote-style number for "cite" segments.
  number?: number;
}

/// Lightweight preview renderer for the streamed draft.
///
/// We don't have the source map handy in the popover and don't need
/// the editor's full styling — a numbered "[¹]" superscript is enough
/// for the user to gauge citation density and placement before
/// committing. The full HKA footnote rendering happens after insert
/// when the editor's existing pipeline takes over.
function renderPreview(draft: string): ReactNode[] {
  const segments: PreviewSegment[] = [];
  const citations = parseCitations(draft);
  if (citations.length === 0) {
    return [draft];
  }

  let cursor = 0;
  let citeIndex = 0;
  for (const c of citations) {
    const start = draft.indexOf(c.fullMatch, cursor);
    if (start < 0) continue;
    if (start > cursor) {
      segments.push({ kind: "text", content: draft.slice(cursor, start) });
    }
    segments.push({
      kind: "cite",
      content: c.fullMatch,
      number: ++citeIndex,
    });
    cursor = start + c.fullMatch.length;
  }
  if (cursor < draft.length) {
    segments.push({ kind: "text", content: draft.slice(cursor) });
  }

  return segments.map((seg, i) =>
    seg.kind === "cite" ? (
      <sup
        key={i}
        className="text-amber-dim font-medium px-0.5"
        title={seg.content}
      >
        [{seg.number}]
      </sup>
    ) : (
      <span key={i}>{seg.content}</span>
    )
  );
}
