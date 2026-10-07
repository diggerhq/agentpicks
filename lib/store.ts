// Tiny JSON store: Vercel Blob when BLOB_READ_WRITE_TOKEN is set, local files otherwise.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const LOCAL = "runs/store";
const blob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export async function put(key: string, value: unknown) {
  const body = JSON.stringify(value);
  if (blob()) {
    const { put } = await import("@vercel/blob");
    await put(`agentpicks/${key}`, body, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    return;
  }
  const p = join(LOCAL, key);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

export async function get<T>(key: string): Promise<T | null> {
  if (blob()) {
    const { head } = await import("@vercel/blob");
    try {
      const h = await head(`agentpicks/${key}`);
      const r = await fetch(`${h.url}?v=${Date.now()}`);
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  }
  const p = join(LOCAL, key);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}

/** Local mode only: recent run ids, newest first. */
export function listLocal(prefix: string): string[] {
  const d = join(LOCAL, prefix);
  if (blob() || !existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
}
