// Local server: the page plus the API handler. `npm run web` → http://127.0.0.1:8790
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { handle } from "./app.ts";

const PORT = Number(process.env.PORT ?? 8790);
createServer((req, res) => {
  if (req.method === "GET" && !req.url?.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(readFileSync("public/index.html", "utf8"));
  }
  void handle(req, res);
}).listen(PORT, "127.0.0.1", () => console.log(`agentpicks on http://127.0.0.1:${PORT} (${process.env.APP_MODE === "public" ? "public" : "local"} mode)`));
