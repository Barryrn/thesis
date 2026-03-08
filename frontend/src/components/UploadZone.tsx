import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/lib/LanguageContext";
import type { UploadFileState } from "@/lib/types";

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt"];

const MAX_FOLDER_FILES = 50;
const PYTHON_SERVICE_URL = "http://localhost:8000";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusBadge(status: UploadFileState["status"]) {
  switch (status) {
    case "queued":
      return { label: "Queued", className: "bg-gray-400 text-white" };
    case "uploading":
      return {
        label: "Uploading",
        className: "bg-blue-500 text-white animate-pulse",
      };
    case "creating":
      return { label: "Creating", className: "bg-blue-500 text-white" };
    case "triggering":
      return {
        label: "Processing",
        className: "bg-yellow-500 text-white animate-pulse",
      };
    case "done":
      return { label: "Done", className: "bg-green-500 text-white" };
    case "error":
      return { label: "Failed", className: "bg-red-500 text-white" };
  }
}

function isAcceptedFile(file: File): boolean {
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  return ACCEPTED_EXTENSIONS.includes(ext);
}

/** Recursively collect all files from dropped folder entries, with a file count limit. */
async function collectFilesFromEntries(
  entries: FileSystemEntry[],
  limit = MAX_FOLDER_FILES
): Promise<{ files: File[]; truncated: boolean }> {
  const files: File[] = [];
  let truncated = false;

  async function traverse(entry: FileSystemEntry) {
    if (files.length >= limit) {
      truncated = true;
      return;
    }
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      if (isAcceptedFile(file) && files.length < limit) {
        files.push(file);
      }
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const allChildren: FileSystemEntry[] = [];
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>(
          (resolve, reject) => reader.readEntries(resolve, reject)
        );
        allChildren.push(...batch);
      } while (batch.length > 0 && files.length < limit);
      for (const child of allChildren) {
        if (files.length >= limit) {
          truncated = true;
          break;
        }
        await traverse(child);
      }
    }
  }

  for (const entry of entries) {
    if (files.length >= limit) break;
    await traverse(entry);
  }
  return { files, truncated };
}

const MAX_CONCURRENT = 2;

type LogEntry = {
  time: string;
  level: "info" | "ok" | "error" | "warn";
  message: string;
};

