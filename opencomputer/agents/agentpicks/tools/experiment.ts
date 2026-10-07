import { defineConnection, defineTool, secretHeader, useSecret } from "@opencomputer/agent";

// Starts and reads coding sessions through the OpenComputer management API. The
// key is a managed secret injected at egress; it never enters the runtime.
const api = defineConnection({
  id: "opencomputer-api",
  origin: "https://app.opencomputer.dev",
  methods: ["GET", "POST"],
  pathPrefix: "/api/managed-agents/",
  headers: { "x-api-key": secretHeader(useSecret("OPENCOMPUTER_API_KEY")) },
});

const MODELS = ["claude", "gpt", "gemini", "grok", "deepseek"];
const STACKS = ["nextjs", "express", "fastapi"];

async function call(path: string, init: { method?: string; body?: unknown; idem?: string } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await api.fetch(`/api/managed-agents${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", "user-agent": "agentpicks/1.0", ...(init.idem ? { "Idempotency-Key": init.idem } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error("The OPENCOMPUTER_API_KEY secret is missing or invalid.");
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${res.status}): ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
}

const env = () => (process.env.AGENTPICKS_ENVIRONMENT === "development" ? "development" : "production");

async function sessionsOf(exp: string) {
  const out: any[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ environment: env(), "label.app": "agentpicks", "label.exp": exp, limit: "100", ...(cursor ? { cursor } : {}) });
    const page = await call(`/sessions?${q}`);
    out.push(...page.sessions);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

const primary = (s: string) => s.split(/\s\+\s|,|\swith\s|\s&\s/)[0].replace(/\(.*?\)/g, "").trim() || s;
const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9.]+/g, " ").trim();
const settled = (s: any) => !s.activity?.activeTurnId && !!s.activity?.lastSettledTurn;

function isTarget(t: { domain: string; aliases: string[]; packages: string[] }, pick: any) {
  const name = norm(primary(String(pick?.chosen?.name ?? "")));
  let host = "";
  try {
    host = new URL(String(pick?.chosen?.url ?? "")).hostname.replace(/^www\./, "");
  } catch {}
  const root = t.domain.split(".").slice(-2).join(".");
  if (host && (host === t.domain || host === root || host.endsWith("." + root))) return true;
  if (name && t.aliases.some((a) => a && (name === norm(a) || name.split(" ").includes(norm(a))))) return true;
  const pk = new Set((pick?.packages ?? []).map((x: string) => String(x).toLowerCase()));
  return t.packages.some((x) => pk.has(x.toLowerCase()));
}

export const startExperiment = defineTool({
  name: "start_experiment",
  description: "Start one coding session per task per model. Each session is a coding agent on its own computer that builds the task in a fresh project. Returns the experiment id.",
  input: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description: "Developer requests. Never name the product or any vendor.",
        items: { type: "object", properties: { task: { type: "string" }, stack: { type: "string", enum: STACKS } }, required: ["task", "stack"], additionalProperties: false },
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  },
  async run({ input, agentId, sessionId, toolCallId }) {
    const tasks = (input.tasks as { task: string; stack: string }[]).slice(0, 20).map((t) => ({ task: String(t.task).slice(0, 800), stack: STACKS.includes(t.stack) ? t.stack : "express" }));
    if (!tasks.length) throw new Error("Give at least one task.");
    const exp = "s" + [...`${sessionId}:${toolCallId}`].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7).toString(36);
    const root = agentId.split("--")[0];
    const jobs = tasks.flatMap((t, ti) => MODELS.map((m, mi) => ({ ...t, ti, model: m, i: ti * MODELS.length + mi })));
    let started = 0;
    const errors: string[] = [];
    for (let k = 0; k < jobs.length; k += 10) {
      await Promise.all(
        jobs.slice(k, k + 10).map(async (j) => {
          const idem = `agentpicks/${exp}/${j.i}/1`;
          try {
            const { session } = await call("/sessions", { method: "POST", idem, body: { agentId: `${root}--dev-${j.model}@${env()}`, labels: { app: "agentpicks", exp, i: String(j.i), task: String(j.ti), model: j.model, attempt: "1", via: "agent" } } });
            await call(`/sessions/${session.id}/turns`, { method: "POST", body: { input: j.task, idempotencyKey: `${idem}/turn`, payload: { task: j.task, stack: j.stack } } });
            started++;
          } catch (e) {
            errors.push(`${j.model} #${j.i}: ${(e as Error).message}`);
          }
        }),
      );
    }
    return { exp, started, total: jobs.length, errors: errors.slice(0, 5) };
  },
});

