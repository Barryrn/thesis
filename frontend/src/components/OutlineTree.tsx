import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { buildSectionTree } from "@/lib/treeBuilder";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import SectionNode from "./SectionNode";

export default function OutlineTree() {
  const sections = useQuery(api.outline.listSections) ?? [];

  const tree = useMemo(() => buildSectionTree(sections), [sections]);

  if (sections.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="font-medium">No outline sections yet</p>
        <p className="text-sm mt-1">
          Paste your thesis outline in the Upload page
        </p>
        <Link to="/upload">
          <Button variant="outline" size="sm" className="mt-3">
            <Pencil className="size-4 mr-1" /> Edit Outline
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <SectionNode key={node._id} node={node} depth={0} />
      ))}
    </div>
  );
}
