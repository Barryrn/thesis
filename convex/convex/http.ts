import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Handle CORS preflight
http.route({
  path: "/trigger-processing",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

http.route({
  path: "/trigger-processing",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const { paperId } = await req.json();

    // Update status to processing
    await ctx.runMutation(api.papers.updatePaperStatus, {
      paperId,
      status: "processing",
    });

    // Fetch paper to get fileUrl
    const paper = await ctx.runQuery(api.papers.getPaper, { paperId });

    // Fetch all outline sections to send to Python
    const sections = await ctx.runQuery(api.outline.listSections);

    // Call local Python service
    try {
      const pyResponse = await fetch("http://localhost:8000/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperId,
          fileUrl: paper!.fileUrl,
          sections: sections.map((s: any) => ({
            _id: s._id,
            orderNumber: s.orderNumber,
            title: s.title,
          })),
        }),
      });

      if (!pyResponse.ok) {
        let detail = `Python service returned HTTP ${pyResponse.status}`;
        try {
          const body = await pyResponse.json();
          detail = body.detail || JSON.stringify(body);
        } catch {
          // ignore parse errors
        }
        await ctx.runMutation(api.papers.updatePaperStatus, {
          paperId,
          status: "failed",
          errorMessage: `Python processing error: ${detail}`,
        });
        return new Response(
          JSON.stringify({ error: detail }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(api.papers.updatePaperStatus, {
        paperId,
        status: "failed",
        errorMessage: `Could not reach Python service: ${msg}`,
      });
      return new Response(
        JSON.stringify({ error: `Could not reach Python service: ${msg}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response("ok", { status: 200, headers: corsHeaders });
  }),
});

export default http;
