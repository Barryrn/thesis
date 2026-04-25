/// Tests for the document compiler used by preview and export.
import { describe, it, expect } from "vitest";
import {
  generateTOC,
  generateListOfFigures,
  renderSectionToHtml,
  generateBibliography,
  compileDocument,
} from "../documentCompiler";
import type { OutlineSectionDoc, FigureDoc } from "../documentCompiler";

// ── generateTOC ─────────────────────────────────────────────────────

describe("generateTOC", () => {
  it("generates TOC entries from sections", () => {
    const sections: OutlineSectionDoc[] = [
      { _id: "s1", title: "Introduction", orderNumber: "1", depth: 0 },
      { _id: "s2", title: "Background", orderNumber: "1.1", depth: 1 },
      { _id: "s3", title: "Methods", orderNumber: "2", depth: 0 },
    ];

    const toc = generateTOC(sections);
    expect(toc).toHaveLength(3);
    expect(toc[0]).toEqual({
      orderNumber: "1",
      title: "Introduction",
      depth: 0,
    });
    expect(toc[1].depth).toBe(1);
  });

  it("handles empty sections", () => {
    expect(generateTOC([])).toHaveLength(0);
  });
});

// ── generateListOfFigures ───────────────────────────────────────────

describe("generateListOfFigures", () => {
  it("numbers figures sequentially across sections", () => {
    const sections: OutlineSectionDoc[] = [
      { _id: "s1", title: "Sec 1", orderNumber: "1", depth: 0 },
      { _id: "s2", title: "Sec 2", orderNumber: "2", depth: 0 },
    ];
    const figMap = new Map<string, FigureDoc[]>([
      [
        "s1",
        [
          { _id: "f1", sectionId: "s1", storageId: "st1", caption: "Fig A", orderIndex: 0 },
          { _id: "f2", sectionId: "s1", storageId: "st2", caption: "Fig B", orderIndex: 1 },
        ],
      ],
      [
        "s2",
        [
          { _id: "f3", sectionId: "s2", storageId: "st3", caption: "Fig C", orderIndex: 0 },
        ],
      ],
    ]);

    const list = generateListOfFigures(sections, figMap);
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({
      figureNumber: 1,
      caption: "Fig A",
      sectionOrderNumber: "1",
    });
    expect(list[2].figureNumber).toBe(3);
  });

  it("returns empty for no figures", () => {
    const sections: OutlineSectionDoc[] = [
      { _id: "s1", title: "Sec 1", orderNumber: "1", depth: 0 },
    ];
    const list = generateListOfFigures(sections, new Map());
    expect(list).toHaveLength(0);
  });
});

// ── renderSectionToHtml ─────────────────────────────────────────────

