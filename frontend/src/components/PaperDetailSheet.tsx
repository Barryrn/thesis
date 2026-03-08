import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import {
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { PaperId } from "@/lib/types";

interface PaperDetailSheetProps {
  paperId: PaperId;
  title: string;
  authors: string[];
  year?: number;
}

export default function PaperDetailSheet({
  paperId,
  title,
  authors,
  year,
}: PaperDetailSheetProps) {
  const summary = useQuery(api.summaries.getSummaryByPaper, { paperId });
  const identifiers = useQuery(api.summaries.getIdentifiersByPaper, {
    paperId,
  });

  return (
    <SheetContent className="overflow-y-auto w-full sm:max-w-lg">
      <SheetHeader>
        <SheetTitle className="text-lg">{title}</SheetTitle>
        <SheetDescription>
          {authors.length > 0 ? authors.join(", ") : "Unknown authors"}
          {year && ` (${year})`}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-6">
        {identifiers && identifiers.length > 0 && (
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Identifiers
            </h3>
            <div className="space-y-1">
              {identifiers.map((id) => (
                <div key={id._id} className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className="text-xs">
                    {id.identifierType}
                  </Badge>
                  <span className="break-all">{id.identifierValue}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {summary === undefined && (
          <div className="text-sm text-muted-foreground">
            Loading summary...
          </div>
        )}

        {summary === null && (
          <div className="text-sm text-muted-foreground">
            Paper has not been processed yet.
          </div>
        )}

        {summary && (
          <>
            {summary.keywords.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Keywords
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {summary.keywords.map((kw) => (
                    <Badge key={kw} variant="secondary" className="text-xs">
                      {kw}
                    </Badge>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                Research Question
              </h3>
              <p className="text-sm">{summary.researchQuestion}</p>
            </section>

            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                Methodology
              </h3>
              <p className="text-sm">{summary.methodology}</p>
            </section>

            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                Key Findings
              </h3>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {summary.keyFindings.map((finding, i) => (
                  <li key={i}>{finding}</li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </SheetContent>
  );
}
