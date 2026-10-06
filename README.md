# Agent Picks

**Do coding agents pick you?** Paste a company's URL. Agent Picks writes realistic
developer requests for that company's category, then gives each request to a coding
agent running on its own [OpenComputer](https://opencomputer.dev) computer. Each agent
sets up a project, researches options, installs a vendor, writes the integration and
type-checks it. You watch live which vendor every agent actually chose.

- **Five models, every task:** Claude Sonnet 5.5, GPT-6.1 Sol, Gemini 3.8 Flash,
  Grok 4.7 and DeepSeek V4.1. 20 tasks × 5 models = 100 sessions.
- **Agents are never told whose site it is.** Tasks describe the need, never a vendor.
- **Picks are checked against evidence:** each agent reports its choice through a
  result tool, and the app cross-checks it against the `npm`/`pip` install commands
  in the session's event log.

## How it works

```
URL ──► planner (one model call) ──► N developer tasks (nextjs / express / fastapi)
                                          │
              ┌───────────────────────────┴───────────────────────────┐
              ▼                                                       ▼
   session: agent-picks-claude@development        …  session: agent-picks-deepseek@development
   own computer · shell · web_search · web_fetch · report_choice (result tool)
              │                                                       │
              └──────────────► event log + result ◄──────────────────┘
                                          │
                                web app: live grid, leaderboard, per-model table
```

| Path | What it is |
| - | - |
| `agent-template/` | The coding agent: instructions, built-in `shell`/`read`, Exa `web_search`, `web_fetch`, and the `report_choice` result tool. `__MODEL__` is filled in per model. |
| `scripts/gen-agents.ts` | Generates `projects/<model>/`, one OpenComputer project per model, from the template. |
| `lib/roster.ts` | The model roster. |
| `lib/oc.ts` | Server-side client for the OpenComputer management API. |
| `web/planner.ts` | URL → brand, aliases, package names and developer tasks. |
| `web/runner.ts` | Paced launcher, retries, live activity from event logs, scoring. |
| `web/server.ts`, `web/index.html` | The local web app. |

## Run it

You need Node.js 22+, an OpenComputer account, and an [Exa](https://exa.ai) API key.

```bash
npm install
npx opencomputer login
echo "EXA_API_KEY=..." > opencomputer/.env.local

npm run gen                      # writes projects/<model>/
for k in claude gpt gemini grok deepseek; do
  (cd projects/$k \
    && npx opencomputer link --create-project agent-picks-$k \
    && printf %s "$EXA_API_KEY" | npx opencomputer secrets set EXA_API_KEY --value-stdin)
done
npm run deploy:all               # deploys each project to Development, one at a time

npm run web                      # http://127.0.0.1:8790
```

Enter a URL, choose 10–100 sessions, and send the agents.

The app uses your OpenComputer CLI login (or `OPENCOMPUTER_API_KEY`) on the server.
It is a local tool: there is no authentication, so do not expose it publicly as is.

### Settings

| Variable | Default | Meaning |
| - | - | - |
| `START_GAP_MS` | `4000` | Minimum time between session starts. The launcher backs off automatically when the platform rate-limits. |
| `PLANNER_MODEL` | `anthropic/claude-sonnet-5.5` | Model that writes the developer tasks. |
| `OC_ENVIRONMENT` | `development` | Which environment's agents to run. |
| `PORT` | `8790` | Web app port. |

### Changing the agent or the models

Edit `agent-template/` or `lib/roster.ts`, then `npm run gen` and `npm run deploy:all`.
A new model needs its own project (`opencomputer link --create-project agent-picks-<key>`)
and the Exa secret.

## Caveats

- These are coding agents running these models on OpenComputer's harness, not the
  Claude Code, Codex or Cursor apps themselves. Label results accordingly.
- Each session is a real coding run (typically 2–8 minutes). Start with 10–20 sessions
  and check your usage before running 100.