describe("renderSectionToHtml", () => {
  const emptySourceMap = new Map<string, any>();
  const emptyFigureMap = new Map<string, any>();
  const emptyFigureNumbers = new Map<string, number>();
  const emptyFigureUrls = new Map<string, string>();
  const emptyPapers = new Map<string, any>();

  it("returns empty for empty body", () => {
    const { html, footnotes } = renderSectionToHtml(
      "",
      emptySourceMap,
      emptyFigureMap,
      emptyFigureNumbers,
      emptyFigureUrls,
      emptyPapers
    );
    expect(html).toBe("");
    expect(footnotes).toHaveLength(0);
  });

  it("renders plain text with HTML escaping", () => {
    const { html } = renderSectionToHtml(
      "Hello <world> & friends",
      emptySourceMap,
      emptyFigureMap,
      emptyFigureNumbers,
      emptyFigureUrls,
      emptyPapers
    );
    expect(html).toContain("&lt;world&gt;");
    expect(html).toContain("&amp;");
  });

  it("replaces citation markers with superscript footnote refs", () => {
    const body = "Text {{cite:p1::indirect::S. 3}} more.";
    const sourceMap = new Map([["p1", { kuerzel: "KR09" }]]) as any;

    const { html, footnotes } = renderSectionToHtml(
      body,
      sourceMap,
      emptyFigureMap,
      emptyFigureNumbers,
      emptyFigureUrls,
      emptyPapers
    );

    expect(html).toContain('<sup class="footnote-ref">1</sup>');
    expect(html).not.toContain("{{cite:");
    expect(footnotes).toHaveLength(1);
    expect(footnotes[0].text).toBe("Vgl. KR09, S. 3.");
  });

  it("renders formula markers as KaTeX HTML", () => {
    const body = "Value $x^2$ is positive.";
    const { html } = renderSectionToHtml(
      body,
      emptySourceMap,
      emptyFigureMap,
      emptyFigureNumbers,
      emptyFigureUrls,
      emptyPapers
    );

    expect(html).toContain("formula-inline");
    expect(html).toContain("katex");
    expect(html).not.toContain("$x^2$");
  });

  it("renders figure markers as figure elements", () => {
    const body = "See {{fig:f1}} below.";
    const figureMap = new Map([
      ["f1", { _id: "f1", sectionId: "s1", storageId: "st1", caption: "My Chart", orderIndex: 0 }],
    ]) as any;
    const figureNumbers = new Map([["f1", 1]]);
    const figureUrls = new Map([["f1", "https://example.com/img.png"]]);

    const { html } = renderSectionToHtml(
      body,
      emptySourceMap,
      figureMap,
      figureNumbers,
      figureUrls,
      emptyPapers
    );

    expect(html).toContain("thesis-figure");
    expect(html).toContain("Abbildung 1: My Chart");
    expect(html).toContain("https://example.com/img.png");
  });

  it("shows missing figure for unknown figure markers", () => {
    const body = "See {{fig:unknown}} below.";
    const { html } = renderSectionToHtml(
      body,
      emptySourceMap,
      emptyFigureMap,
      emptyFigureNumbers,
      emptyFigureUrls,
      emptyPapers
    );
    expect(html).toContain("Missing figure");
  });

  it("uses ?? for missing source in citation", () => {
    const body = "{{cite:unknown::direct::S. 1}}";
    const { footnotes } = renderSectionToHtml(
      body,
      emptySourceMap,
      emptyFigureMap,
      emptyFigureNumbers,
      emptyFigureUrls,
      emptyPapers
    );
    expect(footnotes[0].text).toContain("??");
  });
});

// ── generateBibliography ────────────────────────────────────────────

describe("generateBibliography", () => {
  it("generates sorted bibliography entries", () => {
    const sources = [
      { paperId: "p2", kuerzel: "ZZ20", sourceType: "book" },
      { paperId: "p1", kuerzel: "AA10", sourceType: "book" },
    ] as any[];

    const papers = new Map([
      ["p1", { _id: "p1", title: "Alpha Paper", authors: ["Alice Author"], year: 2010 }],
      ["p2", { _id: "p2", title: "Zeta Paper", authors: ["Zoe Zebra"], year: 2020 }],
    ]) as any;

    const entries = generateBibliography(sources, papers);
    expect(entries).toHaveLength(2);
    // Should be sorted alphabetically by formatted text
    expect(entries[0].kuerzel).toBe("AA10");
    expect(entries[1].kuerzel).toBe("ZZ20");
  });

  it("handles empty sources", () => {
    expect(generateBibliography([], new Map())).toHaveLength(0);
  });
});

// ── compileDocument (integration) ────────────────────────────────────

describe("compileDocument", () => {
  it("produces a complete document from minimal data", () => {
    const result = compileDocument({
      metadata: {
        studentName: "Max Mustermann",
        titleDE: "Testarbeit",
      },
      sections: [
        { _id: "s1", title: "Einleitung", orderNumber: "1", depth: 0 },
      ],
      sectionContents: new Map([["s1", "Hello world."]]),
      figures: new Map(),
      figureUrls: new Map(),
      sources: [],
      papers: new Map(),
    });

    expect(result.titlePage.studentName).toBe("Max Mustermann");
    expect(result.titlePage.titleDE).toBe("Testarbeit");
    expect(result.tableOfContents).toHaveLength(1);
    expect(result.mainSections).toHaveLength(1);
    expect(result.mainSections[0].renderedBody).toContain("Hello world.");
    expect(result.declarationText).toContain("Hiermit erkläre ich");
  });

  it("compiles declaration text matching HKA wording", () => {
    const result = compileDocument({
      metadata: null,
      sections: [],
      sectionContents: new Map(),
      figures: new Map(),
      figureUrls: new Map(),
      sources: [],
      papers: new Map(),
    });

    expect(result.declarationText).toContain(
      "selbstständig und nur unter Benutzung der angegebenen Quellen"
    );
    expect(result.declarationText).toContain(
      "keiner anderen Prüfungsbehörde vorgelegen"
    );
  });
});