export const checkExperiment = defineTool({
  name: "check_experiment",
  description: "Wait up to wait_seconds (max 20), then report how many coding sessions of the experiment are still running and what the finished ones chose. Call it again (one call at a time, never in parallel) until running is 0.",
  input: {
    type: "object",
    properties: { exp: { type: "string" }, wait_seconds: { type: "integer", description: "Seconds to wait before checking, 0 to 20." } },
    required: ["exp", "wait_seconds"],
    additionalProperties: false,
  },
  async run({ input, signal }) {
    // Short waits: a tool that sleeps much longer makes the runtime look unresponsive.
    const wait = Math.min(Math.max(Number(input.wait_seconds) || 0, 0), 20) * 1000;
    if (wait) await new Promise((r) => { const t = setTimeout(r, wait); signal?.addEventListener("abort", () => { clearTimeout(t); r(null); }); });
    const all = await sessionsOf(String(input.exp));
    const done = all.filter(settled);
    const picks: Record<string, number> = {};
    for (const s of done) if (s.result?.data?.chosen?.name) picks[primary(s.result.data.chosen.name)] = (picks[primary(s.result.data.chosen.name)] ?? 0) + 1;
    return { total: all.length, running: all.length - done.length, finished: done.filter((s) => s.result).length, failed: done.filter((s) => !s.result).length, picks };
  },
});

export const reportExperiment = defineTool({
  name: "report_experiment",
  description: "Finish: compute the final scoreboard for the experiment and record it as this session's result. Call once, after check_experiment shows running 0 (or you have waited 40 minutes).",
  input: {
    type: "object",
    properties: {
      exp: { type: "string" },
      url: { type: "string" },
      brand: { type: "string" },
      domain: { type: "string", description: "The product's domain, e.g. acme.com" },
      aliases: { type: "array", items: { type: "string" }, description: "Other names for the product, lowercase." },
      packages: { type: "array", items: { type: "string" }, description: "Its npm and pip package names, if known." },
    },
    required: ["exp", "url", "brand", "domain", "aliases", "packages"],
    additionalProperties: false,
  },
  output: {
    type: "object",
    properties: {
      exp: { type: "string" },
      url: { type: "string" },
      brand: { type: "string" },
      total: { type: "integer" },
      finished: { type: "integer" },
      picked: { type: "integer" },
      leaderboard: { type: "array", items: { type: "object", properties: { name: { type: "string" }, count: { type: "integer" }, target: { type: "boolean" } }, required: ["name", "count", "target"], additionalProperties: false } },
      by_model: { type: "array", items: { type: "object", properties: { model: { type: "string" }, finished: { type: "integer" }, picked: { type: "integer" }, top: { type: "string" } }, required: ["model", "finished", "picked", "top"], additionalProperties: false } },
    },
    required: ["exp", "url", "brand", "total", "finished", "picked", "leaderboard", "by_model"],
    additionalProperties: false,
  },
  result: true,
  async run({ input }) {
    const t = { domain: String(input.domain).replace(/^www\./, "").toLowerCase(), aliases: [String(input.brand), ...((input.aliases as string[]) ?? [])].map((a) => a.toLowerCase()), packages: (input.packages as string[]) ?? [] };
    const all = await sessionsOf(String(input.exp));
    const done = all.filter((s) => s.result?.data?.chosen?.name);
    const board = new Map<string, { name: string; count: number; target: boolean }>();
    for (const s of done) {
      const name = primary(s.result.data.chosen.name);
      const cur = board.get(norm(name)) ?? { name, count: 0, target: isTarget(t, s.result.data) };
      cur.count++;
      board.set(norm(name), cur);
    }
    const by_model = MODELS.map((m) => {
      const d = done.filter((s) => s.labels?.model === m);
      const counts = new Map<string, number>();
      for (const s of d) counts.set(primary(s.result.data.chosen.name), (counts.get(primary(s.result.data.chosen.name)) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return { model: m, finished: d.length, picked: d.filter((s) => isTarget(t, s.result.data)).length, top: top ? `${top[0]} (${top[1]})` : "" };
    });
    return {
      exp: String(input.exp),
      url: String(input.url),
      brand: String(input.brand),
      total: all.length,
      finished: done.length,
      picked: done.filter((s) => isTarget(t, s.result.data)).length,
      leaderboard: [...board.values()].sort((a, b) => b.count - a.count).slice(0, 15),
      by_model,
    };
  },
});
