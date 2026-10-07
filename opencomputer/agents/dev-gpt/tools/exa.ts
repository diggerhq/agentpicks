import { defineConnection, defineTool, secretHeader, useSecret } from "@opencomputer/agent";

// Web search through Exa. The API key is a managed secret injected at egress.
// Schemas keep every property required: strict function-calling models reject optional fields.
const exa = defineConnection({
  id: "exa-api-gpt",
  origin: "https://api.exa.ai",
  methods: ["POST"],
  pathPrefix: "/search",
  headers: { "x-api-key": secretHeader(useSecret("EXA_API_KEY")) },
});

export const webSearch = defineTool({
  name: "web_search_gpt",
  description: "Search the web and get results with page text. Use it to look up libraries, services, docs, pricing and comparisons.",
  input: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
      num_results: { type: "integer", description: "How many results, 1 to 10." },
    },
    required: ["query", "num_results"],
    additionalProperties: false,
  },
  async run({ input, signal }) {
    const res = await exa.fetch("/search", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: String(input.query),
        type: "auto",
        numResults: Math.min(Math.max(Number(input.num_results) || 6, 1), 10),
        contents: { text: { maxCharacters: 1200 } },
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Search failed (${res.status}): ${text.slice(0, 300)}`);
    const data = JSON.parse(text) as { results?: { url?: string; title?: string; text?: string; publishedDate?: string }[] };
    return {
      results: (data.results ?? []).map((r) => ({ url: r.url ?? "", title: r.title ?? "", published: r.publishedDate ?? null, text: (r.text ?? "").slice(0, 1200) })),
    };
  },
});
