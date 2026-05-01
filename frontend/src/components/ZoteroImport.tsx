/**
 * Zotero library browser and paper import component.
 *
 * Lets the user browse their Zotero collections, select papers, and import
 * them with pre-filled metadata. PDFs are downloaded from Zotero when
 * available; otherwise the paper is created metadata-only and the user can
 * attach a PDF later.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Loader2 } from "lucide-react";
import { AISurfaceProgress } from "@/components/ai-progress";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useLanguage } from "@/lib/LanguageContext";
import { useProvider } from "@/lib/ProviderContext";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import type {
  ZoteroCollection,
  ZoteroItem,
  ZoteroImportResult,
} from "@/lib/types";

type LogEntry = {
  time: string;
  level: "info" | "ok" | "error" | "warn";
  message: string;
};

export default function ZoteroImport() {
  const { t } = useTranslation();

  // --- State ---
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null
  );
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [importing, setImporting] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  /// Item count + completed count drive the determinate progress bar
  /// and the secondary caption ("3 / 12 items"). Reset on every fresh
  /// import so a previous run's totals don't leak into the next.
  const [importProgress, setImportProgress] = useState({
    completed: 0,
    total: 0,
    currentLabel: "",
  });
  /// Live AbortController for the SSE reader. Set when an import starts,
  /// cleared when it settles or the user clicks Stop.
  const importAbortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const [deleteMenuKey, setDeleteMenuKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const { language } = useLanguage();
  const { provider } = useProvider();

  // Existing DOIs for duplicate detection
  const existingDOIs = useQuery(api.summaries.listAllDOIs) ?? [];
  const existingDOISet = new Set(existingDOIs.map((d) => d.doi.toLowerCase()));

  // Imported Zotero keys → paperId map for delete actions
  const zoteroKeys = useQuery(api.papers.listZoteroKeys) ?? [];
  const importedKeyMap = new Map(
    zoteroKeys.map((k) => [k.zoteroItemKey, k._id])
  );

  const deletePaper = useMutation(api.papers.deletePaper);

  // Existing outline sections for the /process pipeline
  const sections = useQuery(api.outline.listSections) ?? [];

  // --- Helpers ---

  function addLog(level: LogEntry["level"], message: string) {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { time, level, message }]);
    setShowLogs(true);
    setTimeout(
      () => logEndRef.current?.scrollIntoView({ behavior: "smooth" }),
      50
    );
  }

  // --- Fetch collections on mount ---

  const fetchCollections = useCallback(async () => {
    setLoadingCollections(true);
    setConfigError(null);
    try {
      const res = await fetch(`${PYTHON_SERVICE_URL}/zotero/collections`);
      if (res.status === 503 || res.status === 401) {
        const err = await res.json();
        setConfigError(err.detail);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCollections(data.collections ?? []);
    } catch (e) {
      setConfigError(`Could not connect to Zotero: ${e}`);
    } finally {
      setLoadingCollections(false);
    }
  }, []);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  // --- Fetch items when a collection is selected ---

  async function fetchItems(collectionKey: string | null) {
    setLoadingItems(true);
    setSelectedItems(new Set());
    try {
      const url = collectionKey
        ? `${PYTHON_SERVICE_URL}/zotero/items?collection=${collectionKey}`
        : `${PYTHON_SERVICE_URL}/zotero/items`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (e) {
      addLog("error", `Failed to load items: ${e}`);
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  }

  function handleCollectionClick(key: string | null) {
    setSelectedCollection(key);
    fetchItems(key);
  }

  // --- Toggle item selection ---

  function toggleItem(key: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map((i) => i.key)));
    }
  }

  // --- Delete imported items ---

  /// Removes an imported item from this project only.
  async function handleDeleteFromProject(zoteroItemKey: string) {
    const paperId = importedKeyMap.get(zoteroItemKey);
    if (!paperId) return;

    setDeletingKey(zoteroItemKey);
    try {
      await deletePaper({ paperId });
      toast.success(t("zoteroImport.removedFromProject"));
      setDeleteMenuKey(null);
    } catch (err) {
      toast.error(t("toast.deleteFailedMessage", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDeletingKey(null);
    }
  }

  /// Deletes an item from Zotero and then from this project.
  async function handleDeleteFromZotero(zoteroItemKey: string) {
    const paperId = importedKeyMap.get(zoteroItemKey);
    if (!paperId) return;

    setDeletingKey(zoteroItemKey);
    try {
      const res = await fetch(
        `${PYTHON_SERVICE_URL}/zotero/item/${zoteroItemKey}`,
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

      await deletePaper({ paperId });
      toast.success(t("toast.deletedFromZoteroAndProject"));
      setDeleteMenuKey(null);
    } catch (err) {
      toast.error(t("toast.deleteFailedMessage", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDeletingKey(null);
    }
  }

  // --- Import selected items ---

  async function handleImport() {
    const toImport = items.filter((i) => selectedItems.has(i.key));
    if (toImport.length === 0) return;

    setImporting(true);
    setShowLogs(true);
    setImportProgress({ completed: 0, total: toImport.length, currentLabel: "" });
    addLog("info", `Starting import of ${toImport.length} item(s)...`);

    // Build sections payload for the /process pipeline
    const sectionPayload = sections.map((s) => ({
      _id: s._id,
      orderNumber: s.orderNumber,
      title: s.title,
      notes: s.notes,
    }));

    // Fresh AbortController for this run. Stop button hits its `abort()`
    // which short-circuits both the underlying fetch and the SSE reader.
    importAbortRef.current?.abort();
    const controller = new AbortController();
    importAbortRef.current = controller;

    try {
      const res = await fetch(`${PYTHON_SERVICE_URL}/zotero/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          items: toImport,
          sections: sectionPayload,
          language,
          provider,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        addLog("error", `Import failed: ${err.detail}`);
        return;
      }

      // Read SSE stream for real-time per-step progress
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop()!; // keep incomplete chunk

        for (const part of parts) {
          const dataLine = part
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!dataLine) continue;

          try {
            const payload = JSON.parse(dataLine.slice(6));

            if (payload.type === "progress") {
              addLog("info", payload.message);
              // The backend emits a `progress` event per item with the
              // current label; surface it under the spinner so the user
              // sees what's being imported right now.
              if (typeof payload.message === "string") {
                setImportProgress((prev) => ({
                  ...prev,
                  currentLabel: payload.message,
                }));
              }
            } else if (payload.type === "item_complete") {
              const label =
                toImport.find((i) => i.key === payload.itemKey)?.title ??
                payload.itemKey;
              if (payload.status === "success") {
                addLog("ok", `Imported "${label}"`);
              } else {
                addLog("error", `Failed "${label}": ${payload.error}`);
              }
              setImportProgress((prev) => ({
                ...prev,
                completed: Math.min(prev.completed + 1, prev.total || 0),
              }));
            } else if (payload.type === "done") {
              addLog(
                payload.successCount === payload.totalCount ? "ok" : "warn",
                `Import complete: ${payload.successCount}/${payload.totalCount} succeeded`
              );
            }
          } catch {
            // Skip malformed SSE events
          }
        }
      }

      setSelectedItems(new Set());
    } catch (e) {
      // User-initiated abort lands silently with a friendly log line
      // rather than the generic "request failed" message.
      if (e instanceof DOMException && e.name === "AbortError") {
        addLog("warn", "Import stopped");
      } else {
        addLog("error", `Import request failed: ${e}`);
      }
    } finally {
      setImporting(false);
      if (importAbortRef.current === controller) importAbortRef.current = null;
    }
  }

  /// Aborts the in-flight import. Already-completed items remain in the
  /// project (no rollback) — mirrors how a user closing the page mid-run
  /// already behaves.
  function handleStopImport() {
    if (importAbortRef.current) {
      importAbortRef.current.abort();
      importAbortRef.current = null;
    }
  }

  // --- Render ---

  if (configError) {
    return (
      <div className="border border-dashed rounded-lg p-6 text-center text-muted-foreground">
        <p className="mb-2 font-medium">Zotero not connected</p>
        <p className="text-sm">{configError}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={fetchCollections}>
          Retry
        </Button>
      </div>
    );
  }

  if (loadingCollections) {
    return (
      <div className="border border-dashed rounded-lg p-6 text-center text-muted-foreground animate-pulse">
        Loading Zotero library...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Two-column browser */}
      <div className="border rounded-lg flex min-h-[350px] max-h-[500px]">
        {/* Left: Collections */}
        <div className="w-56 shrink-0 border-r overflow-y-auto p-2">
          <button
            onClick={() => handleCollectionClick(null)}
            className={`w-full text-left px-3 py-1.5 rounded text-sm ${
              selectedCollection === null
                ? "bg-primary/10 text-primary font-medium"
                : "hover:bg-muted"
            }`}
          >
            All Items
          </button>
          {collections.map((c) => (
            <button
              key={c.key}
              onClick={() => handleCollectionClick(c.key)}
              className={`w-full text-left px-3 py-1.5 rounded text-sm truncate ${
                selectedCollection === c.key
                  ? "bg-primary/10 text-primary font-medium"
                  : "hover:bg-muted"
              }`}
              title={c.name}
            >
              {c.name}
            </button>
          ))}
          {collections.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No collections found
            </p>
          )}
        </div>

        {/* Right: Items */}
        <div className="flex-1 overflow-y-auto">
          {loadingItems ? (
            <div className="flex items-center justify-center h-full text-muted-foreground animate-pulse">
              Loading items...
            </div>
          ) : items.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {selectedCollection === null && collections.length > 0
                ? "Select a collection or click 'All Items'"
                : "No items in this collection"}
            </div>
          ) : (
            <div>
              {/* Select all header */}
              <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b px-3 py-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedItems.size === items.length && items.length > 0}
                  onChange={toggleAll}
                  className="accent-primary"
                />
                <span className="text-xs text-muted-foreground">
                  {selectedItems.size > 0
                    ? `${selectedItems.size} selected`
                    : `${items.length} item(s)`}
                </span>
              </div>

              {/* Item rows */}
              {items.map((item) => {
                const isDuplicate =
                  item.doi && existingDOISet.has(item.doi.toLowerCase());
                const isImported = importedKeyMap.has(item.key);
                const isDeleting = deletingKey === item.key;
                const showMenu = deleteMenuKey === item.key;

                return (
                  <div
                    key={item.key}
                    className="flex items-start gap-3 px-3 py-2 hover:bg-muted/50 border-b last:border-b-0 relative"
                  >
                    <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedItems.has(item.key)}
                        onChange={() => toggleItem(item.key)}
                        className="accent-primary mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {item.title}
                          </span>
                          {item.hasPdf && (
                            <Badge className="text-[10px] bg-blue-500/20 text-blue-600 shrink-0">
                              PDF
                            </Badge>
                          )}
                          {isImported && (
                            <Badge className="text-[10px] bg-green-500/20 text-green-600 shrink-0">
                              {t("zoteroImport.imported")}
                            </Badge>
                          )}
                          {!isImported && isDuplicate && (
                            <Badge className="text-[10px] bg-amber-500/20 text-amber-600 shrink-0">
                              Already imported
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {item.authors.join("; ")}
                          {item.year ? ` (${item.year})` : ""}
                        </p>
                      </div>
                    </label>

                    {/* Delete actions for imported items */}
                    {isImported && (
                      <div className="relative shrink-0 mt-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteMenuKey(showMenu ? null : item.key);
                          }}
                          className="text-muted-foreground hover:text-destructive p-1 rounded-md hover:bg-muted/20 transition-colors"
                          title={t("common.delete")}
                        >
                          {isDeleting ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </button>

                        {showMenu && !isDeleting && (
                          <div className="absolute right-0 top-7 z-20 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[200px]">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteFromProject(item.key);
                              }}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 text-foreground"
                            >
                              {t("zoteroImport.removeFromProject")}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteFromZotero(item.key);
                              }}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-destructive/10 text-red-500"
                            >
                              {t("zoteroImport.deleteFromZotero")}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Import progress strip — visible while a Zotero import is in
          flight. Surfaces a determinate bar driven by item_complete SSE
          events plus a Stop button that aborts the underlying reader. */}
      {importing && (
        <AISurfaceProgress
          label={`Importing ${importProgress.completed} / ${importProgress.total} item(s)…`}
          detail={importProgress.currentLabel || undefined}
          progress={
            importProgress.total > 0
              ? importProgress.completed / importProgress.total
              : undefined
          }
          onStop={handleStopImport}
          stopLabel="Stop import"
        />
      )}

      {/* Import button */}
      <div className="flex items-center justify-between">
        <Button
          onClick={handleImport}
          disabled={selectedItems.size === 0 || importing}
          className="gap-2"
        >
          {importing ? "Importing..." : `Import ${selectedItems.size} item(s)`}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowLogs((v) => !v)}>
          {showLogs ? "Hide log" : "Show log"}
        </Button>
      </div>

      {/* Log panel */}
      {showLogs && (
        <div className="bg-muted/30 border rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-0.5">
          {logs.length === 0 && (
            <p className="text-muted-foreground">No activity yet</p>
          )}
          {logs.map((log, i) => (
            <div
              key={i}
              className={
                log.level === "error"
                  ? "text-red-500"
                  : log.level === "ok"
                    ? "text-green-500"
                    : log.level === "warn"
                      ? "text-amber-500"
                      : "text-muted-foreground"
              }
            >
              <span className="opacity-60">[{log.time}]</span> {log.message}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}
