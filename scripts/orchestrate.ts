// Run the agentpicks orchestrator once and print its scoreboard: npx tsx scripts/orchestrate.ts https://acme.com 1
import { ENV, ROOT_AGENT, events, oc } from "../lib/oc.ts";
const [url = "https://e2b.dev", tasks = "1"] = process.argv.slice(2);
const { session } = await oc("/sessions", { method: "POST", idem: `agentpicks/orchestrate/${Date.now()}`, body: { agentId: `${ROOT_AGENT}@${ENV}`, labels: { app: "agentpicks-orchestrator" } } });
await oc(`/sessions/${session.id}/turns`, { method: "POST", body: { input: `Run Agent Picks for ${url} with ${tasks} requests.`, idempotencyKey: `${session.id}/t`, payload: { url, tasks: Number(tasks) } } });
console.log("orchestrator session", session.id);
let after = 0;
for (;;) {
  for (const e of await events(session.id, after)) {
    after = Math.max(after, e.seq);
    if (e.type === "tool.started") console.log(new Date().toISOString().slice(11, 19), "▸", e.data?.tool, JSON.stringify(e.data?.input ?? {}).slice(0, 140));
    if (e.type === "tool.completed" && /experiment/.test(e.data?.tool)) console.log("   ←", String(e.data?.output).slice(0, 300));
    if (e.type === "tool.failed") console.log("   ✕", e.data?.tool, e.data?.message);
  }
  const s: any = await oc(`/sessions/${session.id}`);
  const t = s.turns?.at(-1);
  if (t && ["completed", "failed", "cancelled"].includes(t.status)) {
    console.log("turn", t.status);
    console.log(JSON.stringify(s.result?.data, null, 2));
    for (const e of await events(session.id)) if (e.type === "message.completed") console.log(e.data?.text);
    break;
  }
  await new Promise((r) => setTimeout(r, 8000));
}