export default function UploadZone() {
  const [files, setFiles] = useState<UploadFileState[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const generateUploadUrl = useMutation(api.papers.generateUploadUrl);
  const createPaper = useMutation(api.papers.createPaper);
  const updatePaperStatus = useMutation(api.papers.updatePaperStatus);
  const convexClient = useConvex();
  const { language } = useLanguage();

  function addLog(level: LogEntry["level"], message: string) {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { time, level, message }]);
    setShowLogs(true);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  const papers = useQuery(api.papers.listPapers) ?? [];

  // Track backend status changes and surface them in logs
  const prevStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const trackedStorageIds = new Set(
      files.filter((f) => f.storageId).map((f) => f.storageId!)
    );
    if (trackedStorageIds.size === 0) return;

    for (const paper of papers) {
      if (!trackedStorageIds.has(paper.storageId)) continue;

      const prev = prevStatusRef.current[paper._id];
      const curr = paper.status;
      if (prev === curr) continue;

      prevStatusRef.current[paper._id] = curr;
      // Skip the initial "pending" → "processing" since frontend already logs that
      if (!prev) continue;

      if (curr === "completed") {
        addLog("ok", `[Backend] "${paper.title}" processing completed successfully`);
      } else if (curr === "failed") {
        const errMsg = (paper as any).errorMessage || "Unknown backend error";
        addLog("error", `[Backend] "${paper.title}" processing failed: ${errMsg}`);
      } else if (curr === "processing" && prev !== "processing") {
        addLog("info", `[Backend] "${paper.title}" is being processed by Python service...`);
      }
    }
  }, [papers, files]);

  function updateFileStatus(
    file: File,
    status: UploadFileState["status"],
    extra?: Partial<UploadFileState>
  ) {
    setFiles((prev) =>
      prev.map((f) =>
        f.file === file ? { ...f, status, ...extra } : f
      )
    );
  }

  async function uploadFile(entry: UploadFileState) {
    const { file } = entry;
    try {
      // Step 1: Generate upload URL
      updateFileStatus(file, "uploading");
      addLog("info", `[${file.name}] Step 1/5: Generating upload URL...`);
      let uploadUrl: string;
      try {
        uploadUrl = await generateUploadUrl();
        addLog("ok", `[${file.name}] Step 1/5: Upload URL generated`);
      } catch (err) {
        addLog("error", `[${file.name}] Step 1/5 FAILED: ${(err as Error).message}`);
        throw new Error(`Generate upload URL failed: ${(err as Error).message}`);
      }

      // Step 2: Upload file to Convex storage
      addLog("info", `[${file.name}] Step 2/5: Uploading file (${formatFileSize(file.size)}, type: ${file.type || "unknown"})...`);
      let storageId: string;
      try {
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });
        if (!uploadResponse.ok) {
          const body = await uploadResponse.text().catch(() => "");
          addLog("error", `[${file.name}] Step 2/5 FAILED: HTTP ${uploadResponse.status} ${uploadResponse.statusText} ${body}`);
          throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
        }
        const result = await uploadResponse.json();
        storageId = result.storageId;
        addLog("ok", `[${file.name}] Step 2/5: File uploaded (storageId: ${storageId})`);
      } catch (err) {
        if ((err as Error).message.startsWith("Upload failed:")) throw err;
        addLog("error", `[${file.name}] Step 2/5 FAILED: Network error — ${(err as Error).message}`);
        throw new Error(`File upload network error: ${(err as Error).message}`);
      }

      // Step 3: Resolve file URL
      updateFileStatus(file, "creating", { storageId });
      addLog("info", `[${file.name}] Step 3/5: Resolving file URL...`);
      let fileUrl = await convexClient.query(api.papers.getFileUrl, {
        storageId,
      });
      if (!fileUrl) {
        addLog("warn", `[${file.name}] Step 3/5: File URL not ready, retrying in 500ms...`);
        await new Promise((r) => setTimeout(r, 500));
        fileUrl = await convexClient.query(api.papers.getFileUrl, {
          storageId,
        });
      }
      if (!fileUrl) {
        addLog("error", `[${file.name}] Step 3/5 FAILED: File URL is null after retry`);
        throw new Error("Failed to resolve file URL after retry");
      }
      addLog("ok", `[${file.name}] Step 3/5: File URL resolved`);

      // Step 4: Create paper record
      addLog("info", `[${file.name}] Step 4/5: Creating paper record...`);
      const paperId = await createPaper({
        title: file.name,
        authors: [],
        storageId,
        fileUrl,
      });
      addLog("ok", `[${file.name}] Step 4/5: Paper created (id: ${paperId})`);

      // Step 5: Send to Python service for processing
      updateFileStatus(file, "triggering", { paperId });
      addLog("info", `[${file.name}] Step 5/5: Sending to Python service at ${PYTHON_SERVICE_URL}...`);
      try {
        // Update status to processing in Convex
        await updatePaperStatus({ paperId, status: "processing" });

        // Fetch outline sections to send along
        const sections = await convexClient.query(api.outline.listSections, {});
        const sectionData = sections.map((s: any) => ({
          _id: s._id,
          orderNumber: s.orderNumber,
          title: s.title,
          notes: s.notes || "",
        }));

        const pyResponse = await fetch(`${PYTHON_SERVICE_URL}/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paperId, fileUrl, sections: sectionData, fileName: file.name, language }),
        });
        if (!pyResponse.ok) {
          let detail = `HTTP ${pyResponse.status}`;
          try {
            const body = await pyResponse.json();
            detail = body.detail || JSON.stringify(body);
          } catch {
            // ignore parse errors
          }
          addLog("error", `[${file.name}] Step 5/5 FAILED: Python error — ${detail}`);
          throw new Error(`Python processing failed: ${detail}`);
        }
        addLog("ok", `[${file.name}] Step 5/5: Python processing complete`);
      } catch (err) {
        if ((err as Error).message.startsWith("Python processing failed:")) throw err;
        addLog("error", `[${file.name}] Step 5/5 FAILED: ${(err as Error).message}`);
        throw new Error(`Python service error: ${(err as Error).message}`);
      }

      updateFileStatus(file, "done", { paperId });
      addLog("ok", `[${file.name}] All steps complete`);
    } catch (err) {
      addLog("error", `[${file.name}] FAILED: ${(err as Error).message}`);
      updateFileStatus(file, "error", {
        error: (err as Error).message,
      });
    }
  }

  async function processQueue(entries: UploadFileState[]) {
    const queue = [...entries];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      while (active.length < MAX_CONCURRENT && queue.length > 0) {
        const entry = queue.shift()!;
        const promise = uploadFile(entry).then(() => {
          active.splice(active.indexOf(promise), 1);
        });
        active.push(promise);
      }
      if (active.length > 0) await Promise.race(active);
    }
  }

  function handleFiles(fileList: FileList | File[], fromFolder = false) {
    const accepted = Array.from(fileList).filter(isAcceptedFile);
    if (accepted.length === 0) {
      if (fromFolder) {
        addLog("warn", "Folder contained no accepted files (.pdf, .docx, .txt)");
      } else if (fileList.length > 0) {
        addLog("warn", `${fileList.length} file(s) skipped — only .pdf, .docx, and .txt are accepted`);
      }
      return;
    }

    if (fromFolder) {
      const total = Array.from(fileList).length;
      const skipped = total - accepted.length;
      addLog("info", `Folder scan: ${accepted.length} accepted file(s)${skipped > 0 ? `, ${skipped} skipped` : ""}`);
    }

    const newEntries: UploadFileState[] = accepted.map((file) => ({
      file,
      status: "queued" as const,
    }));
    setFiles((prev) => [...prev, ...newEntries]);

    processQueue(newEntries);
  }

  function getLiveStatus(entry: UploadFileState) {
    if (entry.status === "done" && entry.storageId) {
      const match = papers.find((p) => p.storageId === entry.storageId);
      if (match) {
        return match.status;
      }
    }
    return null;
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragActive(false);
          // Collect all entries once — some browsers only allow one webkitGetAsEntry() call per item
          const entries: FileSystemEntry[] = [];
          for (let i = 0; i < e.dataTransfer.items.length; i++) {
            const entry = e.dataTransfer.items[i].webkitGetAsEntry?.();
            if (entry) entries.push(entry);
          }
          const hasDirectory = entries.some((entry) => entry.isDirectory);
          if (hasDirectory) {
            const { files: collectedFiles, truncated } = await collectFilesFromEntries(entries);
            if (truncated) {
              addLog("warn", `Folder contained more than ${MAX_FOLDER_FILES} accepted files — only the first ${MAX_FOLDER_FILES} will be uploaded`);
            }
            handleFiles(collectedFiles, true);
          } else {
            handleFiles(e.dataTransfer.files);
          }
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
          dragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is not in the TS types
          webkitdirectory=""
          directory=""
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files, true);
            e.target.value = "";
          }}
        />
        <p className="text-muted-foreground font-medium">
          Drop PDF, DOCX, or TXT files — or an entire folder
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          click to browse files, or{" "}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              folderInputRef.current?.click();
            }}
            className="underline hover:text-foreground transition-colors"
          >
            select a folder
          </button>
        </p>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((entry, i) => {
            const statusInfo = getStatusBadge(entry.status);
            const liveStatus = getLiveStatus(entry);
            return (
              <div
                key={i}
                className="flex items-center justify-between p-3 border rounded-lg bg-card"
              >
                <div className="min-w-0 flex-1 mr-3">
                  <p className="text-sm font-medium truncate">
                    {entry.file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(entry.file.size)}
                  </p>
                  {entry.error && (
                    <p className="text-xs text-red-500 mt-1">{entry.error}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {liveStatus && liveStatus !== "pending" && (
                    <Badge
                      className={`text-xs ${
                        liveStatus === "completed"
                          ? "bg-green-500 text-white"
                          : liveStatus === "processing"
                            ? "bg-yellow-500 text-white animate-pulse"
                            : liveStatus === "failed"
                              ? "bg-red-500 text-white"
                              : "bg-gray-400 text-white"
                      }`}
                    >
                      {liveStatus.charAt(0).toUpperCase() +
                        liveStatus.slice(1)}
                    </Badge>
                  )}
                  {!liveStatus && (
                    <Badge className={`text-xs ${statusInfo.className}`}>
                      {statusInfo.label}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {logs.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowLogs((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted transition-colors text-sm font-medium"
          >
            <span className="flex items-center gap-2">
              Upload Logs
              {logs.some((l) => l.level === "error") && (
                <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
              )}
            </span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{logs.length} entries</span>
              <span className="text-muted-foreground">{showLogs ? "\u25B2" : "\u25BC"}</span>
            </span>
          </button>
          {showLogs && (
            <div className="max-h-64 overflow-y-auto bg-zinc-950 p-3 font-mono text-xs leading-relaxed">
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={`${
                    log.level === "error"
                      ? "text-red-400"
                      : log.level === "ok"
                        ? "text-green-400"
                        : log.level === "warn"
                          ? "text-yellow-400"
                          : "text-zinc-400"
                  }`}
                >
                  <span className="text-zinc-600 mr-2">{log.time}</span>
                  <span className="mr-2">
                    {log.level === "error" ? "\u2718" : log.level === "ok" ? "\u2714" : log.level === "warn" ? "\u26A0" : "\u25B6"}
                  </span>
                  {log.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
          {showLogs && (
            <div className="flex justify-end px-3 py-1.5 bg-muted/50 border-t">
              <button
                onClick={() => { setLogs([]); setShowLogs(false); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear logs
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
