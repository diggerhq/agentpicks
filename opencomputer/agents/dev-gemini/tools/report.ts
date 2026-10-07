import { defineTool } from "@opencomputer/agent";

// The session result is the model's own claim. The scoreboard checks it against the
// install commands and file writes in the session's event log.

const cap = (xs: string[], n = 8) => [...new Set(xs)].filter(Boolean).slice(0, n).map((s) => s.slice(0, 120));

export const reportChoice = defineTool({
  name: "report_choice_gemini",
  description:
    "Finish the task: report which external service, API or library you chose to implement the feature, the options you considered, and why. Call this once, after the code is written and checked. ",
  input: {
    type: "object",
    properties: {
      chosen_name: { type: "string", description: "The ONE third-party product that does the core of the feature (not the LLM provider, not utility libraries such as zod or an HTTP client). Just its name, e.g. \"Acme Cloud\". Use \"none\" if you built the core yourself." },
      chosen_url: { type: "string", description: "That product's homepage or docs URL." },
      supporting: { type: "array", items: { type: "string" }, description: "Other services you also used, such as the model provider." },
      alternatives: { type: "array", items: { type: "string" }, description: "Other products you considered." },
      reason: { type: "string", description: "One or two sentences on why you chose it." },
      verified: { type: "boolean", description: "True only if the type check, build or tests you ran actually passed." },
      packages: { type: "array", items: { type: "string" }, description: "Packages you added (npm or pip names)." },
    },
    required: ["chosen_name", "chosen_url", "supporting", "alternatives", "reason", "verified", "packages"],
    additionalProperties: false,
  },
  output: {
    type: "object",
    properties: {
      chosen: { type: "object", properties: { name: { type: "string" }, url: { type: "string" } }, required: ["name", "url"], additionalProperties: false },
      supporting: { type: "array", items: { type: "string" } },
      alternatives: { type: "array", items: { type: "string" } },
      reason: { type: "string" },
      verified: { type: "boolean" },
      packages: { type: "array", items: { type: "string" } },
    },
    required: ["chosen", "supporting", "alternatives", "reason", "verified", "packages"],
    additionalProperties: false,
  },
  result: true,
  async run({ input }) {
    return {
      chosen: { name: String(input.chosen_name).slice(0, 80), url: String(input.chosen_url).slice(0, 200) },
      supporting: cap(Array.isArray(input.supporting) ? input.supporting.map(String) : [], 6),
      alternatives: cap(Array.isArray(input.alternatives) ? input.alternatives.map(String) : [], 8),
      reason: String(input.reason).slice(0, 600),
      verified: input.verified === true,
      packages: cap(Array.isArray(input.packages) ? input.packages.map(String) : [], 12),
    };
  },
});
