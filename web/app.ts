// HTTP handler shared by the local server and the Vercel function. Stateless: a run's
// plan is stored once; everything else is read back from its OpenComputer sessions.
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ENV, agentFor, oc } from "../lib/oc.ts";
import { ROSTER } from "../lib/roster.ts";
import { get, listLocal, put } from "../lib/store.ts";
import { installsFrom, isTarget, line, primary, norm } from "./describe.ts";
import { plan as writePlan, type Plan } from "./planner.ts";

const env = process.env;
const PUBLIC = env.APP_MODE === "public";
const TRIES = Number(env.PUBLIC_TRIES ?? 3);
const DAILY_CAP = Number(env.PUBLIC_DAILY_CAP ?? 50);
const MAX_TASKS = PUBLIC ? Number(env.PUBLIC_MAX_TASKS ?? 5) : 20;
const MAX_ATTEMPTS = 2; // one automatic retry for sessions that end without a result
const SALT = env.IP_SALT ?? "agentpicks-local";
const REPO = env.TEMPLATE_REPO ?? "https://github.com/diggerhq/agentpicks";
export const TEMPLATE_URL = `https://app.opencomputer.dev/new?repository-url=${encodeURIComponent(REPO)}`;
const STACKS = ["nextjs", "express", "fastapi"] as const;

type Stored = {
  id: string;
  url: string;
  createdAt: number;
  plan: Plan;
  models: string[];
  cells: { i: number; task: number; model: string }[];
};

// ---------- helpers ----------
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 200_000) throw Object.assign(new Error("Request too large"), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}
function clientIp(req: IncomingMessage) {
  const fwd = String(req.headers["x-real-ip"] ?? req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "unknown";
}
const ipHash = (req: IncomingMessage) => createHash("sha256").update(`${SALT}|${clientIp(req)}`).digest("hex").slice(0, 16);
const today = () => new Date().toISOString().slice(0, 10);

async function countFirst(labels: Record<string, string>, cap: number) {
  let n = 0;
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ environment: ENV, limit: "100", ...(cursor ? { cursor } : {}) });
    for (const [k, v] of Object.entries(labels)) q.set(`label.${k}`, v);
    const page: any = await oc(`/sessions?${q}`);
    n += page.sessions.length;
    cursor = n >= cap ? null : page.nextCursor;
  } while (cursor);
  return n;
}

async function usage(req: IncomingMessage) {
  if (!PUBLIC) return null;
  const [mine, day] = await Promise.all([
    countFirst({ app: "agentpicks", ip: ipHash(req), first: "1" }, TRIES),
    countFirst({ app: "agentpicks", day: today(), first: "1" }, DAILY_CAP),
  ]);
  return { limit: TRIES, used: Math.min(mine, TRIES), remaining: Math.max(0, TRIES - mine), dailyRemaining: Math.max(0, DAILY_CAP - day) };
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (k < items.length) await fn(items[k++]);
  }));
}

async function startCell(run: Stored, cell: Stored["cells"][number], attempt: number, extra: Record<string, string> = {}) {
  const t = run.plan.tasks[cell.task];
  const idem = `agentpicks/${run.id}/${cell.i}/${attempt}`;
  const { session } = await oc("/sessions", {
    method: "POST",
    idem,
    body: { agentId: agentFor(cell.model), labels: { app: "agentpicks", exp: run.id, i: String(cell.i), task: String(cell.task), model: cell.model, attempt: String(attempt), via: PUBLIC ? "public" : "local", ...extra } },
  });
  await oc(`/sessions/${session.id}/turns`, { method: "POST", body: { input: t.task, idempotencyKey: `${idem}/turn`, payload: { task: t.task, stack: t.stack } } });
}

async function sessionsOf(id: string) {
  const out: any[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ environment: ENV, "label.app": "agentpicks", "label.exp": id, limit: "100", ...(cursor ? { cursor } : {}) });
    const page: any = await oc(`/sessions?${q}`);
    out.push(...page.sessions);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

