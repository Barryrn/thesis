import type { ParsedSection, EditableSectionNode } from "./types";

export function parseOutline(raw: string): ParsedSection[] {
  const lines = raw.split("\n");
  const sectionRegex = /^([\d.]+)\s+(.+)$/;
  const sections: ParsedSection[] = [];

  let inComment = false;
  let commentLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    // Single-line comment: /* text */
    if (!inComment && line.startsWith("/*") && line.endsWith("*/")) {
      const commentText = line.slice(2, -2).trim();
      if (sections.length > 0 && commentText) {
        const last = sections[sections.length - 1];
        last.notes = last.notes ? last.notes + "\n" + commentText : commentText;
      }
      continue;
    }

    // Start of multi-line comment
    if (!inComment && line.startsWith("/*")) {
      inComment = true;
      const rest = line.slice(2).trim();
      commentLines = rest ? [rest] : [];
      continue;
    }

    // End of multi-line comment
    if (inComment && line.endsWith("*/")) {
      const rest = line.slice(0, -2).trim();
      if (rest) commentLines.push(rest);
      inComment = false;

      const commentText = commentLines.join("\n").trim();
      if (sections.length > 0 && commentText) {
        const last = sections[sections.length - 1];
        last.notes = last.notes ? last.notes + "\n" + commentText : commentText;
      }
      commentLines = [];
      continue;
    }

    // Inside multi-line comment
    if (inComment) {
      commentLines.push(line);
      continue;
    }

    // Normal section line
    const match = sectionRegex.exec(line);
    if (!match) continue;

    const orderNumber = match[1];
    const title = match[2];
    const segments = orderNumber.split(".").filter(Boolean);
    const depth = segments.length;

    let parentOrderNumber: string | undefined;
    if (depth > 1) {
      parentOrderNumber = segments.slice(0, -1).join(".");
    }

    sections.push({ title, orderNumber, depth, parentOrderNumber });
  }

  return sections;
}

export function serializeOutline(sections: ParsedSection[]): string {
  return sections
    .map((s) => {
      let line = `${s.orderNumber} ${s.title}`;
      if (s.notes) {
        line += `\n/* ${s.notes} */`;
      }
      return line;
    })
    .join("\n");
}

export function buildEditableTree(
  sections: ParsedSection[]
): EditableSectionNode[] {
  const nodeMap = new Map<string, EditableSectionNode>();
  const roots: EditableSectionNode[] = [];

  for (const s of sections) {
    nodeMap.set(s.orderNumber, {
      id: crypto.randomUUID(),
      title: s.title,
      orderNumber: s.orderNumber,
      depth: s.depth,
      parentOrderNumber: s.parentOrderNumber,
      children: [],
      notes: s.notes,
    });
  }

  for (const s of sections) {
    const node = nodeMap.get(s.orderNumber)!;
    if (s.parentOrderNumber && nodeMap.has(s.parentOrderNumber)) {
      nodeMap.get(s.parentOrderNumber)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function flattenEditableTree(
  roots: EditableSectionNode[]
): ParsedSection[] {
  const result: ParsedSection[] = [];

  function walk(nodes: EditableSectionNode[]) {
    for (const node of nodes) {
      result.push({
        title: node.title,
        orderNumber: node.orderNumber,
        depth: node.depth,
        parentOrderNumber: node.parentOrderNumber,
        notes: node.notes,
      });
      walk(node.children);
    }
  }

  walk(roots);
  return result;
}

export function renumberTree(
  roots: EditableSectionNode[]
): EditableSectionNode[] {
  function renumber(
    nodes: EditableSectionNode[],
    prefix: string,
    depth: number
  ) {
    nodes.forEach((node, i) => {
      const num = String(i + 1);
      node.orderNumber = prefix ? `${prefix}.${num}` : num;
      node.depth = depth;
      node.parentOrderNumber = prefix || undefined;
      renumber(node.children, node.orderNumber, depth + 1);
    });
  }

  renumber(roots, "", 1);
  return roots;
}

export function findNode(
  roots: EditableSectionNode[],
  orderNumber: string
): EditableSectionNode | null {
  for (const node of roots) {
    if (node.orderNumber === orderNumber) return node;
    const found = findNode(node.children, orderNumber);
    if (found) return found;
  }
  return null;
}

export function removeNode(
  roots: EditableSectionNode[],
  orderNumber: string
): EditableSectionNode[] {
  return roots.filter((node) => {
    if (node.orderNumber === orderNumber) return false;
    node.children = removeNode(node.children, orderNumber);
    return true;
  });
}
