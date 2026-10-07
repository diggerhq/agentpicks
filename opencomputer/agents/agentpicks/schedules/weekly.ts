import { defineSchedule } from "@opencomputer/agent";

// Weekly experiment against TARGET_URL. Runs automatically in Production;
// Development shows it as "Manual only" (Run now).
export default defineSchedule({
  id: "weekly",
  cron: "0 14 * * 1",
  timezone: "UTC",
  enabled: ["production"],
  overlap: "skip",
  dispatch: {
    text: "Run the weekly Agent Picks experiment.",
    payload: { mode: "scheduled" },
  },
});
