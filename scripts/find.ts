import { ENV, oc, events } from "../lib/oc.ts";
const [key, val] = (process.argv[2] ?? "").split("=");
const r: any = await oc(`/sessions?environment=${ENV}&label.${key}=${val}&limit=50`);
for (const s of r.sessions) {
  const ev = await events(s.id);
  const th = ev.filter((e) => /Throttl/.test(JSON.stringify(e.data ?? {}))).length;
  const tools = ev.filter((e) => e.type === "tool.started").length;
  console.log(s.id.slice(0, 8), s.labels?.model, s.status, "tools", tools, "throttles", th, "result", s.result?.data?.chosen?.name ?? "-");
}
