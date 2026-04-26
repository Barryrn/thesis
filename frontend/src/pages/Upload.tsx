import { Link, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PYTHON_SERVICE_URL } from "@/lib/config";
import type { ZoteroCollection } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import OutlineEditor from "@/components/OutlineEditor";
import UploadZone from "@/components/UploadZone";
import ZoteroImport from "@/components/ZoteroImport";
import LanguageSelector from "@/components/LanguageSelector";
import ProviderToggle from "@/components/ProviderToggle";
import { PROCESSING_STEP_LABELS } from "@/lib/types";

function StatusBadge({
  status,
  processingStep,
}: {
  status: string;
  processingStep?: string;
}) {
  const { t } = useTranslation();

  // Show the specific pipeline step when processing
  if (status === "processing" && processingStep) {
    const stepLabel = PROCESSING_STEP_LABELS[processingStep] ?? t("upload.statusProcessing");
    return (
      <Badge className="text-xs bg-yellow-500 text-white animate-pulse">
        {stepLabel}
      </Badge>
    );
  }

  const config: Record<string, { className: string; label: string }> = {
    pending: { className: "bg-gray-400 text-white", label: t("upload.statusPending") },
    processing: {
      className: "bg-yellow-500 text-white animate-pulse",
      label: t("upload.statusProcessing"),
    },
    completed: { className: "bg-green-500 text-white", label: t("upload.statusCompleted") },
    failed: { className: "bg-red-500 text-white", label: t("upload.statusFailed") },
  };
  const c = config[status] ?? config.pending;
  return <Badge className={`text-xs ${c.className}`}>{c.label}</Badge>;
}

export default function Upload() {
  const { t } = useTranslation();
  const papers = useQuery(api.papers.listPapers) ?? [];
  const location = useLocation();

  // Zotero collection picker state
  const [zoteroCollections, setZoteroCollections] = useState<ZoteroCollection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>("");

  const fetchCollections = useCallback(async () => {
    try {
      const res = await fetch(`${PYTHON_SERVICE_URL}/zotero/collections`);
      if (res.ok) {
        const data = await res.json();
        setZoteroCollections(data.collections ?? []);
      }
    } catch {
      // Zotero not configured — picker stays empty
    }
  }, []);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  useEffect(() => {
    if (location.hash) {
      const timer = setTimeout(() => {
        const el = document.querySelector(location.hash);
        el?.scrollIntoView({ behavior: "smooth" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [location.hash]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b px-6 py-4 flex items-center gap-4 bg-background/80 backdrop-blur-sm">
        <Link to="/">
          <Button variant="ghost" size="sm">
            &larr; Back
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">{t("upload.title")}</h1>
      </header>

      <div className="px-6 py-6 space-y-8 max-w-4xl">
        <section>
          <h2 className="text-xl font-semibold mb-4">{t("upload.thesisOutline")}</h2>
          <OutlineEditor />
        </section>

        <Separator />

        <section id="upload">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">{t("upload.uploadPapers")}</h2>
            <div className="flex items-center gap-2">
              {zoteroCollections.length > 0 && (
                <select
                  value={selectedCollection}
                  onChange={(e) => setSelectedCollection(e.target.value)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  title="Zotero collection for uploaded papers"
                >
                  <option value="">{t("upload.zoteroNoCollection")}</option>
                  {zoteroCollections.map((c) => (
                    <option key={c.key} value={c.key}>
                      {t("upload.zoteroCollection", { name: c.name })}
                    </option>
                  ))}
                </select>
              )}
              <ProviderToggle />
              <LanguageSelector />
            </div>
          </div>
          <UploadZone zoteroCollection={selectedCollection || undefined} />
        </section>

        <Separator />

        <section id="zotero">
          <h2 className="text-xl font-semibold mb-4">{t("upload.importFromZotero")}</h2>
          <ZoteroImport />
        </section>

        <Separator />

        <section>
          <h2 className="text-xl font-semibold mb-4">
            {t("upload.allPapers", { count: papers.length })}
          </h2>
          {papers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("upload.noPapersYet")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("upload.tableTitle")}</TableHead>
                  <TableHead>{t("upload.tableStatus")}</TableHead>
                  <TableHead>{t("upload.tableYear")}</TableHead>
                  <TableHead>{t("upload.tableUploaded")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {papers.map((p) => (
                  <TableRow key={p._id}>
                    <TableCell className="font-medium">{p.title}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} processingStep={p.processingStep} />
                    </TableCell>
                    <TableCell>{p.year ?? "\u2014"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(p.uploadedAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </div>
    </div>
  );
}
