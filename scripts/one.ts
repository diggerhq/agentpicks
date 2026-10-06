import { events, oc, startSession } from "../lib/oc.ts";
const [model = "claude", stack = "nextjs"] = process.argv.slice(2);
const task = process.argv[4] ?? "Our app needs to let users run AI-generated Python snippets safely and see the output. Add an API route that takes code and returns stdout/stderr.";
const run = "smoke-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const id = await startSession({ run, i: 0, task, stack, model });
console.log("session", id, "run", run);
let seen = 0;
for (;;) {
  const evs = await events(id, seen);
  for (const e of evs) {
    seen = Math.max(seen, e.seq ?? seen);
    if (e.type === "tool.started") console.log(new Date().toISOString().slice(11, 19), "▸", e.data?.tool, JSON.stringify(e.data?.input ?? e.data?.args ?? "").slice(0, 160));
    else if (["turn.completed", "turn.failed", "tool.failed", "session.failed"].includes(e.type)) console.log(e.type, JSON.stringify(e.data).slice(0, 400));
  }
  const s: any = await oc(`/sessions/${id}`);
  const t = s.turns?.at(-1);
  if (t && ["completed", "failed", "cancelled"].includes(t.status)) { console.log(JSON.stringify(s.result, null, 2)); break; }
  await new Promise((r) => setTimeout(r, 4000));
}
