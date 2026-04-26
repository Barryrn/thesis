/// Right slide-in sheet for creating or editing a bibliographic source.
/// Renders dynamic form fields based on the selected source type and
/// handles Kürzel auto-generation with manual override support.

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useLanguage } from "@/lib/LanguageContext";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Save,
  Trash2,
  AlertTriangle,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import type { Doc } from "../../convex/_generated/dataModel";

// ── Types ────────────────────────────────────────────────────────────

type SourceType = Doc<"sources">["sourceType"];

/// Joined source + paper data returned by listAllSources.
type SourceWithPaper = Doc<"sources"> & {
  title: string;
  authors: string[];
  year?: number;
  zoteroItemKey?: string;
};

interface SourceEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /// When set, the sheet is in edit mode for this source.
  /// When null, the sheet is in create mode.
  source: SourceWithPaper | null;
}

/// All possible source type keys, used to render the type dropdown.
const SOURCE_TYPE_KEYS: SourceType[] = [
  "book",
  "bookChapter",
  "journalArticle",
  "newspaperArticle",
  "internetSource",
];

/// Shared CSS for form inputs matching the app's dark theme.
const FIELD_CLASS =
  "w-full rounded-md border border-border/40 bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber/40 placeholder:text-muted-foreground/50";

// ── Component ────────────────────────────────────────────────────────

