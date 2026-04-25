/**
 * Zotero library browser and paper import component.
 *
 * Lets the user browse their Zotero collections, select papers, and import
 * them with pre-filled metadata. PDFs are downloaded from Zotero when
 * available; otherwise the paper is created metadata-only and the user can
 * attach a PDF later.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const logEndRef = useRef<HTMLDivElement>(null);

  const { language } = useLanguage();
  const { provider } = useProvider();

  // Existing DOIs for duplicate detection
  const existingDOIs = useQuery(api.summaries.listAllDOIs) ?? [];
  const existingDOISet = new Set(existingDOIs.map((d) => d.doi.toLowerCase()));

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

  // --- Import selected items ---

  async function handleImport() {
    const toImport = items.filter((i) => selectedItems.has(i.key));
    if (toImport.length === 0) return;

    setImporting(true);
    setShowLogs(true);
    addLog("info", `Starting import of ${toImport.length} item(s)...`);

    // Build sections payload for the /process pipeline
    const sectionPayload = sections.map((s) => ({
      _id: s._id,
      orderNumber: s.orderNumber,
      title: s.title,
      notes: s.notes,
    }));

    try {
      const res = await fetch(`${PYTHON_SERVICE_URL}/zotero/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
            } else if (payload.type === "item_complete") {
              const label =
                toImport.find((i) => i.key === payload.itemKey)?.title ??
                payload.itemKey;
              if (payload.status === "success") {
                addLog("ok", `Imported "${label}"`);
              } else {
                addLog("error", `Failed "${label}": ${payload.error}`);
              }
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
      addLog("error", `Import request failed: ${e}`);
    } finally {
      setImporting(false);
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
                return (
                  <label
                    key={item.key}
                    className="flex items-start gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer border-b last:border-b-0"
                  >
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
                        {isDuplicate && (
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
                );
              })}
            </div>
          )}
        </div>
      </div>

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
