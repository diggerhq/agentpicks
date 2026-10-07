// Turns session events into terminal-style activity lines, install evidence and scores.

const SETUP_PREFIX = "mkdir -p ~/workspace";

export function installsFrom(command: string): string[] {
  if (command.startsWith(SETUP_PREFIX)) return [];
  const out: string[] = [];
  // Only real install commands: each &&/;/| segment must start with the installer.
  for (const seg of command.split(/&&|\|\||;|\||\n/)) {
    const m = seg.trim().match(/^(?:(?:\.venv\/bin\/|\S*\/)?(?:npm\s+(?:i|install|add)|pnpm\s+(?:add|i|install)|yarn\s+add|bun\s+add|pip3?\s+install|python3?\s+-m\s+pip\s+install|uv\s+(?:add|pip\s+install)|poetry\s+add))\s+(.+)$/);
    if (!m) continue;
    for (const tok of m[1].trim().split(/\s+/)) {
      if (tok.startsWith("-")) continue;
      if (tok.startsWith(">") || tok.startsWith("2>")) break;
      const name = tok.replace(/^['"]|['"]$/g, "").replace(/(?<=.)@[^/]*$/, "").replace(/[=<>~!].*$/, "").replace(/\[.*\]$/, "").toLowerCase();
      if (!/^@?[a-z0-9][a-z0-9._\-]*(\/[a-z0-9._\-]+)?$/.test(name) || /requirements/.test(name)) break;
      out.push(name);
    }
  }
  return out;
}

/** One terminal line for a tool call. Tool names carry a per-agent suffix (web_fetch_gpt). */
export function line(tool: string, input: any): { kind: string; text: string } {
  const t = tool.replace(/_(claude|gpt|gemini|grok|deepseek)$/, "");
  if (t === "shell") {
    const c = String(input?.command ?? "").trim();
    if (c.startsWith(SETUP_PREFIX)) {
      const stack = c.includes("create-next-app") ? "next.js" : c.includes("fastapi") ? "fastapi" : "express";
      return { kind: "setup", text: `$ scaffold ${stack} app` };
    }
    const inst = installsFrom(c);
    if (inst.length) return { kind: "install", text: `$ install ${inst.slice(0, 4).join(" ")}` };
    const first = c.replace(/^cd [^&;]+(&&|;)\s*/, "").split("\n")[0];
    const kind = /tsc|typecheck|mypy|pytest|python3? -c|npm (run )?(build|test)/.test(first) ? "check" : "shell";
    return { kind, text: `$ ${first.slice(0, 90)}` };
  }
  if (t === "web_fetch") {
    try {
      const u = new URL(String(input?.url));
      return { kind: "fetch", text: `↗ ${u.hostname.replace(/^www\./, "")}${u.pathname.length > 1 ? u.pathname.slice(0, 40) : ""}` };
    } catch {
      return { kind: "fetch", text: "↗ reading a page" };
    }
  }
  if (t === "read") return { kind: "shell", text: `$ cat ${String(input?.path ?? "").replace(/^\/root\/workspace\/app\/?/, "")}`.slice(0, 90) };
  if (t === "report_choice") return { kind: "report", text: `✓ chose ${String(input?.chosen_name ?? "")}` };
  return { kind: "shell", text: `· ${t}` };
}

export const primary = (s: string) => s.split(/\s\+\s|,|\swith\s|\s&\s/)[0].replace(/\(.*?\)/g, "").trim() || s;
export const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9.]+/g, " ").trim();

export type Target = { domain: string; aliases: string[]; packages: string[] };

export function isTarget(t: Target, pick: { name?: string; url?: string; packages?: string[] } | null | undefined): boolean {
  if (!pick) return false;
  const name = norm(primary(String(pick.name ?? "")));
  let host = "";
  try {
    host = new URL(String(pick.url ?? "")).hostname.replace(/^www\./, "");
  } catch {}
  const root = t.domain.split(".").slice(-2).join(".");
  if (host && (host === t.domain || host === root || host.endsWith("." + root))) return true;
  if (name && t.aliases.some((a) => a && (name === norm(a) || name.split(" ").includes(norm(a))))) return true;
  const pk = new Set((pick.packages ?? []).map((x) => String(x).toLowerCase()));
  return t.packages.some((x) => pk.has(x.toLowerCase()));
}
