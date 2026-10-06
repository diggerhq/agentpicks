// Runs one experiment: paced session starts, live activity from event logs, retries
// for sessions the platform throttled, and scoring against what was actually installed.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { events, oc, startSession } from "../lib/oc.ts";
import { ROSTER } from "../lib/roster.ts";
import { plan, type Plan } from "./planner.ts";

const RUNS_DIR = "runs/web";
mkdirSync(RUNS_DIR, { recursive: true });

const MIN_GAP = Number(process.env.START_GAP_MS ?? 4000); // pacing between session starts
const MAX_GAP = 20000;
const MAX_ATTEMPTS = 3;
const SESSION_TIMEOUT_MS = 20 * 60_000;

export type Cell = {
  i: number; // task index * models + model index
  task: number;
  model: string;
  stack: string;
  attempt: number;
  sessionId: string | null;
  state: "queued" | "starting" | "running" | "done" | "failed" | "retrying";
  activity: string;
  steps: number;
  installs: string[];
  throttled: number;
  startedAt: number | null;
  endedAt: number | null;
  pick: null | { name: string; url: string; supporting?: string[]; alternatives: string[]; reason: string; verified: boolean; packages: string[] };
  isTarget: boolean;
  after: number; // event cursor
  error?: string;
};

export type Run = {
  id: string;
  url: string;
  createdAt: number;
  phase: "planning" | "running" | "done" | "error";
  error?: string;
  plan: Plan | null;
  cells: Cell[];
  gapMs: number;
  log: string[];
};

const runs = new Map<string, Run>();
export function resumeRuns() {
  for (const f of readdirSync(RUNS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const r = JSON.parse(readFileSync(`${RUNS_DIR}/${f}`, "utf8")) as Run;
      runs.set(r.id, r);
      if (r.phase === "running") {
        // A session that was mid-start when the server stopped is retried.
        for (const c of r.cells) if (c.state === "starting") c.state = "retrying";
        void loop(r).catch((e) => ((r.phase = "error"), (r.error = (e as Error).message), save(r)));
      } else if (r.phase === "planning") {
        r.phase = "error";
        r.error = "The server restarted while planning; start a new run.";
      }
    } catch {}
  }
}

function save(run: Run) {
  writeFileSync(`${RUNS_DIR}/${run.id}.json`, JSON.stringify(run));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const note = (run: Run, s: string) => {
  run.log.push(`${new Date().toISOString().slice(11, 19)} ${s}`);
  if (run.log.length > 200) run.log.shift();
};

export function getRun(id: string) {
  return runs.get(id) ?? null;
}
export function listRuns() {
  return [...runs.values()].sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ id: r.id, url: r.url, phase: r.phase, createdAt: r.createdAt, brand: r.plan?.brand ?? null, size: r.cells.length }));
}

/** Re-queue every failed session in a run (e.g. after fixing a broken deployment). */
export function retryFailed(id: string) {
  const run = runs.get(id);
  if (!run || !run.plan) return 0;
  const failed = run.cells.filter((c) => c.state === "failed");
  for (const c of failed) Object.assign(c, { state: "retrying", attempt: 0, activity: "Queued to retry", error: undefined });
  if (failed.length && run.phase === "done") {
    run.phase = "running";
    void loop(run).catch((e) => ((run.phase = "error"), (run.error = (e as Error).message), save(run)));
  }
  note(run, `Re-queued ${failed.length} failed sessions`);
  save(run);
  return failed.length;
}

export function createRun(url: string, size: number) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const run: Run = { id, url, createdAt: Date.now(), phase: "planning", plan: null, cells: [], gapMs: MIN_GAP, log: [] };
  runs.set(id, run);
  save(run);
  void drive(run, Math.max(1, Math.round(size / ROSTER.length))).catch((e) => {
    run.phase = "error";
    run.error = (e as Error).message;
    save(run);
  });
  return run;
}