// ---------- views ----------
async function runView(run: Stored) {
  const sessions = await sessionsOf(run.id);
  const latest = new Map<number, any>();
  for (const s of sessions) {
    const i = Number(s.labels?.i), a = Number(s.labels?.attempt ?? 1);
    const cur = latest.get(i);
    if (!cur || a > Number(cur.labels?.attempt ?? 1)) latest.set(i, s);
  }
  const target = { domain: run.plan.domain, aliases: run.plan.aliases, packages: run.plan.packages };
  const retry: Stored["cells"] = [];
  const cells = run.cells.map((c) => {
    const s = latest.get(c.i);
    const attempt = Number(s?.labels?.attempt ?? 0);
    const d = s?.result?.data;
    const settled = s && !s.activity?.activeTurnId && (!!s.activity?.lastSettledTurn || ["failed", "ended"].includes(s.status));
    let state: string;
    if (!s) state = "queued";
    else if (d?.chosen?.name) state = "done";
    else if (settled) state = attempt < MAX_ATTEMPTS && s.status !== "ended" ? "retrying" : "failed";
    else if (["new", "connecting"].includes(s.status) || !s.activity?.activeTurnId) state = "booting";
    else state = "running";
    if (state === "retrying") retry.push(c);
    const pick = d?.chosen?.name ? { name: primary(d.chosen.name), url: d.chosen.url, alternatives: d.alternatives ?? [], supporting: d.supporting ?? [], reason: d.reason ?? "", verified: !!d.verified, packages: d.packages ?? [] } : null;
    return {
      ...c,
      state,
      attempt,
      sessionId: s?.id ?? null,
      startedAt: s ? Date.parse(s.createdAt) : null,
      endedAt: settled && s.activity?.lastSettledTurn?.at ? Date.parse(s.activity.lastSettledTurn.at) : null,
      pick,
      isTarget: isTarget(target, pick),
    };
  });
  // Sessions that ended without reporting (a throttled or failed start) get one more try.
  // Idempotency keys make concurrent polls safe.
  if (retry.length) await pool(retry, 10, async (c) => startCell(run, c, MAX_ATTEMPTS).catch(() => {}));

  const done = cells.filter((c) => c.state === "done");
  const board = new Map<string, { name: string; url: string; count: number; target: boolean }>();
  for (const c of done) {
    // Every pick of the measured product counts as one entry ("Acme" and "Acme SDK").
    const k = c.isTarget ? "\u0000target" : norm(c.pick!.name) || "none";
    const cur = board.get(k) ?? { name: c.isTarget ? run.plan.brand : c.pick!.name, url: c.isTarget ? `https://${run.plan.domain}` : c.pick!.url, count: 0, target: c.isTarget };
    cur.count++;
    board.set(k, cur);
  }
  const byModel = ROSTER.filter((m) => run.models.includes(m.key)).map((m) => {
    const d = done.filter((c) => c.model === m.key);
    const top = new Map<string, number>();
    for (const c of d) { const n = c.isTarget ? run.plan.brand : c.pick!.name; top.set(n, (top.get(n) ?? 0) + 1); }
    return { key: m.key, label: m.label, color: m.color, done: d.length, picked: d.filter((c) => c.isTarget).length, top: [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3) };
  });
  const count = (...st: string[]) => cells.filter((c) => st.includes(c.state)).length;
  return {
    id: run.id,
    url: run.url,
    createdAt: run.createdAt,
    now: Date.now(),
    plan: { brand: run.plan.brand, domain: run.plan.domain, category: run.plan.category, summary: run.plan.summary, tasks: run.plan.tasks },
    roster: ROSTER.filter((m) => run.models.includes(m.key)),
    counts: { total: cells.length, queued: count("queued"), booting: count("booting"), running: count("running"), retrying: count("retrying"), done: done.length, failed: count("failed"), picked: done.filter((c) => c.isTarget).length },
    finished: cells.every((c) => c.state === "done" || c.state === "failed"),
    leaderboard: [...board.values()].sort((a, b) => b.count - a.count),
    byModel,
    cells,
    templateUrl: TEMPLATE_URL,
    public: PUBLIC,
  };
}

