import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  GripVertical,
  ChevronDown,
  Quote,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  StickyNote,
  HelpCircle,
  Lightbulb,
  FlaskConical,
  FileText,
  Eye,
  Unlink,
  BookOpen,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type {
  SectionMatch,
  SectionId,
  DragData,
  MatchExcerpt,
  SourceType,
  PaperGroup,
  GroupId,
} from "@/lib/types";
import GroupPillRow from "./GroupPillRow";
import DocumentPreviewModal from "./DocumentPreviewModal";
import type { Id } from "../../convex/_generated/dataModel";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import { useProvider } from "@/lib/ProviderContext";

interface PaperSummaryCardProps {
  match: SectionMatch;
  sectionId: SectionId;
  sortable?: boolean;
}

/// Returns a translation key and styling class for the relevance score badge.
function getScoreBadge(score: number) {
  if (score >= 0.7)
    return {
      tKey: "paperCard.strong",
      className: "bg-sage/20 text-sage border-sage/30",
    };
  if (score >= 0.5)
    return {
      tKey: "paperCard.possible",
      className: "bg-amber/15 text-amber border-amber/30",
    };
  return {
    tKey: "paperCard.weak",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  };
}

/// Formats author list for display; accepts a fallback string for empty lists.
function formatAuthors(authors: string[], unknownLabel: string): string {
  if (authors.length === 0) return unknownLabel;
  if (authors.length <= 2) return authors.join(", ");
  return `${authors[0]}, ${authors[1]} et al.`;
}

// --- CollapsibleSection sub-component ---