// ---------- evidence from the event log ----------
const SETUP_PREFIX = "mkdir -p ~/workspace";
export function installsFrom(command: string): string[] {
  if (command.startsWith(SETUP_PREFIX)) return [];
  const out: string[] = [];
  // Only real install commands: each &&/;/| segment must start with the installer.
  for (const seg of command.split(/&&|\|\||;|\||\n/)) {
    const m = seg.trim().match(/^(?:(?:\.venv\/bin\/|\S*\/)?(?:npm\s+(?:i|install|add)|pnpm\s+(?:add|i|install)|yarn\s+add|bun\s+add|pip3?\s+install|python3?\s+-m\s+pip\s+install|uv\s+(?:add|pip\s+install)|poetry\s+add))\s+(.+)$/);
    if (!m) continue;
    for (const tok of m[1].trim().split(/\s+/)) {
      if (tok.startsWith("-")) continue;
      if (tok.startsWith(">") || tok.startsWith("2>")) break;
      const name = tok.replace(/^['"]|['"]$/g, "").replace(/(?<=.)@[^/]*$/, "").replace(/[=<>~!].*$/, "").replace(/\[.*\]$/, "").toLowerCase();
      if (!/^@?[a-z0-9][a-z0-9._\-]*(\/[a-z0-9._\-]+)?$/.test(name) || /requirements/.test(name)) break;
      out.push(name);
    }
  }
  return out;
}

function describe(tool: string, input: any): string {
  if (tool === "shell") {
    const c = String(input?.command ?? "");
    if (c.startsWith(SETUP_PREFIX)) return "Setting up the project";
    const inst = installsFrom(c);
    if (inst.length) return `Installing ${inst.slice(0, 3).join(", ")}`;
    if (/tsc|typecheck|mypy|python3? -c|pytest|npm (run )?(build|test)/.test(c)) return "Type-checking";
    if (/^\s*(cat|ls|find|grep|sed -n|head|tail)\b/.test(c)) return "Reading the code";
    return "Writing code";
  }
  if (tool === "web_search") return `Searching: ${String(input?.query ?? "").slice(0, 70)}`;
  if (tool === "web_fetch") {
    try {
      return `Reading ${new URL(String(input?.url)).hostname.replace(/^www\./, "")}`;
    } catch {
      return "Reading a page";
    }
  }
  if (tool === "read") return "Reading the code";
  if (tool === "report_choice") return "Reporting its choice";
  return tool;
}

// Older picks sometimes name a stack ("A + B (with C)"); the first product is the pick.
export const primary = (s: string) => s.split(/\s\+\s|,|\swith\s|\s&\s/)[0].replace(/\(.*?\)/g, "").trim() || s;
const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9.]+/g, " ").trim();

function scoreTarget(p: Plan, cell: Cell): boolean {
  const name = norm(primary(cell.pick?.name ?? ""));
  let host = "";
  try {
    host = new URL(cell.pick?.url ?? "").hostname.replace(/^www\./, "");
  } catch {}
  const domainRoot = p.domain.split(".").slice(-2).join(".");
  if (host && (host === p.domain || host.endsWith("." + domainRoot) || host === domainRoot)) return true;
  if (name && p.aliases.some((a) => a && (name === norm(a) || name.split(" ").includes(norm(a))))) return true;
  const pk = new Set([...(cell.pick?.packages ?? []), ...cell.installs].map((x) => x.toLowerCase()));
  return p.packages.some((x) => pk.has(x));
}

// ---------- the driver ----------
async function drive(run: Run, nTasks: number) {
  note(run, `Planning ${nTasks} developer tasks from ${run.url}`);
  const p = await plan(run.url, nTasks);
  run.plan = p;
  run.cells = [];
  p.tasks.forEach((t, ti) =>
    ROSTER.forEach((m, mi) =>
      run.cells.push({ i: ti * ROSTER.length + mi, task: ti, model: m.key, stack: t.stack, attempt: 0, sessionId: null, state: "queued", activity: "Waiting for a computer", steps: 0, installs: [], throttled: 0, startedAt: null, endedAt: null, pick: null, isTarget: false, after: 0 }),
    ),
  );
  // Interleave models so the first starts cover every model.
  run.phase = "running";
  note(run, `${p.brand}: ${p.category}. ${run.cells.length} sessions, starting one every ${Math.round(run.gapMs / 1000)}s`);
  save(run);
  await loop(run);
}

