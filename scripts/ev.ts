import { events } from "../lib/oc.ts";
const e = await events(process.argv[2]);
for (const x of e) console.log(x.seq, x.type, JSON.stringify(x.data).slice(0, Number(process.argv[3] ?? 300)));
