import { defineTool } from "@opencomputer/agent";

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export const webFetch = defineTool({
  name: "web_fetch_grok",
  description:
    "Fetch a public URL and return its text (HTML stripped) or raw body for JSON/text. Use it to read documentation, READMEs, pricing pages and package registries. No authentication is sent.",
  input: {
    type: "object",
    properties: {
      url: { type: "string", description: "http(s) URL to read." },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async run({ input, signal }) {
    const url = new URL(String(input.url));
    if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) URLs are allowed.");
    const response = await fetch(url, {
      signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; agent-picks/1.0)", Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*" },
    });
    const type = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const max = 12000;
    const text = !/html/i.test(type) ? body : htmlToText(body);
    return { status: response.status, url: response.url, contentType: type, truncated: text.length > max, text: text.slice(0, max) };
  },
});
