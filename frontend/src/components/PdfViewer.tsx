/**
 * PdfViewer — renders all pages of a PDF top-to-bottom so the user can
 * scroll through the document inside the DocumentPreviewModal Sheet.
 *
 * Uses react-pdf (pdfjs-dist under the hood). The pdfjs worker is pointed
 * at the bundled ESM worker via a Vite-compatible `new URL(...)` import so
 * it is automatically hashed and served as a static asset.
 */
import { useRef, useState, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure the pdfjs worker — must be set before any Document renders.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  /** Publicly accessible URL to the PDF file (e.g. Convex storage URL). */
  fileUrl: string;
}

/// Scrollable, all-pages PDF viewer with a loading skeleton and an error state.
export default function PdfViewer({ fileUrl }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(500);

  // Track the container width so pages fill the available horizontal space.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      // Subtract a small amount for the border/padding.
      setContainerWidth(Math.floor(entry.contentRect.width) - 4);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <p className="text-sm text-muted-foreground">
          Failed to load PDF.
        </p>
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-amber hover:text-amber/80 transition-colors underline underline-offset-2"
        >
          Open in new tab instead
        </a>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <Document
        file={fileUrl}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        onLoadError={() => setLoadError(true)}
        // Show an animated skeleton while the PDF is loading.
        loading={<PdfSkeleton />}
      >
        {numPages !== null
          ? Array.from({ length: numPages }, (_, i) => (
              <div key={i + 1} className="mb-2 last:mb-0">
                <Page
                  pageNumber={i + 1}
                  width={containerWidth}
                  // Suppress the per-page loading indicator — the document-level
                  // skeleton covers the initial load.
                  loading={null}
                  renderAnnotationLayer
                  renderTextLayer
                />
              </div>
            ))
          : null}
      </Document>
    </div>
  );
}

/// Animated placeholder shown while the PDF document is being fetched.
function PdfSkeleton() {
  return (
    <div className="space-y-3 py-4">
      {[80, 100, 90, 100, 75, 100, 85].map((w, i) => (
        <div
          key={i}
          className="h-3 bg-muted/30 rounded animate-pulse"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}
