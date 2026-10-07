import { useInput, useModel, useTool } from "@opencomputer/agent";
import { checkExperiment, reportExperiment, startExperiment } from "./tools/experiment.js";

// The orchestrator: reads a product's homepage, writes vendor-neutral developer
// tasks, starts one coding session per task per model, waits, and records the
// scoreboard. Runs on a weekly schedule against TARGET_URL, or on demand.

type Job = { url?: string; tasks?: number; mode?: string };

export default function AgentPicks() {
  const input = useInput();
  const job = (input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload : {}) as Job;
  useModel("anthropic/claude-sonnet-5.5");
  useTool("webfetch");
  useTool(startExperiment);
  useTool(checkExperiment);
  useTool(reportExperiment);

  const url = job.url ?? input.text?.match(/https?:\/\/\S+|\b[a-z0-9-]+(\.[a-z0-9-]+)+\.[a-z]{2,}\S*/i)?.[0] ?? process.env.TARGET_URL ?? "";
  const n = Math.min(Math.max(Number(job.tasks ?? process.env.TASKS_PER_RUN ?? 4) || 4, 1), 20);

  if (!url) {
    return `Explain briefly that Agent Picks needs a product URL: either mention one in the
message (for example "Run Agent Picks for https://acme.com") or set the TARGET_URL runtime
variable, which the weekly schedule uses. Do not call any tools.`;
  }

  return `You run Agent Picks: a fair experiment that measures how often AI coding agents choose
a given product when developers ask them to build something.

Product URL: ${url}
Tasks to write: ${n} (each runs on 5 models, so ${n * 5} coding sessions)

1. Fetch the product's homepage with webfetch. Work out the brand name, its domain, other
   names it goes by (lowercase), its npm/pip package names if you know them, and its category.
2. Write exactly ${n} developer requests, the way a real developer would type them to a coding
   agent inside an existing app, where a product in this category is a natural solution.
   - Never name this product, its competitors, or any vendor. Describe the need.
   - Vary the use case and constraints (budget, scale, latency, compliance, self-hosting,
     open source). 1 to 3 sentences, first person, concrete about what to build.
   - Spread them across the stacks nextjs, express and fastapi.
3. Call start_experiment with the tasks.
4. Call check_experiment with wait_seconds 20, one call at a time (never two in
   parallel), repeatedly, until running is 0 or about 40 minutes have passed.
5. Call report_experiment once.
6. Reply with a short summary: the share of finished sessions that picked the product,
   the top picks, and any model that differed notably.`;
}