export default function SourceEditSheet({
  open,
  onOpenChange,
  source,
}: SourceEditSheetProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const isEditing = source !== null;

  // Mutations
  const createManual = useMutation(api.sources.createManualSource);
  const updateSource = useMutation(api.sources.updateSource);
  const updatePaper = useMutation(api.sources.updateManualPaper);
  const deleteSafe = useMutation(api.sources.deleteSourceSafe);
  const updateManualContent = useMutation(api.papers.updateManualContent);

  // Paper data (needed to load manualContent when editing)
  const paper = useQuery(
    api.papers.getPaper,
    source ? { paperId: source.paperId } : "skip"
  );

  // Citation check for delete safety
  const citations = useQuery(
    api.sources.getSourceCitations,
    source ? { paperId: source.paperId } : "skip"
  );

  // ── Form state ───────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingFromZotero, setDeletingFromZotero] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Paper fields
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState<string[]>([""]);
  const [year, setYear] = useState("");

  // Source type
  const [sourceType, setSourceType] = useState<SourceType>("book");

  // Kürzel
  const [kuerzelOverride, setKuerzelOverride] = useState(false);
  const [kuerzelValue, setKuerzelValue] = useState("");

  // Shared fields
  const [publisher, setPublisher] = useState("");
  const [publisherLocation, setPublisherLocation] = useState("");
  const [edition, setEdition] = useState("");

  // Journal fields
  const [journalName, setJournalName] = useState("");
  const [volume, setVolume] = useState("");
  const [issue, setIssue] = useState("");
  const [pageStart, setPageStart] = useState("");
  const [pageEnd, setPageEnd] = useState("");

  // Book chapter fields
  const [editorNames, setEditorNames] = useState<string[]>([""]);
  const [editorBookTitle, setEditorBookTitle] = useState("");

  // Newspaper fields
  const [newspaperName, setNewspaperName] = useState("");
  const [publishDate, setPublishDate] = useState("");

  // Internet fields
  const [url, setUrl] = useState("");
  const [accessDate, setAccessDate] = useState("");

  // Manual text content
  const [manualContent, setManualContent] = useState("");
  const [showTextContent, setShowTextContent] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  // Sync form from source when editing
  useEffect(() => {
    if (source) {
      setTitle(source.title);
      setAuthors(source.authors.length > 0 ? [...source.authors] : [""]);
      setYear(source.year?.toString() ?? "");
      setSourceType(source.sourceType);
      setKuerzelOverride(source.kuerzelManualOverride);
      setKuerzelValue(source.kuerzel);
      setPublisher(source.publisher ?? "");
      setPublisherLocation(source.publisherLocation ?? "");
      setEdition(source.edition ?? "");
      setJournalName(source.journalName ?? "");
      setVolume(source.volume ?? "");
      setIssue(source.issue ?? "");
      setPageStart(source.pageStart ?? "");
      setPageEnd(source.pageEnd ?? "");
      setEditorNames(
        source.editorNames && source.editorNames.length > 0
          ? [...source.editorNames]
          : [""]
      );
      setEditorBookTitle(source.editorBookTitle ?? "");
      setNewspaperName(source.newspaperName ?? "");
      setPublishDate(source.publishDate ?? "");
      setUrl(source.url ?? "");
      setAccessDate(source.accessDate ?? "");
      setManualContent(paper?.manualContent ?? "");
      setShowTextContent(false);
    } else {
      // Reset for create mode
      setTitle("");
      setAuthors([""]);
      setYear("");
      setSourceType("book");
      setKuerzelOverride(false);
      setKuerzelValue("");
      setPublisher("");
      setPublisherLocation("");
      setEdition("");
      setJournalName("");
      setVolume("");
      setIssue("");
      setPageStart("");
      setPageEnd("");
      setEditorNames([""]);
      setEditorBookTitle("");
      setNewspaperName("");
      setPublishDate("");
      setUrl("");
      setAccessDate("");
      setManualContent("");
      setShowTextContent(false);
    }
    setShowDeleteConfirm(false);
  }, [source, open, paper]);

  /// Builds the source-specific optional fields from form state.
  const buildSourceFields = useCallback(() => {
    const fields: Record<string, string | string[] | undefined> = {};

    // Shared
    if (publisher) fields.publisher = publisher;
    if (publisherLocation) fields.publisherLocation = publisherLocation;
    if (edition) fields.edition = edition;

    // Type-specific
    if (sourceType === "journalArticle") {
      if (journalName) fields.journalName = journalName;
      if (volume) fields.volume = volume;
      if (issue) fields.issue = issue;
      if (pageStart) fields.pageStart = pageStart;
      if (pageEnd) fields.pageEnd = pageEnd;
    }

    if (sourceType === "bookChapter") {
      const filteredEditors = editorNames.filter((n) => n.trim());
      if (filteredEditors.length > 0) fields.editorNames = filteredEditors;
      if (editorBookTitle) fields.editorBookTitle = editorBookTitle;
      if (pageStart) fields.pageStart = pageStart;
      if (pageEnd) fields.pageEnd = pageEnd;
    }

    if (sourceType === "newspaperArticle") {
      if (newspaperName) fields.newspaperName = newspaperName;
      if (publishDate) fields.publishDate = publishDate;
    }

    if (sourceType === "internetSource") {
      if (url) fields.url = url;
      if (accessDate) fields.accessDate = accessDate;
    }

    return fields;
  }, [
    publisher, publisherLocation, edition, sourceType,
    journalName, volume, issue, pageStart, pageEnd,
    editorNames, editorBookTitle, newspaperName, publishDate,
    url, accessDate,
  ]);

  /// Saves the source (create or update).
  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      toast.error(t("toast.titleRequired"));
      return;
    }

    const filteredAuthors = authors.filter((a) => a.trim());
    if (filteredAuthors.length === 0) {
      toast.error(t("toast.authorRequired"));
      return;
    }

    setSaving(true);
    try {
      const yearNum = year ? parseInt(year, 10) : undefined;
      const sourceFields = buildSourceFields();

      if (isEditing && source) {
        // Update paper metadata
        await updatePaper({
          paperId: source.paperId,
          title: title.trim(),
          authors: filteredAuthors,
          year: yearNum,
        });

        // Persist manual text content changes
        await updateManualContent({
          paperId: source.paperId,
          manualContent: manualContent.trim() || undefined,
        });

        // Update source fields
        await updateSource({
          sourceId: source._id,
          sourceType,
          ...(kuerzelOverride
            ? { kuerzel: kuerzelValue, kuerzelManualOverride: true }
            : { kuerzelManualOverride: false }),
          ...sourceFields,
        });

        toast.success(t("toast.sourceUpdated"));
      } else {
        // Create new manual source
        const result = await createManual({
          title: title.trim(),
          authors: filteredAuthors,
          year: yearNum,
          sourceType,
          ...(kuerzelOverride && kuerzelValue
            ? { kuerzel: kuerzelValue, kuerzelManualOverride: true }
            : {}),
          manualContent: manualContent.trim() || undefined,
          ...sourceFields,
        });

        // Auto-trigger summarization when text content is provided
        if (manualContent.trim()) {
          toast.info(t("toast.summaryGenerating"));
          fetch(`${PYTHON_SERVICE_URL}/process-manual`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paperId: result.paperId,
              text: manualContent.trim(),
              language,
              provider: "openai",
            }),
          }).catch(() => {
            toast.error(t("toast.summaryFailed"));
          });
        }

        toast.success(t("toast.sourceCreated"));
      }

      onOpenChange(false);
    } catch (err) {
      toast.error(
        t("common.error", { message: err instanceof Error ? err.message : t("common.unknownError") })
      );
    } finally {
      setSaving(false);
    }
  }, [
    title, authors, year, sourceType, kuerzelOverride, kuerzelValue,
    source, isEditing, buildSourceFields, manualContent,
    createManual, updateSource, updatePaper, updateManualContent, onOpenChange,
  ]);

  /// Triggers AI summarization of the manual text content.
  const handleRegenerateSummary = useCallback(async () => {
    if (!source || !manualContent.trim()) return;

    setSummarizing(true);
    try {
      // Persist latest text first
      await updateManualContent({
        paperId: source.paperId,
        manualContent: manualContent.trim(),
      });

      const res = await fetch(`${PYTHON_SERVICE_URL}/process-manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperId: source.paperId,
          text: manualContent.trim(),
          language,
          provider: "openai",
        }),
      });
      if (!res.ok) throw new Error("Summarization failed");
      toast.success(t("toast.summaryGenerated"));
    } catch {
      toast.error(t("toast.summaryFailed"));
    } finally {
      setSummarizing(false);
    }
  }, [source, manualContent, updateManualContent]);

  /// Deletes the source with citation safety check.
  const handleDelete = useCallback(async () => {
    if (!source) return;

    setDeleting(true);
    try {
      await deleteSafe({ paperId: source.paperId });
      toast.success(t("toast.sourceDeleted"));
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("toast.deleteFailed")
      );
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [source, deleteSafe, onOpenChange, t]);

  /// Deletes the source from the Zotero library and then from this project.
  const handleDeleteFromZotero = useCallback(async () => {
    if (!source?.zoteroItemKey) return;

    setDeletingFromZotero(true);
    try {
      const res = await fetch(
        `${PYTHON_SERVICE_URL}/zotero/item/${source.zoteroItemKey}`,
        { method: "DELETE" }
      );

      if (res.status === 403) {
        const err = await res.json();
        toast.error(err.detail ?? t("toast.zoteroNoDeletePermission"));
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        toast.error(t("toast.zoteroDeleteFailed", { message: err.detail }));
        return;
      }

      // Also remove from this project
      await deleteSafe({ paperId: source.paperId });
      toast.success(t("toast.deletedFromZoteroAndProject"));
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("toast.deleteFailed")
      );
    } finally {
      setDeletingFromZotero(false);
      setShowDeleteConfirm(false);
    }
  }, [source, deleteSafe, onOpenChange]);

  /// Adds an empty author field.
  const addAuthor = () => setAuthors((prev) => [...prev, ""]);

  /// Removes an author field by index.
  const removeAuthor = (index: number) =>
    setAuthors((prev) => prev.filter((_, i) => i !== index));

  /// Updates an author field by index.
  const updateAuthor = (index: number, value: string) =>
    setAuthors((prev) => prev.map((a, i) => (i === index ? value : a)));

  /// Adds an empty editor field.
  const addEditor = () => setEditorNames((prev) => [...prev, ""]);

  /// Removes an editor field by index.
  const removeEditor = (index: number) =>
    setEditorNames((prev) => prev.filter((_, i) => i !== index));

  /// Updates an editor field by index.
  const updateEditor = (index: number, value: string) =>
    setEditorNames((prev) => prev.map((e, i) => (i === index ? value : e)));

  const isCited = citations && citations.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-full !max-w-lg overflow-hidden flex flex-col"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>
            {isEditing ? t("sourceEditSheet.editSource") : t("sourceEditSheet.newSource")}
          </SheetTitle>
          <SheetDescription>
            {isEditing
              ? t("sourceEditSheet.editDescription")
              : t("sourceEditSheet.newDescription")}
          </SheetDescription>
          {isEditing && (
            <div className="mt-2">
              {source?.zoteroItemKey ? (
                <span className="text-[10px] bg-blue-500/20 text-blue-600 px-1.5 py-0.5 rounded">
                  {t("sourceEditSheet.originZotero")}
                </span>
              ) : (
                <span className="text-[10px] bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded">
                  {t("sourceEditSheet.originManual")}
                </span>
              )}
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* ── Source Type ────────────────────────────────────────── */}
          <FieldGroup label={t("sourceEditSheet.sourceType")}>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as SourceType)}
              className={FIELD_CLASS}
            >
              {SOURCE_TYPE_KEYS.map((value) => (
                <option key={value} value={value}>
                  {t(`sourceTypes.${value}`)}
                </option>
              ))}
            </select>
          </FieldGroup>

          {/* ── Core Fields ────────────────────────────────────────── */}
          <FieldGroup label={t("common.title")}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("sourceEditSheet.placeholder.title")}
            />
          </FieldGroup>

          <FieldGroup label={t("sourceEditSheet.authorsLabel")}>
            <div className="space-y-2">
              {authors.map((author, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={author}
                    onChange={(e) => updateAuthor(i, e.target.value)}
                    placeholder={t("sourceEditSheet.placeholder.author", { index: i + 1 })}
                    className="flex-1"
                  />
                  {authors.length > 1 && (
                    <button
                      onClick={() => removeAuthor(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addAuthor}
                className="text-[11px] text-amber hover:text-amber/80 flex items-center gap-1 transition-colors"
              >
                <Plus className="size-3" />
                {t("sourceEditSheet.addAuthor")}
              </button>
            </div>
          </FieldGroup>

          <FieldGroup label={t("common.year")}>
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder={t("sourceEditSheet.placeholder.year")}
              className="!w-28"
            />
          </FieldGroup>

          {/* ── Kürzel ─────────────────────────────────────────────── */}
          <FieldGroup label={t("sourceEditSheet.abbreviation")}>
            <div className="space-y-2">
              {isEditing && !kuerzelOverride && (
                <span className="font-mono text-sm text-amber bg-amber/10 px-2 py-0.5 rounded">
                  [{source?.kuerzel}]
                </span>
              )}
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={kuerzelOverride}
                  onChange={(e) => setKuerzelOverride(e.target.checked)}
                  className="rounded border-border/40"
                />
                {t("sourceEditSheet.abbreviationManual")}
              </label>
              {kuerzelOverride && (
                <Input
                  value={kuerzelValue}
                  onChange={(e) => setKuerzelValue(e.target.value)}
                  placeholder={t("sourceEditSheet.placeholder.abbreviation")}
                  className="!w-28 font-mono"
                />
              )}
            </div>
          </FieldGroup>

          {/* ── Type-Specific Fields ───────────────────────────────── */}

          {/* Book / Book Chapter shared fields */}
          {(sourceType === "book" || sourceType === "bookChapter") && (
            <>
              <FieldGroup label={t("common.publisher")}>
                <Input
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                  placeholder={t("sourceEditSheet.placeholder.publisher")}
                />
              </FieldGroup>
              <FieldGroup label={t("common.publisherPlace")}>
                <Input
                  value={publisherLocation}
                  onChange={(e) => setPublisherLocation(e.target.value)}
                  placeholder={t("sourceEditSheet.placeholder.publisherPlace")}
                />
              </FieldGroup>
              <FieldGroup label={t("common.edition")}>
                <Input
                  value={edition}
                  onChange={(e) => setEdition(e.target.value)}
                  placeholder={t("sourceEditSheet.placeholder.edition")}
                  className="!w-40"
                />
              </FieldGroup>
            </>
          )}

          {/* Book Chapter specific */}
          {sourceType === "bookChapter" && (
            <>
              <FieldGroup label={t("sourceEditSheet.bookTitleAnthology")}>
                <Input
                  value={editorBookTitle}
                  onChange={(e) => setEditorBookTitle(e.target.value)}
                  placeholder={t("sourceEditSheet.placeholder.bookTitle")}
                />
              </FieldGroup>
              <FieldGroup label={t("sourceEditSheet.editors")}>
                <div className="space-y-2">
                  {editorNames.map((editor, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={editor}
                        onChange={(e) => updateEditor(i, e.target.value)}
                        placeholder={t("sourceEditSheet.placeholder.editor", { index: i + 1 })}
                        className="flex-1"
                      />
                      {editorNames.length > 1 && (
                        <button
                          onClick={() => removeEditor(i)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={addEditor}
                    className="text-[11px] text-amber hover:text-amber/80 flex items-center gap-1 transition-colors"
                  >
                    <Plus className="size-3" />
                    {t("sourceEditSheet.addEditor")}
                  </button>
                </div>
              </FieldGroup>
              <div className="flex gap-3">
                <FieldGroup label={t("sourceEditSheet.pageFrom")}>
                  <Input
                    value={pageStart}
                    onChange={(e) => setPageStart(e.target.value)}
                    placeholder={t("sourceEditSheet.placeholder.pageFrom")}
                    className="!w-20"
                  />
                </FieldGroup>
                <FieldGroup label={t("sourceEditSheet.pageTo")}>
                  <Input
                    value={pageEnd}
                    onChange={(e) => setPageEnd(e.target.value)}
                    placeholder={t("sourceEditSheet.placeholder.pageTo")}
                    className="!w-20"
                  />
                </FieldGroup>
              </div>
            </>
          )}

          {/* Journal Article */}
          {sourceType === "journalArticle" && (
            <>
              <FieldGroup label={t("sourceEditSheet.journal")}>
                <Input
                  value={journalName}
                  onChange={(e) => setJournalName(e.target.value)}
                  placeholder={t("sourceEditSheet.placeholder.journal")}
                />
              </FieldGroup>
              <div className="flex gap-3">
                <FieldGroup label={t("sourceEditSheet.volumeLabel")}>
                  <Input
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                    placeholder="z.B. 12"
                    className="!w-20"
                  />
                </FieldGroup>
                <FieldGroup label={t("sourceEditSheet.issueLabel")}>
                  <Input
                    value={issue}
                    onChange={(e) => setIssue(e.target.value)}
                    placeholder="z.B. 3"
                    className="!w-20"
                  />
                </FieldGroup>
              </div>
              <div className="flex gap-3">
                <FieldGroup label={t("sourceEditSheet.pageFrom")}>
                  <Input
                    value={pageStart}
                    onChange={(e) => setPageStart(e.target.value)}
                    placeholder={t("sourceEditSheet.placeholder.pageFrom")}
                    className="!w-20"
                  />
                </FieldGroup>
                <FieldGroup label={t("sourceEditSheet.pageTo")}>
                  <Input
                    value={pageEnd}
                    onChange={(e) => setPageEnd(e.target.value)}
                    placeholder={t("sourceEditSheet.placeholder.pageTo")}
                    className="!w-20"
                  />
                </FieldGroup>
              </div>
            </>
          )}

          {/* Newspaper Article */}
          {sourceType === "newspaperArticle" && (
            <>
              <FieldGroup label={t("sourceEditSheet.newspaper")}>
                <Input
                  value={newspaperName}
                  onChange={(e) => setNewspaperName(e.target.value)}
                  placeholder={t("sourceEditSheet.placeholder.newspaper")}
                />
              </FieldGroup>
              <FieldGroup label={t("sourceEditSheet.publicationDate")}>
                <Input
                  type="date"
                  value={publishDate}
                  onChange={(e) => setPublishDate(e.target.value)}
                  className="!w-44"
                />
              </FieldGroup>
            </>
          )}

          {/* Internet Source */}
          {sourceType === "internetSource" && (
            <>
              <FieldGroup label={t("common.url")}>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                />
              </FieldGroup>
              <FieldGroup label={t("sourceEditSheet.accessDate")}>
                <Input
                  type="date"
                  value={accessDate}
                  onChange={(e) => setAccessDate(e.target.value)}
                  className="!w-44"
                />
              </FieldGroup>
            </>
          )}

          {/* ── Text Content (all manual source types) ────────────── */}
          <FieldGroup label={t("sourceEditSheet.textContent")}>
            <div className="space-y-2">
              {isEditing && manualContent && !showTextContent ? (
                <button
                  onClick={() => setShowTextContent(true)}
                  className="text-[11px] text-amber hover:text-amber/80 flex items-center gap-1 transition-colors"
                >
                  <ChevronDown className="size-3" />
                  {t("sourceEditSheet.showText", { count: manualContent.length.toLocaleString() })}
                </button>
              ) : (
                <>
                  <textarea
                    value={manualContent}
                    onChange={(e) => setManualContent(e.target.value)}
                    placeholder={t("sourceEditSheet.placeholder.textContent")}
                    rows={8}
                    className={`${FIELD_CLASS} resize-y min-h-[120px]`}
                  />
                  {isEditing && showTextContent && (
                    <button
                      onClick={() => setShowTextContent(false)}
                      className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    >
                      <ChevronUp className="size-3" />
                      {t("sourceEditSheet.hideText")}
                    </button>
                  )}
                </>
              )}

              {/* Regenerate summary button (only when editing with text) */}
              {isEditing && manualContent.trim() && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={handleRegenerateSummary}
                  disabled={summarizing}
                >
                  {summarizing ? (
                    <Loader2 className="size-3 animate-spin mr-1" />
                  ) : (
                    <RotateCcw className="size-3 mr-1" />
                  )}
                  {t("sourceEditSheet.regenerateSummary")}
                </Button>
              )}
            </div>
          </FieldGroup>
        </div>

        {/* ── Footer actions ──────────────────────────────────────── */}
        <div className="shrink-0 border-t border-border/30 p-4 space-y-3">
          {/* Delete confirmation */}
          {isEditing && showDeleteConfirm && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
              {isCited ? (
                <>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-destructive">
                        {t("sourceEditSheet.sourceCited")}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {t("sourceEditSheet.sourceCitedWarning")}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {citations?.map((c) => (
                          <li
                            key={c.sectionId}
                            className="text-[11px] text-foreground/70"
                          >
                            • {c.title}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-destructive">
                    {source?.zoteroItemKey
                      ? t("sourceEditSheet.deletePrompt")
                      : t("sourceEditSheet.deleteConfirm")}
                  </p>

                  {source?.zoteroItemKey && (
                    <p className="text-[11px] text-red-400 flex items-start gap-1.5">
                      <AlertTriangle className="size-3 shrink-0 mt-0.5" />
                      {t("sourceEditSheet.deleteZoteroWarning")}
                    </p>
                  )}

                  <div className="flex flex-col gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full text-xs"
                      onClick={handleDelete}
                      disabled={deleting || deletingFromZotero}
                    >
                      {deleting ? (
                        <Loader2 className="size-3 animate-spin mr-1" />
                      ) : (
                        <Trash2 className="size-3 mr-1" />
                      )}
                      {t("sourceEditSheet.removeFromProject")}
                    </Button>

                    {source?.zoteroItemKey && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full text-xs bg-red-700 hover:bg-red-800"
                        onClick={handleDeleteFromZotero}
                        disabled={deleting || deletingFromZotero}
                      >
                        {deletingFromZotero ? (
                          <Loader2 className="size-3 animate-spin mr-1" />
                        ) : (
                          <Trash2 className="size-3 mr-1" />
                        )}
                        {t("sourceEditSheet.deleteFromZotero")}
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => setShowDeleteConfirm(false)}
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex gap-2">
            {isEditing && !showDeleteConfirm && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive text-xs"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="size-3 mr-1" />
                {t("common.delete")}
              </Button>
            )}

            <div className="flex-1" />

            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              className="bg-amber text-background hover:bg-amber/90 text-xs"
              onClick={handleSave}
              disabled={saving || !title.trim()}
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin mr-1" />
              ) : (
                <Save className="size-3 mr-1" />
              )}
              {isEditing ? t("common.save") : t("common.create")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

/// Labelled field wrapper for the source form.
function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
        {label}
      </label>
      {children}
    </div>
  );
}
