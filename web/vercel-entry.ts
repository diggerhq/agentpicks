// Vercel function: every /api/* request is rewritten here (vercel.json).
import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "./app.ts";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handle(req, res);
}
