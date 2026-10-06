import { plan } from "../web/planner.ts";
console.log(JSON.stringify(await plan(process.argv[2] ?? "opencomputer.dev", Number(process.argv[3] ?? 4)), null, 2));
