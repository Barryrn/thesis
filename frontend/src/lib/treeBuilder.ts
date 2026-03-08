import type { OutlineSection, SectionTreeNode, SectionId } from "./types";

export function buildSectionTree(
  sections: OutlineSection[]
): SectionTreeNode[] {
  const nodeMap = new Map<SectionId, SectionTreeNode>();
  const roots: SectionTreeNode[] = [];

  for (const section of sections) {
    nodeMap.set(section._id, { ...section, children: [] });
  }

  for (const section of sections) {
    const node = nodeMap.get(section._id)!;
    if (section.parentId && nodeMap.has(section.parentId)) {
      nodeMap.get(section.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (nodes: SectionTreeNode[]) => {
    nodes.sort((a, b) =>
      a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true })
    );
    for (const node of nodes) {
      sortChildren(node.children);
    }
  };
  sortChildren(roots);

  return roots;
}
