import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  ImagePlus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Type,
  AlertTriangle,
} from "lucide-react";
import { findOrphanedMarkers } from "@/lib/figureUtils";
import type { Id } from "../../convex/_generated/dataModel";

/// Max file size for figure uploads (10 MB).
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface FigurePanelProps {
  sectionId: Id<"outlineSections">;
  body: string;
  onInsertMarker: (figureId: string) => void;
}

/// Collapsible panel for managing figures within a section.
/// Allows uploading, captioning, reordering, and inserting figure markers.
export default function FigurePanel({
  sectionId,
  body,
  onInsertMarker,
}: FigurePanelProps) {
  const { t } = useTranslation();
  const figures = useQuery(api.figures.getFiguresBySection, { sectionId }) ?? [];
  const uploadFigure = useMutation(api.figures.uploadFigure);
  const updateCaption = useMutation(api.figures.updateFigureCaption);
  const deleteFigure = useMutation(api.figures.deleteFigure);
  const generateUploadUrl = useMutation(api.figures.generateUploadUrl);

  const [expanded, setExpanded] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");

  // Detect orphaned figure markers in the body
  const knownIds = new Set(figures.map((f) => f._id));
  const orphanedIds = findOrphanedMarkers(body, knownIds);

  /// Handles file selection and upload to Convex storage.
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > MAX_FILE_SIZE) {
        alert(t("figurePanel.fileTooLarge"));
        return;
      }

      if (!file.type.startsWith("image/")) {
        alert(t("figurePanel.onlyImages"));
        return;
      }

      setUploading(true);
      try {
        // Get upload URL from Convex
        const url = await generateUploadUrl();

        // Upload the file
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        const { storageId } = await response.json();

        // Create the figure record
        await uploadFigure({
          sectionId,
          storageId,
          caption: file.name.replace(/\.[^.]+$/, ""),
        });
      } catch (err) {
        console.error("[FIGURE] Upload failed:", err);
      } finally {
        setUploading(false);
        // Reset input so the same file can be re-selected
        e.target.value = "";
      }
    },
    [sectionId, generateUploadUrl, uploadFigure]
  );

  /// Saves an edited caption.
  const handleSaveCaption = useCallback(
    async (figureId: Id<"figures">) => {
      await updateCaption({ figureId, caption: captionDraft });
      setEditingCaption(null);
    },
    [captionDraft, updateCaption]
  );

  /// Deletes a figure after confirmation.
  const handleDelete = useCallback(
    async (figureId: Id<"figures">) => {
      if (!confirm(t("figurePanel.deleteConfirm"))) return;
      await deleteFigure({ figureId });
    },
    [deleteFigure]
  );

  return (
    <div className="rounded-lg border border-border/30 bg-muted/10">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-[11px] font-medium text-amber-dim uppercase tracking-wider flex items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {t("figurePanel.figures", { count: figures.length })}
        </span>
        <label
          className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-amber hover:bg-amber/10 transition-colors flex items-center gap-1 cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <ImagePlus className="size-3" />
          {uploading ? t("figurePanel.uploading") : t("figurePanel.upload")}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
            disabled={uploading}
          />
        </label>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {/* Orphan warning */}
          {orphanedIds.length > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-amber/5 border border-amber/20">
              <AlertTriangle className="size-3 text-amber" />
              <span className="text-[10px] text-amber-dim">
                {t("figurePanel.orphanedWarning", { count: orphanedIds.length })}
              </span>
            </div>
          )}

          {figures.length === 0 && !uploading && (
            <p className="text-xs text-muted-foreground/60 py-2">
              {t("figurePanel.noFigures")}
            </p>
          )}

          {figures.map((fig) => (
            <div
              key={fig._id}
              className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/20 transition-colors group"
            >
              {/* Thumbnail */}
              {fig.url ? (
                <img
                  src={fig.url}
                  alt={fig.caption}
                  className="size-12 rounded object-cover shrink-0 border border-border/30"
                />
              ) : (
                <div className="size-12 rounded bg-muted/30 shrink-0" />
              )}

              {/* Caption + actions */}
              <div className="flex-1 min-w-0">
                {editingCaption === fig._id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={captionDraft}
                      onChange={(e) => setCaptionDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveCaption(fig._id);
                        if (e.key === "Escape") setEditingCaption(null);
                      }}
                      className="flex-1 text-xs bg-transparent border-b border-amber/30 focus:outline-none text-foreground/90 py-0.5"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveCaption(fig._id)}
                      className="text-[10px] text-amber hover:text-amber/80"
                    >
                      {t("common.save")}
                    </button>
                  </div>
                ) : (
                  <p
                    className="text-xs text-foreground/80 truncate cursor-pointer hover:text-foreground"
                    onClick={() => {
                      setEditingCaption(fig._id);
                      setCaptionDraft(fig.caption);
                    }}
                    title="Click to edit caption"
                  >
                    {fig.caption || "Untitled figure"}
                  </p>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onInsertMarker(fig._id)}
                    className="text-[10px] text-muted-foreground hover:text-amber flex items-center gap-0.5"
                    title="Insert marker at cursor"
                  >
                    <Type className="size-2.5" />
                    {t("figurePanel.insertMarker")}
                  </button>
                  <button
                    onClick={() => {
                      setEditingCaption(fig._id);
                      setCaptionDraft(fig.caption);
                    }}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    {t("figurePanel.caption")}
                  </button>
                  <button
                    onClick={() => handleDelete(fig._id)}
                    className="text-[10px] text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="size-2.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
