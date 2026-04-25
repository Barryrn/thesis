import { query } from "./_generated/server";

/// Returns all thesis data in a single batch query.
/// Used by the preview modal and export endpoint to avoid N+1 round-trips.
export const getThesisData = query({
  args: {},
  handler: async (ctx) => {
    // 1. Thesis metadata singleton
    const metadataDocs = await ctx.db.query("thesisMetadata").collect();
    const metadata = metadataDocs[0] ?? null;

    // 2. All outline sections (latest version)
    const allSections = await ctx.db.query("outlineSections").collect();
    // Find latest version
    const latestVersion = allSections.reduce(
      (max, s) => Math.max(max, s.outlineVersion),
      0
    );
    const sections = allSections
      .filter((s) => s.outlineVersion === latestVersion)
      .sort((a, b) =>
        a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true })
      );

    // 3. All section content
    const contentDocs = await ctx.db.query("sectionContent").collect();
    const sectionContents: Record<string, string> = {};
    for (const c of contentDocs) {
      sectionContents[c.sectionId] = c.body;
    }

    // 4. All figures with resolved storage URLs
    const figureDocs = await ctx.db.query("figures").collect();
    const figures = await Promise.all(
      figureDocs.map(async (fig) => {
        const url = await ctx.storage.getUrl(fig.storageId);
        return { ...fig, url: url ?? undefined };
      })
    );

    // 5. All sources
    const sources = await ctx.db.query("sources").collect();

    // 6. All papers (for citation rendering)
    const paperDocs = await ctx.db.query("papers").collect();
    const papers: Record<string, { _id: string; title: string; authors: string[]; year?: number }> = {};
    for (const p of paperDocs) {
      papers[p._id] = {
        _id: p._id,
        title: p.title,
        authors: p.authors,
        year: p.year,
      };
    }

    return {
      metadata,
      sections,
      sectionContents,
      figures,
      sources,
      papers,
    };
  },
});