// ---------- routes ----------
export async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/api/config") {
      return send(res, 200, { public: PUBLIC, maxTasks: MAX_TASKS, roster: ROSTER, templateUrl: TEMPLATE_URL, repo: REPO, usage: await usage(req) });
    }

    if (req.method === "POST" && path === "/api/plan") {
      const b = await body(req);
      const target = String(b.url ?? "").trim();
      if (!target) return send(res, 400, { error: "Enter a URL" });
      const u = await usage(req);
      if (u && (u.remaining === 0 || u.dailyRemaining === 0)) return send(res, 429, { error: u.remaining === 0 ? "You've used your free runs." : "Today's free runs are used up.", template: true });
      const n = Math.min(Math.max(Number(b.tasks) || 4, 1), MAX_TASKS);
      return send(res, 200, await writePlan(target, n));
    }

    if (req.method === "POST" && path === "/api/runs") {
      const b = await body(req);
      const p = b.plan as Plan;
      const models = ROSTER.map((m) => m.key).filter((k) => (Array.isArray(b.models) ? b.models : ROSTER.map((m) => m.key)).includes(k));
      if (!p || !Array.isArray(p.tasks) || !p.brand || !p.domain) return send(res, 400, { error: "Missing plan" });
      if (!models.length) return send(res, 400, { error: "Pick at least one model" });
      const tasks = p.tasks
        .map((t) => ({ task: String(t.task ?? "").trim().slice(0, 1000), stack: (STACKS as readonly string[]).includes(t.stack) ? t.stack : "express" }))
        .filter((t) => t.task.length >= 10)
        .slice(0, MAX_TASKS) as Plan["tasks"];
      if (!tasks.length) return send(res, 400, { error: "Add at least one request (10+ characters)" });
      const u = await usage(req);
      if (u && u.remaining === 0) return send(res, 429, { error: "You've used your free runs.", template: true });
      if (u && u.dailyRemaining === 0) return send(res, 429, { error: "Today's free runs are used up.", template: true });

      const id = Date.now().toString(36) + randomBytes(3).toString("hex");
      const run: Stored = {
        id,
        url: String(b.url ?? p.domain),
        createdAt: Date.now(),
        plan: {
          brand: String(p.brand).slice(0, 80),
          domain: String(p.domain).replace(/^www\./, "").toLowerCase().slice(0, 120),
          category: String(p.category ?? "").slice(0, 120),
          summary: String(p.summary ?? "").slice(0, 400),
          aliases: (p.aliases ?? []).map((a) => String(a).toLowerCase().slice(0, 60)).slice(0, 10),
          packages: (p.packages ?? []).map((a) => String(a).toLowerCase().slice(0, 80)).slice(0, 10),
          tasks,
        },
        models,
        cells: tasks.flatMap((_, ti) => models.map((m, mi) => ({ i: ti * models.length + mi, task: ti, model: m }))),
      };
      await put(`runs/${id}.json`, run);
      // The first session carries the usage labels the limits count.
      const first: Record<string, string> = PUBLIC ? { ip: ipHash(req), day: today(), first: "1" } : { first: "1" };
      await startCell(run, run.cells[0], 1, first);
      await pool(run.cells.slice(1), 25, (c) => startCell(run, c, 1).catch(() => {}));
      return send(res, 201, { id });
    }

    const m = path.match(/^\/api\/runs\/([a-z0-9]+)(\/(stop))?$/);
    if (m) {
      const run = await get<Stored>(`runs/${m[1]}.json`);
      if (!run) return send(res, 404, { error: "Run not found" });
      if (req.method === "GET" && !m[3]) return send(res, 200, await runView(run));
      if (req.method === "POST" && m[3] === "stop") {
        const live = (await sessionsOf(run.id)).filter((s) => !["ended", "failed"].includes(s.status));
        await pool(live, 10, async (s) => void (await oc(`/sessions/${s.id}/end`, { method: "POST" }).catch(() => {})));
        return send(res, 200, { ended: live.length });
      }
    }

    const a = path.match(/^\/api\/sessions\/([0-9a-f-]{36})\/activity$/);
    if (req.method === "GET" && a) {
      const s: any = await oc(`/sessions/${a[1]}`);
      if (s.labels?.app !== "agentpicks") return send(res, 404, { error: "not found" });
      const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
      const page: any = await oc(`/sessions/${a[1]}/events?after=${after}`);
      const evs: any[] = Array.isArray(page) ? page : page.events ?? [];
      const lines: { kind: string; text: string }[] = [];
      const installs: string[] = [];
      let last = after, steps = 0;
      for (const e of evs) {
        last = Math.max(last, e.seq ?? last);
        if (e.type === "tool.started") {
          steps++;
          lines.push(line(String(e.data?.tool ?? ""), e.data?.input));
          if (String(e.data?.tool) === "shell") installs.push(...installsFrom(String(e.data?.input?.command ?? "")));
        } else if (e.type === "tool.failed" && /Throttl/i.test(String(e.data?.message))) {
          lines.push({ kind: "warn", text: "⚠ rate limited, retrying" });
        }
      }
      return send(res, 200, { after: last, more: evs.length >= 500, lines, installs, steps });
    }

    if (req.method === "GET" && path === "/api/runs" && !PUBLIC) {
      const ids = listLocal("runs");
      const runs = await Promise.all(ids.map((id) => get<Stored>(`runs/${id}.json`)));
      return send(res, 200, runs.filter(Boolean).sort((x, y) => y!.createdAt - x!.createdAt).slice(0, 20).map((r) => ({ id: r!.id, url: r!.url, brand: r!.plan.brand, createdAt: r!.createdAt, size: r!.cells.length })));
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    const err = e as Error & { status?: number };
    send(res, err.status && err.status < 500 ? err.status : 500, { error: err.message.slice(0, 300) });
  }
}
