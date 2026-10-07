# Agent Picks

**Do coding agents pick you?** Give Agent Picks a product's URL. It drafts realistic
developer requests for that product's category, then runs every request as a coding
agent on its own [OpenComputer](https://opencomputer.dev) computer, on five models at
once. Each agent scaffolds a project, picks a vendor, reads its docs, installs it, writes the
integration and type-checks it. You see which vendor every agent actually chose.

[![Deploy to OpenComputer](https://img.shields.io/badge/Deploy%20to-OpenComputer-161513)](https://app.opencomputer.dev/new?repository-url=https%3A%2F%2Fgithub.com%2Fdiggerhq%2Fagentpicks)

Deployed from the template, it **runs every Monday on a schedule** against your
`TARGET_URL`, so you can watch whether coding agents start picking you.

- **Five models, every request:** Claude Sonnet 5.5, GPT-6.1 Sol, Gemini 3.8 Flash,
  Grok 4.7 and DeepSeek V4.1.
- **Agents never learn whose site it is.** Requests describe the need, never a vendor.
- **No web search,** like a default local OpenCode setup: agents choose from what the model
  knows and can read pages at URLs they know (`web_fetch`).
- **Picks are checked against evidence:** each agent reports its choice through a result
  tool, cross-checked against the `npm`/`pip` install commands in its session log.

## How it works

```
                 ┌─ weekly schedule (TARGET_URL) ─┐      ┌─ web app (edit requests, watch live) ─┐
                 ▼                                 │      ▼                                        │
       agentpicks orchestrator  ── or ──────────────────  /api/runs                                │
   reads the homepage, writes requests                                                            │
                 │  start one session per request × model (management API)                        │
                 ▼                                                                                 │
   agentpicks--dev-claude · --dev-gpt · --dev-gemini · --dev-grok · --dev-deepseek                │
   each session: own computer · shell · web fetch · report_choice (result tool) ──────────────┘
```

| Path | What it is |
| - | - |
| `opencomputer/agents/agentpicks/` | The orchestrator: plans requests, starts the coding sessions, waits, records the scoreboard. Has the weekly schedule. |
| `agent-template/` | The coding agent. `npm run gen` copies it to `opencomputer/agents/dev-<model>/`, one agent per model. |
| `lib/roster.ts` | The five models. |
| `web/` | The web app's API (`app.ts`), planner, and activity parsing. |
| `public/index.html` | The web app: URL → editable requests → live fleet view → scoreboard. |
| `oc-template.toml` | The one-click template manifest. |

## Deploy your own (one click)

1. Click **Deploy to OpenComputer** above.
2. Fill in `TARGET_URL` (your homepage) and an `OPENCOMPUTER_API_KEY`.
3. The first run starts right away with 2 requests (10 coding sessions). After that, the
   `weekly` schedule runs in Production every Monday at 14:00 UTC. Change it in
   `opencomputer/agents/agentpicks/schedules/weekly.ts`.

Or from the CLI: `npx opencomputer template deploy https://github.com/diggerhq/agentpicks`.

Each scheduled run's scoreboard is the orchestrator session's result: the share of
finished agents that picked you, a leaderboard of picks, and a breakdown by model.

## Run the web app

The web app lets you edit the requests before a run and watch every computer live.

```bash
npm install
npx opencomputer login
npm run web            # http://127.0.0.1:8790, uses your CLI login and the Production agents
```

If your project isn't named `agentpicks`, set `OC_AGENT=<your project id>`.

### Host a public demo

`npm run web:public` (or the Vercel setup: `npm run bundle:vercel`, then deploy; set
`APP_MODE=public`, `OPENCOMPUTER_API_KEY`, `IP_SALT` and a Blob store) limits visitors:

| Variable | Default | Meaning |
| - | - | - |
| `PUBLIC_TRIES` | `3` | Runs per IP address, ever. |
| `PUBLIC_DAILY_CAP` | `50` | Runs per day across everyone. |
| `PUBLIC_MAX_TASKS` | `5` | Requests per run (× 5 models). |
| `IP_SALT` | | Secret used to hash IP addresses before they are stored as session labels. |

When a visitor runs out, the page prompts them to deploy their own copy, which runs weekly
by default.

## Develop

```bash
npm run gen            # regenerate the per-model coding agents from agent-template/
npm run deploy         # deploy to Development, then Production
npx tsx scripts/orchestrate.ts https://acme.com 1   # one orchestrator run, printed
```

Every session in a run starts at once. Sessions that end without reporting a pick are
retried once automatically.

## Caveats

- These are coding agents running these models on OpenComputer's harness, not the Claude
  Code, Codex or Cursor apps themselves. Label results accordingly.
- Each session is a real coding run (typically 2–8 minutes). Check your usage before
  running large experiments.
