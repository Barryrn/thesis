import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import PaperCard from "./PaperCard";
import type { SectionId } from "@/lib/types";

interface SectionPapersProps {
  sectionId: SectionId;
}

export default function SectionPapers({ sectionId }: SectionPapersProps) {
  const matches = useQuery(api.matches.getMatchesBySection, { sectionId });

  if (matches === undefined) {
    return (
      <div className="pl-6 py-1 text-xs text-muted-foreground">Loading...</div>
    );
  }

  if (matches.length === 0) {
    return null;
  }

  return (
    <div className="pl-6 pt-1 space-y-1">
      {matches.map((m) => (
        <PaperCard
          key={m.paperId}
          paperId={m.paperId}
          title={m.title}
          authors={m.authors}
          year={m.year}
          relevanceScore={m.relevanceScore}
          isManualOverride={m.isManualOverride}
          isDraggable
          sourceSectionId={sectionId}
        />
      ))}
    </div>
  );
}
