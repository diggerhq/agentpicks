// Local web app: start an experiment from a URL and watch the coding agents live.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRun, getRun, listRuns, resumeRuns, retryFailed, view } from "./runner.ts";

const PORT = Number(process.env.PORT ?? 8790);
const SIZES = [10, 20, 50, 100];
resumeRuns();

function send(res: any, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/run/"))) return send(res, 200, readFileSync("web/index.html", "utf8"), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/api/runs") return send(res, 200, listRuns());
    const m = url.pathname.match(/^\/api\/runs\/([a-z0-9]+)$/);
    if (req.method === "GET" && m) {
      const run = getRun(m[1]);
      return run ? send(res, 200, view(run)) : send(res, 404, { error: "not found" });
    }
    const rf = url.pathname.match(/^\/api\/runs\/([a-z0-9]+)\/retry-failed$/);
    if (req.method === "POST" && rf) return send(res, 200, { requeued: retryFailed(rf[1]) });
    if (req.method === "POST" && url.pathname === "/api/runs") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      const target = String(body.url ?? "").trim();
      if (!target) return send(res, 400, { error: "Enter a URL" });
      const size = SIZES.includes(Number(body.size)) ? Number(body.size) : 20;
      const run = createRun(target, size);
      return send(res, 201, { id: run.id });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: (e as Error).message });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`agent-picks on http://127.0.0.1:${PORT}`));
