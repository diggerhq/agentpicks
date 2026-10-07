// End every still-active session carrying label run=<id> (or exp=<id> for web runs).
import { ENV, oc } from "../lib/oc.ts";
const [id, key = "run"] = process.argv.slice(2);
const r: any = await oc(`/sessions?environment=${ENV}&label.${key}=${id}&limit=100`);
let n = 0;
for (const s of r.sessions) if (!["ended", "failed"].includes(s.status)) { await oc(`/sessions/${s.id}/end`, { method: "POST" }).catch((e) => console.log(e.message)); n++; }
console.log(`ended ${n} of ${r.sessions.length}`);
