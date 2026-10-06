// Start N sessions spaced by GAP ms; report how many hit platform throttling.
import { events, oc, startSession } from "../lib/oc.ts";
import { ROSTER } from "../lib/roster.ts";
const N = Number(process.argv[2] ?? 10), GAP = Number(process.argv[3] ?? 2000);
const run = "ramp-" + Date.now().toString(36);
const ids: string[] = [];
for (let i = 0; i < N; i++) {
  ids.push(await startSession({ run, i, task: "Add a /hello route that returns the current time.", stack: "express", model: ROSTER[i % ROSTER.length].key }));
  await new Promise((r) => setTimeout(r, GAP));
}
console.log("started", N, "run", run);
const done = new Set<string>();
const t0 = Date.now();
while (done.size < N && Date.now() - t0 < 600_000) {
  for (const id of ids) {
    if (done.has(id)) continue;
    const s: any = await oc(`/sessions/${id}`);
    const t = s.turns?.at(-1);
    if (t && ["completed", "failed", "cancelled"].includes(t.status)) done.add(id);
  }
  await new Promise((r) => setTimeout(r, 5000));
}
let throttled = 0, results = 0;
for (const id of ids) {
  const ev = await events(id);
  const th = ev.filter((e) => JSON.stringify(e.data ?? {}).includes("Throttling")).length;
  const s: any = await oc(`/sessions/${id}`);
  if (th) throttled++;
  if (s.result) results++;
  console.log(id.slice(0, 8), s.labels?.model, "throttle events:", th, "result:", s.result?.data?.chosen?.name ?? "-", "turn:", s.turns?.at(-1)?.status);
}
console.log(`throttled sessions ${throttled}/${N}, results ${results}/${N}`);
