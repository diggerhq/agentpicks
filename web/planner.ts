// URL -> what the company sells + realistic developer tasks that never name a vendor.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GATEWAY = "https://app.opencomputer.dev/api/managed-agents/openrouter/api/v1/chat/completions";
const PLANNER_MODEL = process.env.PLANNER_MODEL ?? "anthropic/claude-sonnet-5.5";

function apiKey() {
  if (process.env.OPENCOMPUTER_API_KEY) return process.env.OPENCOMPUTER_API_KEY;
  const p = join(homedir(), ".opencomputer/config.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).apiKey : "";
}

export type Plan = {
  brand: string;
  domain: string;
  category: string;
  summary: string;
  aliases: string[];
  packages: string[];
  tasks: { task: string; stack: "nextjs" | "express" | "fastapi" }[];
};

function pageText(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] ?? "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return `TITLE: ${title}\nDESCRIPTION: ${desc}\nTEXT: ${body.slice(0, 6000)}`;
}

export async function plan(url: string, nTasks: number): Promise<Plan> {
  const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Use an http(s) URL");
  let site = "";
  try {
    const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (compatible; agent-picks/0.1)" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    site = pageText(await r.text());
  } catch (e) {
    site = `(could not fetch the page: ${(e as Error).message})`;
  }
  const prompt = `You are designing a fair experiment: developers ask AI coding agents to build features, and we record which third-party product each agent chooses. We want to know how often coding agents choose the product at ${u.hostname}.

Here is that product's homepage:
<<<
${site}
>>>

Return JSON only, with this shape:
{
  "brand": "product name",
  "domain": "${u.hostname.replace(/^www\./, "")}",
  "category": "short category, e.g. 'code execution sandboxes'",
  "summary": "one sentence on what it does",
  "aliases": ["other names the product or company goes by, lowercase"],
  "packages": ["its npm and pip package names, if you know them; else []"],
  "tasks": [{ "task": "...", "stack": "nextjs" | "express" | "fastapi" }]
}

Write exactly ${nTasks} tasks. Each task is a request a real developer would type to a coding agent
inside their existing app, where a product in this category is a natural (not forced) solution.
Rules for tasks:
- Never name this product, its competitors, or any vendor. Describe the need, not the tool.
- Vary the use case, constraints (budget, scale, latency, compliance, self-hosting, open source), and phrasing.
- 1 to 3 sentences, first person, concrete about what to build ("add an API route that...").
- Spread stacks roughly evenly across nextjs, express and fastapi.`;
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "x-api-key": apiKey(), "content-type": "application/json", "user-agent": "agent-picks/0.1" },
    body: JSON.stringify({ model: PLANNER_MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 6000 }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Planner failed (${res.status}): ${text.slice(0, 300)}`);
  const content: string = JSON.parse(text).choices?.[0]?.message?.content ?? "";
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  const p = JSON.parse(json) as Plan;
  const stacks = ["nextjs", "express", "fastapi"] as const;
  p.tasks = (p.tasks ?? []).slice(0, nTasks).map((t, i) => ({ task: String(t.task), stack: stacks.includes(t.stack) ? t.stack : stacks[i % 3] }));
  if (p.tasks.length === 0) throw new Error("Planner returned no tasks");
  p.domain = (p.domain || u.hostname).replace(/^www\./, "").toLowerCase();
  p.aliases = [...new Set([p.brand, ...(p.aliases ?? [])].map((a) => String(a).toLowerCase()).filter(Boolean))];
  p.packages = (p.packages ?? []).map((x) => String(x).toLowerCase());
  return p;
}