async function loop(run: Run) {
  const p = run.plan!;
  let lastThrottleAt = 0;
  const starter = (async () => {
    for (;;) {
      const next = run.cells.find((c) => c.state === "queued" || c.state === "retrying");
      if (!next) {
        if (run.cells.every((c) => c.state === "done" || c.state === "failed")) return;
        await sleep(2000);
        continue;
      }
      next.state = "starting";
      next.attempt++;
      next.activity = next.attempt > 1 ? `Retrying (attempt ${next.attempt})` : "Starting a computer";
      // Fire and keep the beat: a start call takes a few seconds, the pacing is between call starts.
      const cell = next;
      void startSession({ run: `${run.id}-${cell.attempt}`, i: cell.i, task: p.tasks[cell.task].task, stack: cell.stack, model: cell.model }, { exp: run.id })
        .then((id) => {
          Object.assign(cell, { sessionId: id, after: 0, steps: 0, installs: [], throttled: 0, startedAt: Date.now(), endedAt: null, state: "running" });
        })
        .catch((e) => {
          cell.error = (e as Error).message.slice(0, 200);
          cell.state = cell.attempt < MAX_ATTEMPTS ? "retrying" : "failed";
          note(run, `Start failed for #${cell.i} (${cell.model}): ${cell.error}`);
        })
        .finally(() => save(run));
      // Adaptive pacing: back off after a throttle, creep back toward the floor otherwise.
      run.gapMs = Date.now() - lastThrottleAt < 60_000 ? Math.min(MAX_GAP, Math.round(run.gapMs * 1.5)) : Math.max(MIN_GAP, Math.round(run.gapMs * 0.9));
      await sleep(run.gapMs);
    }
  })();

  const poller = (async () => {
    while (!run.cells.every((c) => c.state === "done" || c.state === "failed")) {
      const live = run.cells.filter((c) => c.state === "running" && c.sessionId);
      await Promise.all(
        live.map(async (c) => {
          try {
            const evs = await events(c.sessionId!, c.after);
            for (const e of evs) {
              c.after = Math.max(c.after, e.seq ?? c.after);
              if (e.type === "tool.started") {
                c.steps++;
                c.activity = describe(e.data?.tool, e.data?.input);
                if (e.data?.tool === "shell") c.installs = [...new Set([...c.installs, ...installsFrom(String(e.data?.input?.command ?? ""))])];
              } else if (e.type === "tool.failed" && /Throttl/i.test(String(e.data?.message))) {
                c.throttled++;
                lastThrottleAt = Date.now();
                c.activity = "Waiting: platform throttled the computer";
              }
            }
            const s: any = await oc(`/sessions/${c.sessionId}`);
            const t = s.turns?.at(-1);
            const settled = t && ["completed", "failed", "cancelled"].includes(t.status);
            const timedOut = c.startedAt && Date.now() - c.startedAt > SESSION_TIMEOUT_MS;
            if (!settled && !timedOut) return;
            c.endedAt = Date.now();
            const d = s.result?.data;
            if (d && d.chosen?.name && !(c.throttled > 0 && c.steps <= 3)) {
              c.pick = { name: primary(d.chosen.name), url: d.chosen.url, supporting: d.supporting ?? [], alternatives: d.alternatives ?? [], reason: d.reason ?? "", verified: !!d.verified, packages: d.packages ?? [] };
              c.isTarget = scoreTarget(p, c);
              c.state = "done";
              c.activity = `Picked ${primary(d.chosen.name)}`;
            } else if ((c.throttled > 0 || c.steps < 2) && c.attempt < MAX_ATTEMPTS) {
              c.state = "retrying";
              c.activity = c.throttled ? "Throttled by the platform; queued to retry" : "Failed to start; queued to retry";
              note(run, `#${c.i} (${c.model}) ${c.throttled ? `throttled ${c.throttled}x` : "failed early"}, retrying`);
            } else {
              c.state = "failed";
              c.activity = timedOut ? "Timed out" : t?.status === "failed" ? "The agent failed" : "Finished without reporting a choice";
            }
          } catch (e) {
            c.error = (e as Error).message.slice(0, 200);
          }
        }),
      );
      save(run);
      await sleep(3000);
    }
  })();

  await Promise.all([starter, poller]);
  run.phase = "done";
  note(run, "All sessions finished");
  save(run);
}

// ---------- the public view ----------
export function view(run: Run) {
  const p = run.plan;
  const done = run.cells.filter((c) => c.state === "done");
  const tally = new Map<string, { name: string; url: string; count: number; target: boolean }>();
  for (const c of done) {
    const key = norm(primary(c.pick!.name)) || "none";
    const cur = tally.get(key) ?? { name: primary(c.pick!.name), url: c.pick!.url, count: 0, target: c.isTarget };
    cur.count++;
    tally.set(key, cur);
  }
  const byModel = ROSTER.map((m) => {
    const cs = run.cells.filter((c) => c.model === m.key);
    const d = cs.filter((c) => c.state === "done");
    const top = new Map<string, number>();
    for (const c of d) top.set(primary(c.pick!.name), (top.get(primary(c.pick!.name)) ?? 0) + 1);
    return { key: m.key, label: m.label, color: m.color, total: cs.length, done: d.length, picked: d.filter((c) => c.isTarget).length, top: [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3) };
  });
  return {
    id: run.id,
    url: run.url,
    phase: run.phase,
    error: run.error ?? null,
    createdAt: run.createdAt,
    gapMs: run.gapMs,
    plan: p && { brand: p.brand, domain: p.domain, category: p.category, summary: p.summary, tasks: p.tasks },
    roster: ROSTER,
    counts: {
      total: run.cells.length,
      queued: run.cells.filter((c) => c.state === "queued" || c.state === "retrying").length,
      running: run.cells.filter((c) => c.state === "running" || c.state === "starting").length,
      done: done.length,
      failed: run.cells.filter((c) => c.state === "failed").length,
      picked: done.filter((c) => c.isTarget).length,
      throttled: run.cells.reduce((n, c) => n + c.throttled, 0),
    },
    leaderboard: [...tally.values()].sort((a, b) => b.count - a.count),
    byModel,
    cells: run.cells.map(({ after, ...c }) => (c.pick ? { ...c, pick: { ...c.pick, name: primary(c.pick.name) } } : c)),
    log: run.log.slice(-12),
  };
}
