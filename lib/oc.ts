import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Trusted server-side client for the management API. Holds the API key; never ship to a browser.
let apiKey = process.env.OPENCOMPUTER_API_KEY ?? "";
if (!apiKey && existsSync(join(homedir(), ".opencomputer/config.json"))) apiKey = JSON.parse(readFileSync(join(homedir(), ".opencomputer/config.json"), "utf8")).apiKey ?? "";
export const API = (process.env.OPENCOMPUTER_API_URL ?? "https://app.opencomputer.dev").replace(/\/$/, "");
export const ENV = (process.env.OC_ENVIRONMENT ?? "development") as "development" | "production";
// One project: the orchestrator's cloud id is the project id; coding agents are "<id>--dev-<key>".
export const ROOT_AGENT = process.env.OC_AGENT ?? "agentpicks";
export const agentFor = (key: string) => `${ROOT_AGENT}--dev-${key}@${ENV}`;

export async function oc<T = any>(path: string, init: { method?: string; body?: unknown; idem?: string } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/api/managed-agents${path}`, {
      method: init.method ?? "GET",
      headers: { "x-api-key": apiKey, "content-type": "application/json", "user-agent": "agent-picks/0.1", ...(init.idem ? { "Idempotency-Key": init.idem } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      console.warn(new Date().toISOString().slice(11, 19), `retry ${attempt + 1} ${init.method ?? "GET"} ${path.slice(0, 60)} -> ${res.status} ${text.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after") ?? 0) * 1000 || 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
    return (text ? JSON.parse(text) : null) as T;
  }
}

/** Start one coding session. Labels carry the run id so the whole run can be listed in one request. */
export async function startSession(job: { run: string; i: number; task: string; stack: string; model: string }, labels: Record<string, string> = {}) {
  const idem = `agent-picks/${job.run}/${job.i}`;
  const t0 = Date.now();
  const { session } = await oc("/sessions", { method: "POST", idem, body: { agentId: agentFor(job.model), labels: { run: job.run, i: String(job.i), model: job.model, ...labels }, externalReference: idem } });
  await oc(`/sessions/${session.id}/turns`, { method: "POST", body: { input: job.task, idempotencyKey: `${idem}/turn`, payload: { task: job.task, stack: job.stack } } });
  console.log(new Date().toISOString().slice(11, 19), `started ${job.model} #${job.i} in ${Date.now() - t0}ms`);
  return session.id as string;
}

export async function listRun(run: string) {
  const out: any[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ environment: ENV, "label.run": run, limit: "100", ...(cursor ? { cursor } : {}) });
    const page: any = await oc(`/sessions?${q}`);
    out.push(...page.sessions);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export async function events(id: string, after = 0) {
  const r: any = await oc(`/sessions/${id}/events?after=${after}`);
  return (Array.isArray(r) ? r : r.events ?? []) as any[];
}
