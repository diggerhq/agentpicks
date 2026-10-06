// The five coding-agent models. Each runs as its own OpenComputer project (see scripts/gen-agents.ts).
export const ROSTER = [
  { key: "claude", model: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", color: "#D97757" },
  { key: "gpt", model: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", color: "#10A37F" },
  { key: "gemini", model: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", color: "#4285F4" },
  { key: "grok", model: "x-ai/grok-4.7", label: "Grok 4.7", color: "#6B6B6B" },
  { key: "deepseek", model: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1", color: "#4D6BFE" },
] as const;
export type ModelKey = (typeof ROSTER)[number]["key"];
