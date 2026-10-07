import { ENV, oc } from "../lib/oc.ts";
const r: any = await oc(`/sessions?environment=${ENV}&limit=${process.argv[2] ?? 15}`);
for (const s of r.sessions) console.log(s.createdAt, s.id.slice(0, 8), s.agentId, s.status, JSON.stringify(s.labels).slice(0, 80), s.result ? "RESULT" : "");
