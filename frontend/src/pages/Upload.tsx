import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import LanguageSelector from "@/components/LanguageSelector";

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { className: string; label: string }> = {
    pending: { className: "bg-gray-400 text-white", label: "Pending" },
    processing: {
      className: "bg-yellow-500 text-white animate-pulse",
      label: "Processing",
    },
    completed: { className: "bg-green-500 text-white", label: "Completed" },
    failed: { className: "bg-red-500 text-white", label: "Failed" },
  };
  const c = config[status] ?? config.pending;
  return <Badge className={`text-xs ${c.className}`}>{c.label}</Badge>;
}

export default function Upload() {
  const papers = useQuery(api.papers.listPapers) ?? [];
  const location = useLocation();

  useEffect(() => {
    if (location.hash) {
      // Small delay to ensure the DOM has rendered
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
        <h1 className="text-2xl font-bold">Upload & Configure</h1>
      </header>

      <div className="px-6 py-6 space-y-8 max-w-4xl">
        <section>
          <h2 className="text-xl font-semibold mb-4">Thesis Outline</h2>
          <OutlineEditor />
        </section>

        <Separator />

        <section id="upload">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Upload Papers</h2>
            <LanguageSelector />
          </div>
          <UploadZone />
        </section>

        <Separator />

        <section>
          <h2 className="text-xl font-semibold mb-4">
            All Papers ({papers.length})
          </h2>
          {papers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No papers uploaded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {papers.map((p) => (
                  <TableRow key={p._id}>
                    <TableCell className="font-medium">{p.title}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
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
