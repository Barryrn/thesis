import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { toast } from "sonner";
import {
  parseOutline,
  serializeOutline,
  buildEditableTree,
  flattenEditableTree,
  renumberTree,
  findNode,
  removeNode,
} from "@/lib/outlineParser";
import type { EditableSectionNode } from "@/lib/types";
import OutlineTextInput from "./OutlineTextInput";
import OutlineTreePreview from "./OutlineTreePreview";
import OutlineFormatGuide from "./OutlineFormatGuide";

export default function OutlineEditor() {
  const [rawText, setRawText] = useState("");
  const [editableTree, setEditableTree] = useState<EditableSectionNode[]>([]);
  const [sectionCount, setSectionCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const syncSourceRef = useRef<"text" | "tree" | null>(null);
  const loadedRef = useRef(false);

  const existingSections = useQuery(api.outline.listSections);
  const upsertSections = useMutation(api.outline.upsertOutlineSections);

  // Load existing sections on first render
  useEffect(() => {
    if (
      existingSections &&
      existingSections.length > 0 &&
      !loadedRef.current &&
      !rawText.trim()
    ) {
      loadedRef.current = true;
      const sorted = [...existingSections].sort((a, b) =>
        a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true })
      );
      const text = sorted
        .map((s) => {
          let line = `${s.orderNumber} ${s.title}`;
          if (s.notes) {
            line += `\n/* ${s.notes} */`;
          }
          return line;
        })
        .join("\n");
      setRawText(text);
    }
  }, [existingSections]);

  // Text -> Tree sync (debounced)
  useEffect(() => {
    if (syncSourceRef.current === "tree") {
      syncSourceRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      const parsed = parseOutline(rawText);
      setSectionCount(parsed.length);
      setEditableTree(buildEditableTree(parsed));
    }, 300);
    return () => clearTimeout(timer);
  }, [rawText]);

  // Tree -> Text sync (immediate)
  function syncTreeToText(newTree: EditableSectionNode[]) {
    syncSourceRef.current = "tree";
    const renumbered = renumberTree(structuredClone(newTree));
    const flat = flattenEditableTree(renumbered);
    setRawText(serializeOutline(flat));
    setSectionCount(flat.length);
    setEditableTree(renumbered);
  }

  function handleAddSection(parentOrderNumber?: string) {
    const newTree = structuredClone(editableTree);
    if (!parentOrderNumber) {
      newTree.push({
        id: crypto.randomUUID(),
        title: "New Section",
        orderNumber: String(newTree.length + 1),
        depth: 1,
        children: [],
      });
    } else {
      const parent = findNode(newTree, parentOrderNumber);
      if (parent) {
        parent.children.push({
          id: crypto.randomUUID(),
          title: "New Subsection",
          orderNumber: `${parentOrderNumber}.${parent.children.length + 1}`,
          depth: parent.depth + 1,
          parentOrderNumber,
          children: [],
        });
      }
    }
    syncTreeToText(newTree);
  }

  function handleRemoveSection(orderNumber: string) {
    const newTree = removeNode(structuredClone(editableTree), orderNumber);
    syncTreeToText(newTree);
  }

  function handleRenameSection(orderNumber: string, newTitle: string) {
    const newTree = structuredClone(editableTree);
    const node = findNode(newTree, orderNumber);
    if (node) node.title = newTitle;
    syncTreeToText(newTree);
  }

  function handleReorder(newTree: EditableSectionNode[]) {
    syncTreeToText(newTree);
  }

  async function handleSave() {
    const sections = parseOutline(rawText);
    if (sections.length === 0) {
      toast.error("No valid sections found. Format: '1.2.3 Section Title'");
      return;
    }
    setSaving(true);
    try {
      const count = await upsertSections({
        sections: sections.map(
          ({ title, orderNumber, depth, parentOrderNumber, notes }) => ({
            title,
            orderNumber,
            depth,
            parentOrderNumber,
            notes,
          })
        ),
        version: 1,
      });
      toast.success(`Saved ${count} sections`);
    } catch (err) {
      toast.error(`Failed to save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {showGuide && <OutlineFormatGuide onClose={() => setShowGuide(false)} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <OutlineTextInput value={rawText} onChange={setRawText} />
        <OutlineTreePreview
          tree={editableTree}
          onAddSection={handleAddSection}
          onRemoveSection={handleRemoveSection}
          onRenameSection={handleRenameSection}
          onReorder={handleReorder}
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rawText.trim()
            ? `${sectionCount} section${sectionCount !== 1 ? "s" : ""} detected`
            : "Paste your numbered thesis outline above"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowGuide(!showGuide)}
          >
            <HelpCircle className="size-4 mr-1" /> Format Guide
          </Button>
          <Button onClick={handleSave} disabled={saving || !rawText.trim()}>
            {saving ? "Saving..." : "Save Outline"}
          </Button>
        </div>
      </div>
    </div>
  );
}