function CollapsibleSection({
  icon: Icon,
  label,
  defaultOpen = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <div className="border-t border-border/20 pt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-amber-dim uppercase tracking-wider hover:text-amber transition-colors w-full"
      >
        <Icon className="size-3" />
        <span>{label}</span>
        <ChevronDown
          className={`size-3 ml-auto transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      {expanded && <div className="mt-2">{children}</div>}
    </div>
  );
}

/// All source type options in display order.
const SOURCE_TYPE_OPTIONS: SourceType[] = [
  "book",
  "bookChapter",
  "journalArticle",
  "newspaperArticle",
  "internetSource",
];

// --- Form field state for the source edit form ---

/// Holds the editable fields of a bibliography source record.
interface SourceFormState {
  kuerzel: string;
  kuerzelManualOverride: boolean;
  sourceType: SourceType;
  publisher: string;
  publisherLocation: string;
  edition: string;
  journalName: string;
  volume: string;
  issue: string;
  pageStart: string;
  pageEnd: string;
  editorNames: string;
  editorBookTitle: string;
  newspaperName: string;
  publishDate: string;
  url: string;
  accessDate: string;
}

/// Returns a blank form state with sensible defaults.
function emptyFormState(): SourceFormState {
  return {
    kuerzel: "",
    kuerzelManualOverride: false,
    sourceType: "book",
    publisher: "",
    publisherLocation: "",
    edition: "",
    journalName: "",
    volume: "",
    issue: "",
    pageStart: "",
    pageEnd: "",
    editorNames: "",
    editorBookTitle: "",
    newspaperName: "",
    publishDate: "",
    url: "",
    accessDate: "",
  };
}

// --- PaperMetadataForm sub-component ---

/// Inline editor for paper metadata (title, authors, year, DOI).
/// Allows users to correct auto-extracted metadata from the PDF.
function PaperMetadataForm({ paperId }: { paperId: Id<"papers"> }) {
  const { t } = useTranslation();
  const paper = useQuery(api.papers.getPaper, { paperId });
  const identifiers = useQuery(api.summaries.getIdentifiersByPaper, { paperId });
  const updateMetadata = useMutation(api.papers.updatePaperMetadata);
  const upsertIdentifier = useMutation(api.summaries.upsertIdentifier);
  const regenerateKuerzel = useMutation(api.sources.regenerateKuerzel);

  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [authorsStr, setAuthorsStr] = useState("");
  const [yearStr, setYearStr] = useState("");
  const [doi, setDoi] = useState("");
  const [saving, setSaving] = useState(false);

  /// Current DOI from the identifiers table.
  const currentDoi = identifiers?.find((id) => id.identifierType === "DOI")?.identifierValue ?? "";

  /// Sync local state from server data when paper loads or changes.
  useEffect(() => {
    if (paper && !isEditing) {
      setTitle(paper.title);
      setAuthorsStr(paper.authors.join(", "));
      setYearStr(paper.year ? String(paper.year) : "");
    }
  }, [paper, isEditing]);

  /// Sync DOI from identifiers query.
  useEffect(() => {
    if (!isEditing) {
      setDoi(currentDoi);
    }
  }, [currentDoi, isEditing]);

  /// Saves changed metadata and regenerates Kürzel if authors/year changed.
  const handleSave = useCallback(async () => {
    if (!paper) return;
    setSaving(true);
    try {
      const authors = authorsStr
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      const year = yearStr ? parseInt(yearStr, 10) : undefined;

      await updateMetadata({
        paperId,
        title,
        authors,
        year: isNaN(year as number) ? undefined : year,
      });

      // Save DOI if changed
      if (doi.trim() !== currentDoi) {
        if (doi.trim()) {
          await upsertIdentifier({
            paperId,
            identifierType: "DOI",
            identifierValue: doi.trim(),
          });
        }
      }

      // Regenerate Kürzel when authors or year change
      const authorsChanged = authors.join(",") !== paper.authors.join(",");
      const yearChanged = year !== paper.year;
      if (authorsChanged || yearChanged) {
        try {
          await regenerateKuerzel({ paperId });
        } catch {
          // Non-fatal — Kürzel can be edited manually
        }
      }

      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  }, [paper, paperId, title, authorsStr, yearStr, doi, currentDoi, updateMetadata, upsertIdentifier, regenerateKuerzel]);

  if (!paper) return null;

  if (!isEditing) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
            {t("common.title")}
          </span>
          <button
            onClick={() => setIsEditing(true)}
            className="text-muted-foreground/40 hover:text-amber transition-colors"
            title={t("paperSummaryCard.editMetadata")}
          >
            <Pencil className="size-3" />
          </button>
        </div>
        <p className="text-sm text-foreground/80">{paper.title}</p>
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider block mt-2">
          {t("common.authors")}
        </span>
        <p className="text-sm text-foreground/80">
          {paper.authors.join(", ") || t("paperSummaryCard.noAuthors")}
        </p>
        <div className="flex gap-8 mt-2">
          <div>
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider block">
              {t("common.year")}
            </span>
            <p className="text-sm text-foreground/80">
              {paper.year ?? "–"}
            </p>
          </div>
          <div>
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider block">
              {t("common.doi")}
            </span>
            <p className="text-sm text-foreground/80">
              {currentDoi || "–"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] text-muted-foreground uppercase tracking-wider block mb-1">
          {t("common.title")}
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-transparent border border-border/30 rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber/40"
        />
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground uppercase tracking-wider block mb-1">
          {t("paperSummaryCard.authorsCommaSeparated")}
        </label>
        <input
          type="text"
          value={authorsStr}
          onChange={(e) => setAuthorsStr(e.target.value)}
          placeholder="Max Müller, Anna Schmidt"
          className="w-full bg-transparent border border-border/30 rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber/40"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-muted-foreground uppercase tracking-wider block mb-1">
            {t("common.year")}
          </label>
          <input
            type="text"
            value={yearStr}
            onChange={(e) => setYearStr(e.target.value)}
            placeholder="2023"
            className="w-full bg-transparent border border-border/30 rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber/40"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground uppercase tracking-wider block mb-1">
            {t("common.doi")}
          </label>
          <input
            type="text"
            value={doi}
            onChange={(e) => setDoi(e.target.value)}
            placeholder="10.1000/xyz123"
            className="w-full bg-transparent border border-border/30 rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber/40"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-[11px] px-3 py-1 rounded-full bg-amber/10 text-amber hover:bg-amber/20 transition-colors disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
        <button
          onClick={() => setIsEditing(false)}
          className="text-[11px] px-3 py-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

// --- SourceEditForm sub-component ---

/// Inline bibliography source editor embedded in the PaperSummaryCard.
/// Loads source data from Convex, provides type-specific fields, and
/// supports DOI-based metadata auto-fill via the Python service.
function SourceEditForm({ paperId }: { paperId: Id<"papers"> }) {
  const { t } = useTranslation();
  const source = useQuery(api.sources.getSourceByPaper, { paperId });
  const identifiers = useQuery(api.summaries.getIdentifiersByPaper, { paperId });
  const updateSource = useMutation(api.sources.updateSource);
  const regenerateKuerzel = useMutation(api.sources.regenerateKuerzel);
  const createSource = useMutation(api.sources.createSource);

  /// Auto-create a source record if one doesn't exist for this paper.
  /// This handles papers uploaded before the sources table was added.
  const [autoCreating, setAutoCreating] = useState(false);
  useEffect(() => {
    if (source === null && !autoCreating) {
      setAutoCreating(true);
      createSource({ paperId, sourceType: "book" })
        .catch((err: unknown) => {
          // Ignore "already exists" errors from race conditions
          if (!(err instanceof Error) || !err.message.includes("already exists")) {
            console.error("[SOURCE] Auto-create failed:", err);
          }
        })
        .finally(() => setAutoCreating(false));
    }
  }, [source, paperId, createSource, autoCreating]);

  const [isEditing, setIsEditing] = useState(false);
  const [editingKuerzel, setEditingKuerzel] = useState(false);
  const [form, setForm] = useState<SourceFormState>(emptyFormState);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  /// Sync local form state when the source record loads or changes.
  useEffect(() => {
    if (source) {
      setForm({
        kuerzel: source.kuerzel ?? "",
        kuerzelManualOverride: source.kuerzelManualOverride ?? false,
        sourceType: (source.sourceType as SourceType) ?? "book",
        publisher: source.publisher ?? "",
        publisherLocation: source.publisherLocation ?? "",
        edition: source.edition ?? "",
        journalName: source.journalName ?? "",
        volume: source.volume ?? "",
        issue: source.issue ?? "",
        pageStart: source.pageStart ?? "",
        pageEnd: source.pageEnd ?? "",
        editorNames: source.editorNames?.join(", ") ?? "",
        editorBookTitle: source.editorBookTitle ?? "",
        newspaperName: source.newspaperName ?? "",
        publishDate: source.publishDate ?? "",
        url: source.url ?? "",
        accessDate: source.accessDate ?? "",
      });
    }
  }, [source]);

  /// Update a single form field by key.
  const setField = useCallback(
    <K extends keyof SourceFormState>(key: K, value: SourceFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  /// Find the DOI identifier from the paper's identifiers list.
  const doiIdentifier = identifiers?.find(
    (id) => id.identifierType === "DOI"
  );

  /// Fetch metadata from CrossRef/OpenAlex via the Python service and
  /// pre-fill the form with the returned fields.
  async function handleLookupMetadata() {
    if (!doiIdentifier) return;
    setLookupLoading(true);
    setLookupError(null);
    try {
      const res = await fetch(`${PYTHON_SERVICE_URL}/lookup-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperId: paperId,
          doi: doiIdentifier.identifierValue,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Lookup failed (${res.status})`);
      }
      const data = await res.json();

      // Pre-fill form fields from the metadata response
      setForm((prev) => ({
        ...prev,
        sourceType: data.sourceType ?? prev.sourceType,
        publisher: data.publisher ?? prev.publisher,
        journalName: data.journalName ?? prev.journalName,
        volume: data.volume ?? prev.volume,
        issue: data.issue ?? prev.issue,
        pageStart: data.pageStart ?? prev.pageStart,
        pageEnd: data.pageEnd ?? prev.pageEnd,
      }));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  }

  /// Auto-generate a fresh Kuerzel from the paper's authors and year.
  async function handleAutoGenerateKuerzel() {
    try {
      const newKuerzel = await regenerateKuerzel({ paperId });
      if (newKuerzel) {
        setField("kuerzel", newKuerzel);
        setField("kuerzelManualOverride", false);
      }
    } catch {
      // Silently fail — the user can still type manually
    }
  }

  /// Persist only the fields that actually changed compared to the current
  /// source record, minimizing unnecessary writes.
  async function handleSave() {
    if (!source) return;
    setSaving(true);
    setSaveSuccess(false);

    // Build a patch of only changed fields
    const patch: Record<string, unknown> = {};

    if (form.sourceType !== source.sourceType) patch.sourceType = form.sourceType;
    if (form.kuerzel !== source.kuerzel) patch.kuerzel = form.kuerzel;
    if (form.kuerzelManualOverride !== source.kuerzelManualOverride)
      patch.kuerzelManualOverride = form.kuerzelManualOverride;
    if (form.publisher !== (source.publisher ?? "")) patch.publisher = form.publisher;
    if (form.publisherLocation !== (source.publisherLocation ?? ""))
      patch.publisherLocation = form.publisherLocation;
    if (form.edition !== (source.edition ?? "")) patch.edition = form.edition;
    if (form.journalName !== (source.journalName ?? "")) patch.journalName = form.journalName;
    if (form.volume !== (source.volume ?? "")) patch.volume = form.volume;
    if (form.issue !== (source.issue ?? "")) patch.issue = form.issue;
    if (form.pageStart !== (source.pageStart ?? "")) patch.pageStart = form.pageStart;
    if (form.pageEnd !== (source.pageEnd ?? "")) patch.pageEnd = form.pageEnd;
    if (form.newspaperName !== (source.newspaperName ?? ""))
      patch.newspaperName = form.newspaperName;
    if (form.publishDate !== (source.publishDate ?? "")) patch.publishDate = form.publishDate;
    if (form.url !== (source.url ?? "")) patch.url = form.url;
    if (form.accessDate !== (source.accessDate ?? "")) patch.accessDate = form.accessDate;
    if (form.editorBookTitle !== (source.editorBookTitle ?? ""))
      patch.editorBookTitle = form.editorBookTitle;

    // editorNames is stored as an array but edited as comma-separated text
    const newEditors = form.editorNames
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const oldEditors = source.editorNames ?? [];
    if (JSON.stringify(newEditors) !== JSON.stringify(oldEditors))
      patch.editorNames = newEditors;

    // Only call the mutation if something actually changed
    if (Object.keys(patch).length > 0) {
      try {
        await updateSource({ sourceId: source._id, ...patch });
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } catch (err) {
        console.error("Failed to update source:", err);
      }
    }

    setSaving(false);
    setIsEditing(false);
  }

  // Still loading
  if (source === undefined) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{t("paperCard.loadingSource")}</span>
      </div>
    );
  }

  // No source record exists for this paper
  if (source === null) {
    return (
      <p className="text-[11px] text-muted-foreground/60 italic py-1">
        {t("paperCard.noSourceDetails")}
      </p>
    );
  }

  // --- Display mode ---
  if (!isEditing) {
    return (
      <div className="space-y-2.5">
        {/* Kuerzel badge */}
        <div className="flex items-center gap-2">
          <span className="bg-amber/10 text-amber px-2 py-0.5 rounded text-xs font-mono">
            [{form.kuerzel}]
          </span>
          <span className="text-[11px] text-muted-foreground">
            {t(`sourceTypes.${form.sourceType}`)}
          </span>
        </div>

        {/* Type-specific fields summary */}
        <div className="text-sm text-foreground/70 space-y-0.5">
          {form.publisher && (
            <p>
              <span className="text-muted-foreground text-[11px]">{t("paperSummaryCard.publisherLabel")}</span>{" "}
              {form.publisher}
              {form.publisherLocation && `, ${form.publisherLocation}`}
            </p>
          )}
          {form.edition && (
            <p>
              <span className="text-muted-foreground text-[11px]">{t("paperSummaryCard.editionLabel")}</span>{" "}
              {form.edition}
            </p>
          )}
          {form.journalName && (
            <p>
              <span className="text-muted-foreground text-[11px]">{t("paperSummaryCard.journalLabel")}</span>{" "}
              {form.journalName}
              {form.volume && `, Vol. ${form.volume}`}
              {form.issue && ` (${form.issue})`}
            </p>
          )}
          {(form.pageStart || form.pageEnd) && (
            <p>
              <span className="text-muted-foreground text-[11px]">{t("paperSummaryCard.pagesLabel")}</span>{" "}
              {form.pageStart}
              {form.pageEnd && `–${form.pageEnd}`}
            </p>
          )}
          {form.editorNames && (
            <p>
              <span className="text-muted-foreground text-[11px]">{t("paperSummaryCard.editorsLabel")}</span>{" "}
              {form.editorNames}
            </p>
          )}
          {form.editorBookTitle && (
            <p>
              <span className="text-muted-foreground text-[11px]">{t("paperSummaryCard.bookTitleLabel")}</span>{" "}
              {form.editorBookTitle}
            </p>
          )}
          {form.newspaperName && (
            <p>
              <span className="text-muted-foreground text-[11px]">{t("paperSummaryCard.newspaperLabel")}</span>{" "}
              {form.newspaperName}
            </p>
          )}
          {form.publishDate && (
            <p>
              <span className="text-muted-foreground text-[11px]">{t("paperSummaryCard.dateLabel")}</span>{" "}
              {form.publishDate}
            </p>
          )}
          {form.url && (
            <p>
              <span className="text-muted-foreground text-[11px]">URL:</span>{" "}
              <a
                href={form.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber hover:underline break-all"
              >
                {form.url}
              </a>
            </p>
          )}
          {form.accessDate && (
            <p>
              <span className="text-muted-foreground text-[11px]">{t("paperSummaryCard.accessDateLabel")}</span>{" "}
              {form.accessDate}
            </p>
          )}
        </div>

        {/* Edit trigger */}
        <button
          onClick={() => setIsEditing(true)}
          className="flex items-center gap-1 text-[11px] text-amber-dim/60 hover:text-amber transition-colors"
        >
          <Pencil className="size-3" /> {t("common.edit")}
        </button>

        {/* Brief save confirmation */}
        {saveSuccess && (
          <span className="text-[11px] text-sage ml-2">{t("common.saved")}</span>
        )}
      </div>
    );
  }

  // --- Edit mode ---
  return (
    <div className="space-y-3">
      {/* Kuerzel row */}
      <div>
        <label className="text-[11px] text-muted-foreground uppercase tracking-wider">
          {t("paperSummaryCard.abbreviation")}
        </label>
        <div className="flex items-center gap-2 mt-1">
          {editingKuerzel ? (
            <>
              <input
                type="text"
                value={form.kuerzel}
                onChange={(e) => {
                  setField("kuerzel", e.target.value);
                  setField("kuerzelManualOverride", true);
                }}
                className="bg-transparent border border-border/30 rounded px-2 py-1.5 text-sm w-28 font-mono"
              />
              <button
                onClick={() => setEditingKuerzel(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Check className="size-3" />
              </button>
              <button
                onClick={handleAutoGenerateKuerzel}
                className="text-[11px] text-amber-dim/60 hover:text-amber transition-colors flex items-center gap-1"
                title={t("paperCard.autoGenerate")}
              >
                <RotateCcw className="size-3" /> {t("paperCard.auto")}
              </button>
            </>
          ) : (
            <>
              <span className="bg-amber/10 text-amber px-2 py-0.5 rounded text-xs font-mono">
                [{form.kuerzel}]
              </span>
              <button
                onClick={() => setEditingKuerzel(true)}
                className="text-muted-foreground/40 hover:text-amber transition-colors"
              >
                <Pencil className="size-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Source type dropdown */}
      <div>
        <label className="text-[11px] text-muted-foreground uppercase tracking-wider">
          {t("paperSummaryCard.sourceType")}
        </label>
        <select
          value={form.sourceType}
          onChange={(e) => setField("sourceType", e.target.value as SourceType)}
          className="mt-1 bg-transparent border border-border/30 rounded px-2 py-1.5 text-sm w-full"
        >
          {SOURCE_TYPE_OPTIONS.map((type) => (
            <option key={type} value={type}>
              {t(`sourceTypes.${type}`)}
            </option>
          ))}
        </select>
      </div>

      {/* DOI metadata lookup button — only shown when a DOI exists */}
      {doiIdentifier && (
        <div>
          <button
            onClick={handleLookupMetadata}
            disabled={lookupLoading}
            className="bg-amber/10 text-amber hover:bg-amber/20 rounded px-3 py-1 text-[11px] transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {lookupLoading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <BookOpen className="size-3" />
            )}
            {t("paperSummaryCard.loadMetadata")}
          </button>
          {lookupError && (
            <p className="text-[11px] text-destructive mt-1">{lookupError}</p>
          )}
        </div>
      )}

      {/* Type-specific fields — all values are preserved when switching types */}

      {/* Book fields: publisher, publisherLocation, edition */}
      {form.sourceType === "book" && (
        <>
          <SourceField
            label={t("common.publisher")}
            value={form.publisher}
            onChange={(v) => setField("publisher", v)}
          />
          <SourceField
            label={t("common.publisherPlace")}
            value={form.publisherLocation}
            onChange={(v) => setField("publisherLocation", v)}
          />
          <SourceField
            label={t("common.edition")}
            value={form.edition}
            onChange={(v) => setField("edition", v)}
          />
        </>
      )}

      {/* Book chapter fields: publisher, location, editors, book title, pages */}
      {form.sourceType === "bookChapter" && (
        <>
          <SourceField
            label={t("common.publisher")}
            value={form.publisher}
            onChange={(v) => setField("publisher", v)}
          />
          <SourceField
            label={t("common.publisherPlace")}
            value={form.publisherLocation}
            onChange={(v) => setField("publisherLocation", v)}
          />
          <SourceField
            label={t("paperSummaryCard.editorsCommaSeparated")}
            value={form.editorNames}
            onChange={(v) => setField("editorNames", v)}
          />
          <SourceField
            label={t("paperSummaryCard.bookTitleAnthology")}
            value={form.editorBookTitle}
            onChange={(v) => setField("editorBookTitle", v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <SourceField
              label={t("paperSummaryCard.pageFrom")}
              value={form.pageStart}
              onChange={(v) => setField("pageStart", v)}
            />
            <SourceField
              label={t("paperSummaryCard.pageTo")}
              value={form.pageEnd}
              onChange={(v) => setField("pageEnd", v)}
            />
          </div>
        </>
      )}

      {/* Journal article fields: journal name, volume, issue, pages */}
      {form.sourceType === "journalArticle" && (
        <>
          <SourceField
            label={t("paperSummaryCard.journal")}
            value={form.journalName}
            onChange={(v) => setField("journalName", v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <SourceField
              label={t("paperSummaryCard.volume")}
              value={form.volume}
              onChange={(v) => setField("volume", v)}
            />
            <SourceField
              label={t("paperSummaryCard.issue")}
              value={form.issue}
              onChange={(v) => setField("issue", v)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SourceField
              label={t("paperSummaryCard.pageFrom")}
              value={form.pageStart}
              onChange={(v) => setField("pageStart", v)}
            />
            <SourceField
              label={t("paperSummaryCard.pageTo")}
              value={form.pageEnd}
              onChange={(v) => setField("pageEnd", v)}
            />
          </div>
        </>
      )}

      {/* Newspaper article fields: newspaper name, publish date */}
      {form.sourceType === "newspaperArticle" && (
        <>
          <SourceField
            label={t("paperSummaryCard.newspaper")}
            value={form.newspaperName}
            onChange={(v) => setField("newspaperName", v)}
          />
          <SourceField
            label={t("paperSummaryCard.publicationDate")}
            value={form.publishDate}
            onChange={(v) => setField("publishDate", v)}
          />
        </>
      )}

      {/* Internet source fields: URL, access date */}
      {form.sourceType === "internetSource" && (
        <>
          <SourceField
            label={t("common.url")}
            value={form.url}
            onChange={(v) => setField("url", v)}
          />
          <SourceField
            label={t("paperSummaryCard.accessDate")}
            value={form.accessDate}
            onChange={(v) => setField("accessDate", v)}
          />
        </>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-amber/10 text-amber hover:bg-amber/20 rounded px-3 py-1 text-[11px] transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          {t("common.save")}
        </button>
        <button
          onClick={() => setIsEditing(false)}
          className="text-muted-foreground hover:text-foreground text-[11px] transition-colors flex items-center gap-1"
        >
          <X className="size-3" /> {t("common.cancel")}
        </button>
        {saveSuccess && (
          <span className="text-[11px] text-sage">{t("common.saved")}</span>
        )}
      </div>
    </div>
  );
}

// --- SourceField helper ---

/// Reusable labeled text input for source edit form fields.
function SourceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground uppercase tracking-wider">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 bg-transparent border border-border/30 rounded px-2 py-1.5 text-sm w-full"
      />
    </div>
  );
}

// --- ExcerptItem sub-component ---

function ExcerptItem({
  excerpt,
  onUpdate,
  onDelete,
}: {
  excerpt: MatchExcerpt;
  onUpdate: (args: {
    excerptId: Id<"matchExcerpts">;
    excerptText?: string;
    relevanceNote?: string;
    pageNumber?: string;
  }) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(excerpt.excerptText);
  const [editNote, setEditNote] = useState(excerpt.relevanceNote);
  const [editPageNumber, setEditPageNumber] = useState(excerpt.pageNumber ?? "");

  async function handleSave() {
    await onUpdate({
      excerptId: excerpt._id,
      excerptText: editText,
      relevanceNote: editNote,
      pageNumber: editPageNumber.trim() || undefined,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="space-y-2 p-2 rounded-md bg-muted/20 border border-border/20">
        <Textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="text-sm min-h-[60px]"
          placeholder="Excerpt text..."
        />
        <Textarea
          value={editNote}
          onChange={(e) => setEditNote(e.target.value)}
          className="text-sm min-h-[40px]"
          placeholder="Relevance note (optional)"
        />
        <Input
          value={editPageNumber}
          onChange={(e) => setEditPageNumber(e.target.value)}
          className="text-sm h-8"
          placeholder="Page (e.g. 42 or 42–45)"
        />
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="xs" onClick={() => setEditing(false)}>
            <X className="size-3" /> Cancel
          </Button>
          <Button size="xs" onClick={handleSave}>
            <Check className="size-3" /> Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group/excerpt space-y-1 relative">
      <blockquote className="text-sm text-foreground/80 leading-relaxed border-l-2 border-amber/30 pl-3 italic">
        &ldquo;{excerpt.excerptText}&rdquo;
      </blockquote>
      {excerpt.pageNumber && (
        <p
          className="text-[10px] text-muted-foreground/60 pl-3"
          title={
            excerpt.pageNumberApproximate
              ? "Approximate \u2014 page number could not be verified from the PDF"
              : undefined
          }
        >
          {excerpt.pageNumberApproximate ? "~" : ""}p. {excerpt.pageNumber}
        </p>
      )}
      <div className="flex items-start justify-between">
        <p className="text-[11px] text-muted-foreground pl-3 flex-1">
          {excerpt.relevanceNote}
        </p>
        <div className="opacity-0 group-hover/excerpt:opacity-100 transition-opacity flex items-center gap-1 shrink-0 ml-2">
          {excerpt.isManual && (
            <span className="text-[9px] text-amber-dim/50 self-center mr-1">
              manual
            </span>
          )}
          <button
            onClick={() => setEditing(true)}
            className="text-muted-foreground/40 hover:text-amber transition-colors p-0.5"
          >
            <Pencil className="size-3" />
          </button>
          <button
            onClick={onDelete}
            className="text-muted-foreground/40 hover:text-destructive transition-colors p-0.5"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main component ---

export default function PaperSummaryCard({
  match,
  sectionId,
  sortable = false,
}: PaperSummaryCardProps) {
  const { t } = useTranslation();
  const summary = useQuery(api.summaries.getSummaryByPaper, {
    paperId: match.paperId,
  });

  const paper = useQuery(api.papers.getPaper, {
    paperId: match.paperId,
  });

  const excerpts = useQuery(api.matches.getExcerptsByMatch, {
    matchId: match.matchId,
  });

  // Group membership for the always-visible pill row under the byline.
  // `listGroups` is shared across every card on the screen and Convex
  // dedupes identical query subscriptions, so the cost is one round-trip
  // per panel, not per card.
  const allGroups = (useQuery(api.groups.listGroups) ?? []) as PaperGroup[];
  const memberGroups = useQuery(api.groups.getGroupsForPaper, {
    paperId: match.paperId,
  });
  const paperGroupIds = useMemo<Set<GroupId>>(() => {
    if (!memberGroups) return new Set();
    return new Set(
      memberGroups
        .filter((g): g is NonNullable<typeof g> => g !== null)
        .map((g) => g._id as GroupId),
    );
  }, [memberGroups]);

  const [excerptsExpanded, setExcerptsExpanded] = useState(false);

  // Add excerpt form state
  const [showAddExcerpt, setShowAddExcerpt] = useState(false);
  const [newExcerptText, setNewExcerptText] = useState("");
  const [newRelevanceNote, setNewRelevanceNote] = useState("");
  const [newPageNumber, setNewPageNumber] = useState("");

  // Additional notes state
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [notesValue, setNotesValue] = useState(match.userNotes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);

  // Mutations
  const addExcerptMutation = useMutation(api.matches.addExcerpt);
  const updateExcerptMutation = useMutation(api.matches.updateExcerpt);
  const deleteExcerptMutation = useMutation(api.matches.deleteExcerpt);
  const updateUserNotesMutation = useMutation(api.matches.updateUserNotes);
  const removeMatchMutation = useMutation(api.matches.removeMatch);
  const updatePaperNotesMutation = useMutation(api.papers.updatePaperNotes);
  const setMatchExpandedMutation = useMutation(api.matches.setMatchExpanded);

  // Card-level expand/collapse. Persisted per `paperSectionMatches` row so a
  // paper can be collapsed in one section and expanded in another. Treat
  // `undefined` (no field yet on legacy rows) as collapsed — that's the new
  // default and avoids a backfill migration.
  const [isExpanded, setIsExpanded] = useState<boolean>(
    match.isExpanded ?? false,
  );

  // Reconcile with server changes (e.g. another tab toggled the same match).
  useEffect(() => {
    setIsExpanded(match.isExpanded ?? false);
  }, [match.isExpanded]);

  // Optimistic toggle. We flip the UI immediately and fire the mutation
  // fire-and-forget; on failure the next page load reconciles from the server.
  const handleToggleExpanded = useCallback(
    (next: boolean) => {
      setIsExpanded(next);
      void setMatchExpandedMutation({
        matchId: match.matchId,
        isExpanded: next,
      });
    },
    [setMatchExpandedMutation, match.matchId],
  );

  // PDF preview modal state. Opens DocumentPreviewModal so the user can read
  // the paper without leaving the editor / library context.
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);

  // Document notes state
  const [docNotesExpanded, setDocNotesExpanded] = useState(false);
  const [docNotesValue, setDocNotesValue] = useState(paper?.notes ?? "");
  const [docNotesDirty, setDocNotesDirty] = useState(false);

  // Manual AI-run state. Used when the paper was associated via center-panel
  // drag (which intentionally skips auto-AI), so the user can trigger
  // processing on demand. If a summary already exists we only run citations
  // for the current section; otherwise we run the full /process pipeline.
  const { provider } = useProvider();
  const allSections = useQuery(api.outline.listSections) ?? [];
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const runAi = useCallback(async () => {
    if (!paper?.fileUrl && !paper?.manualContent) return;
    setAiRunning(true);
    setAiError(null);
    const sectionsPayload = allSections.map((s) => ({
      _id: s._id,
      title: s.title,
      orderNumber: s.orderNumber,
      notes: s.notes,
    }));
    try {
      // Branch: summary exists → /cite (citations only). Else → /process (full).
      if (summary) {
        const res = await fetch(`${PYTHON_SERVICE_URL}/cite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paperId: match.paperId,
            fileUrl: paper.fileUrl || "",
            sectionIds: [sectionId],
            sections: sectionsPayload,
            language: "en",
            provider,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        const res = await fetch(`${PYTHON_SERVICE_URL}/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paperId: match.paperId,
            fileUrl: paper.fileUrl || "",
            sections: sectionsPayload,
            fileName: paper.fileName,
            language: "en",
            provider,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("[AI] Manual run failed:", err);
      setAiError(t("paperCard.runAi.error"));
    } finally {
      setAiRunning(false);
    }
  }, [paper, summary, match.paperId, sectionId, allSections, provider, t]);

  /// Mirrors Dashboard's `triggerCitation` so the embedded
  /// `DocumentPreviewModal` can assign this paper to additional sections from
  /// inside the card. Runs /cite for each target section so excerpts and
  /// scores are populated server-side. The card lives inside DndContext, so
  /// the modal renders here rather than at the page root.
  const triggerCitationFromPreview = useCallback(
    async (paperId: typeof match.paperId, sectionIds: SectionId[]) => {
      if (!paper?.fileUrl && !paper?.manualContent) return;
      const sectionsPayload = allSections.map((s) => ({
        _id: s._id,
        title: s.title,
        orderNumber: s.orderNumber,
        notes: s.notes,
      }));
      try {
        await fetch(`${PYTHON_SERVICE_URL}/cite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paperId,
            fileUrl: paper.fileUrl || "",
            sectionIds,
            sections: sectionsPayload,
            language: "en",
            provider,
          }),
        });
      } catch (err) {
        console.error("[CITE] Citation request failed:", err);
      }
    },
    [paper, allSections, provider, match.paperId],
  );

  const aiButtonLabel = aiRunning
    ? t("paperCard.runAi.running")
    : !summary
      ? t("paperCard.runAi.runAnalysis")
      : (excerpts && excerpts.length > 0)
        ? t("paperCard.runAi.rerunCitations")
        : t("paperCard.runAi.runCitations");

  const dragData = {
    type: "paper-card",
    paperId: match.paperId,
    sourceSectionId: sectionId,
    title: match.title,
    authors: match.authors,
    year: match.year,
    relevanceScore: match.relevanceScore,
    isManualOverride: match.isManualOverride,
  } satisfies DragData;

  const dragId = `paper-${sectionId}-${match.paperId}`;

  const sortableResult = useSortable({
    id: match.matchId,
    data: dragData,
    disabled: !sortable,
  });

  const draggableResult = useDraggable({
    id: dragId,
    data: dragData,
    disabled: sortable,
  });

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = sortable ? sortableResult : draggableResult;

  const style = sortable
    ? {
        transform: CSS.Transform.toString(sortableResult.transform),
        transition: sortableResult.transition ?? undefined,
      }
    : transform
      ? { transform: CSS.Translate.toString(transform) }
      : undefined;

  const badge = getScoreBadge(match.relevanceScore);

  async function handleAddExcerpt() {
    if (!newExcerptText.trim()) return;
    await addExcerptMutation({
      matchId: match.matchId,
      paperId: match.paperId,
      sectionId: sectionId,
      excerptText: newExcerptText.trim(),
      relevanceNote: newRelevanceNote.trim(),
      pageNumber: newPageNumber.trim() || undefined,
    });
    setNewExcerptText("");
    setNewRelevanceNote("");
    setNewPageNumber("");
    setShowAddExcerpt(false);
  }

  async function handleDeleteExcerpt(excerptId: Id<"matchExcerpts">) {
    await deleteExcerptMutation({ excerptId });
  }

  async function handleSaveNotes() {
    await updateUserNotesMutation({
      matchId: match.matchId,
      userNotes: notesValue,
    });
    setNotesDirty(false);
  }

  async function handleSaveDocNotes() {
    await updatePaperNotesMutation({
      paperId: match.paperId,
      notes: docNotesValue,
    });
    setDocNotesDirty(false);
  }

  async function handleUnlink() {
    if (
      window.confirm(
        t("paperCard.unlinkConfirm", { title: match.title })
      )
    ) {
      await removeMatchMutation({ paperId: match.paperId, sectionId });
    }
  }

  const excerptCount = excerpts?.length ?? 0;

  // The header row is the click/keyboard target for both expand and collapse.
  // Inner controls (drag handle, group pills, badge column with unlink +
  // chevron) stopPropagation so they keep their own behavior without also
  // toggling the card.
  const handleHeaderToggle = () => {
    handleToggleExpanded(!isExpanded);
  };

  const handleHeaderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleToggleExpanded(!isExpanded);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group bg-card rounded-lg border border-border/50 p-5 transition-all hover:border-amber/20 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {/* Header row — click or Enter/Space anywhere on it toggles expand. */}
      <div
        onClick={handleHeaderToggle}
        onKeyDown={handleHeaderKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        className="flex items-start gap-3 cursor-pointer"
      >
        <div
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-amber transition-colors shrink-0"
        >
          <GripVertical className="size-4" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="heading-serif text-lg text-foreground leading-snug">
            {match.title}
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatAuthors(match.authors, t("paperCard.unknownAuthors"))}
            {match.year ? ` (${match.year})` : ""}
          </p>
          {/* Always-visible group pills — addresses the "I cannot see which
              group a paper is in when it's in the middle panel" gap. */}
          <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
            <GroupPillRow
              paperId={match.paperId}
              groups={allGroups}
              paperGroupIds={paperGroupIds}
            />
          </div>
        </div>

        <div
          className="flex flex-col items-end gap-1.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Badge variant="outline" className={`text-xs ${badge.className}`}>
            {t(badge.tKey)}
          </Badge>
          {match.isManualOverride && (
            <span className="text-[10px] text-amber-dim">{t("paperCard.manualBadge")}</span>
          )}
          <div className="flex items-center gap-1">
            {/* Quick PDF preview — only when the paper has an uploaded file.
                Reuses the existing DocumentPreviewModal/PdfViewer pair so
                styling and full-screen behavior stay consistent with the
                library view. */}
            {paper?.fileUrl && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPdfPreviewOpen(true);
                }}
                className="text-muted-foreground/60 hover:text-amber transition-colors p-0.5"
                title={t("paperCard.viewPdf")}
                aria-label={t("paperCard.viewPdf")}
              >
                <Eye className="size-3.5" />
              </button>
            )}
            <button
              onClick={handleUnlink}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all p-0.5"
              title={t("paperCard.unlinkTooltip")}
            >
              <Unlink className="size-3.5" />
            </button>
            {/* Card-level expand/collapse chevron — always visible as a
                visual affordance. Rotates to indicate state. Header row also
                handles the toggle, but the chevron acts as a second click
                target that's slightly more discoverable. */}
            <button
              onClick={() => handleToggleExpanded(!isExpanded)}
              className="text-muted-foreground/60 hover:text-amber transition-colors p-0.5"
              title={isExpanded ? t("paperCard.collapseCard") : t("paperCard.expandCard")}
              aria-label={isExpanded ? t("paperCard.collapseCard") : t("paperCard.expandCard")}
            >
              <ChevronDown
                className={`size-4 transition-transform duration-200 ${
                  isExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Relevance bar */}
      <div className="mt-3 ml-7">
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-dim to-amber transition-all"
            style={{ width: `${match.relevanceScore * 100}%` }}
          />
        </div>
      </div>

      {/* Summary content */}
      <div className="mt-4 ml-7 space-y-4">
        {summary === undefined && (
          <div className="space-y-2">
            <div className="h-3 bg-muted/50 rounded animate-pulse w-3/4" />
            <div className="h-3 bg-muted/50 rounded animate-pulse w-1/2" />
            <div className="h-3 bg-muted/50 rounded animate-pulse w-2/3" />
          </div>
        )}

        {summary === null && (
          <p className="text-sm text-muted-foreground italic">
            {t("paperCard.notProcessed")}
          </p>
        )}

        {summary && (
          <>
            {summary.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {summary.keywords.map((kw) => (
                  <span
                    key={kw}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-dusty-blue/20 text-dusty-blue bg-dusty-blue/5"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            )}

            {isExpanded && (
              <>
                <CollapsibleSection icon={HelpCircle} label={t("paperCard.researchQuestion")} defaultOpen>
                  <p className="text-sm text-foreground/80 leading-relaxed">
                    {summary.researchQuestion}
                  </p>
                </CollapsibleSection>

                <CollapsibleSection icon={Lightbulb} label={t("paperCard.keyFindings")} defaultOpen>
                  <ul className="space-y-1">
                    {summary.keyFindings.map((finding, i) => (
                      <li
                        key={i}
                        className="text-sm text-foreground/80 leading-relaxed flex gap-2"
                      >
                        <span className="text-amber/60 shrink-0 mt-0.5">-</span>
                        <span>{finding}</span>
                      </li>
                    ))}
                  </ul>
                </CollapsibleSection>

                <CollapsibleSection icon={FlaskConical} label={t("paperCard.methodology")}>
                  <p className="text-sm text-foreground/70 leading-relaxed">
                    {summary.methodology}
                  </p>
                </CollapsibleSection>

                <CollapsibleSection icon={FileText} label={t("paperCard.fullSummary")}>
                  <p className="text-sm text-foreground/70 leading-relaxed border-l-2 border-amber/20 pl-3">
                    {summary.rawSummary}
                  </p>
                </CollapsibleSection>
              </>
            )}

            {/* Supporting excerpts */}
            {isExpanded && excerpts && (
              <div className="border-t border-border/20 pt-3">
                <button
                  onClick={() => setExcerptsExpanded(!excerptsExpanded)}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-amber-dim uppercase tracking-wider hover:text-amber transition-colors w-full"
                >
                  <Quote className="size-3" />
                  <span>
                    {excerptCount > 0
                      ? t("paperCard.supportingExcerpts", { count: excerptCount })
                      : t("paperCard.supportingExcerpts", { count: 0 })}
                  </span>
                  <ChevronDown
                    className={`size-3 ml-auto transition-transform duration-200 ${
                      excerptsExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {excerptsExpanded && (
                  <div className="mt-3 space-y-3">
                    {excerpts.map((excerpt) => (
                      <ExcerptItem
                        key={excerpt._id}
                        excerpt={excerpt}
                        onUpdate={updateExcerptMutation}
                        onDelete={() => handleDeleteExcerpt(excerpt._id)}
                      />
                    ))}

                    {excerptCount === 0 && !showAddExcerpt && (
                      <p className="text-[11px] text-muted-foreground/60 italic">
                        {t("paperCard.noExcerptsYet")}
                      </p>
                    )}

                    {showAddExcerpt ? (
                      <div className="mt-2 space-y-2 p-3 rounded-md bg-muted/30 border border-border/30">
                        <Textarea
                          placeholder={t("paperCard.pasteExcerpt")}
                          value={newExcerptText}
                          onChange={(e) => setNewExcerptText(e.target.value)}
                          className="text-sm min-h-[60px]"
                        />
                        <Textarea
                          placeholder={t("paperCard.whyRelevant")}
                          value={newRelevanceNote}
                          onChange={(e) => setNewRelevanceNote(e.target.value)}
                          className="text-sm min-h-[40px]"
                        />
                        <Input
                          placeholder={t("paperCard.pageExample")}
                          value={newPageNumber}
                          onChange={(e) => setNewPageNumber(e.target.value)}
                          className="text-sm h-8"
                        />
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              setShowAddExcerpt(false);
                              setNewExcerptText("");
                              setNewRelevanceNote("");
                              setNewPageNumber("");
                            }}
                          >
                            <X className="size-3" /> {t("common.cancel")}
                          </Button>
                          <Button
                            size="xs"
                            onClick={handleAddExcerpt}
                            disabled={!newExcerptText.trim()}
                          >
                            <Check className="size-3" /> {t("paperCard.add")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowAddExcerpt(true)}
                        className="flex items-center gap-1 text-[11px] text-amber-dim/60 hover:text-amber transition-colors"
                      >
                        <Plus className="size-3" /> {t("paperCard.addExcerpt")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}


          </>
        )}

        {/* All blocks below are hidden when the card is collapsed: the AI
            run controls, section notes, document notes, and source details. */}
        {isExpanded && (
          <>
        {/* Manual AI run button — used when the paper was associated via a
            center-panel drag (which intentionally skips auto-AI). If a summary
            already exists, only citations/excerpts are regenerated for this
            section; otherwise the full /process pipeline runs. */}
        <div className="border-t border-border/20 pt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={runAi}
            disabled={aiRunning || (!paper?.fileUrl && !paper?.manualContent)}
            className="gap-1.5"
          >
            {aiRunning ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            <span>{aiButtonLabel}</span>
          </Button>
          {aiError && (
            <p className="mt-1.5 text-[11px] text-destructive">{aiError}</p>
          )}
        </div>

        {/* Section Notes (per-paper per-section) — always visible for linked papers */}
        <div className="border-t border-border/20 pt-3">
          <button
            onClick={() => setNotesExpanded(!notesExpanded)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-amber-dim uppercase tracking-wider hover:text-amber transition-colors w-full"
          >
            <StickyNote className="size-3" />
            <span>{t("paperCard.sectionNotes")}</span>
            {match.userNotes && (
              <span className="text-[9px] text-muted-foreground normal-case tracking-normal ml-1">
                {t("paperCard.hasNotes")}
              </span>
            )}
            <ChevronDown
              className={`size-3 ml-auto transition-transform duration-200 ${
                notesExpanded ? "rotate-180" : ""
              }`}
            />
          </button>

          {notesExpanded && (
            <div className="mt-2 space-y-2">
              <Textarea
                placeholder={t("paperCard.addPaperNotes")}
                value={notesValue}
                onChange={(e) => {
                  setNotesValue(e.target.value);
                  setNotesDirty(true);
                }}
                className="text-sm min-h-[80px] bg-transparent"
              />
              {notesDirty && (
                <div className="flex justify-end">
                  <Button size="xs" onClick={handleSaveNotes}>
                    {t("paperCard.saveNotes")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Document Notes (global, per-paper) — always visible for linked papers */}
        <div className="border-t border-border/20 pt-3">
          <button
            onClick={() => setDocNotesExpanded(!docNotesExpanded)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-amber-dim uppercase tracking-wider hover:text-amber transition-colors w-full"
          >
            <FileText className="size-3" />
            <span>{t("paperCard.documentNotes")}</span>
            {paper?.notes && (
              <span className="text-[9px] text-muted-foreground normal-case tracking-normal ml-1">
                {t("paperCard.hasNotes")}
              </span>
            )}
            <ChevronDown
              className={`size-3 ml-auto transition-transform duration-200 ${
                docNotesExpanded ? "rotate-180" : ""
              }`}
            />
          </button>

          {docNotesExpanded && (
            <div className="mt-2 space-y-2">
              <Textarea
                placeholder={t("paperCard.addDocumentNotes")}
                value={docNotesValue}
                onChange={(e) => {
                  setDocNotesValue(e.target.value);
                  setDocNotesDirty(true);
                }}
                className="text-sm min-h-[80px] bg-transparent"
              />
              {docNotesDirty && (
                <div className="flex justify-end">
                  <Button size="xs" onClick={handleSaveDocNotes}>
                    {t("paperCard.saveNotes")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quellenangabe — unified paper metadata + bibliography source editing */}
        <CollapsibleSection icon={BookOpen} label={t("paperSummaryCard.sourceDetails")}>
          <PaperMetadataForm paperId={match.paperId} />
          <div className="mt-3 pt-3 border-t border-border/10">
            <SourceEditForm paperId={match.paperId} />
          </div>
        </CollapsibleSection>
          </>
        )}
      </div>
      {pdfPreviewOpen && paper && (
        <DocumentPreviewModal
          paper={paper}
          onClose={() => setPdfPreviewOpen(false)}
          onCite={triggerCitationFromPreview}
        />
      )}
    </div>
  );
}
