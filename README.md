# Pro Dash

[![Release](https://img.shields.io/github/v/release/heberholanda/Claude-ProDash)](https://github.com/heberholanda/Claude-ProDash/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757)

Pro Dash is a dashboard mod for [Claude Code](https://claude.com/claude-code). It keeps one pane beside the chat showing system load, the session's model and limits, MCP servers, the context window breakdown, the git repository and the live subagents (forks). It also has views for permission checks, project progress and color themes.

![Pro Dash beside a Claude Code session](docs/screenshot.png)

**Highlights**

- **Live system and session status**: CPU, GPU and RAM; model, effort, cost, context window and the 5h / weekly limits with reset time.
- **Subagents at a glance**: every running fork with its current activity, time and tokens; click one to open its transcript.
- **Context and MCP breakdown**: what fills the context window, and which MCP servers cost the most tokens.
- **Git for GitHub, GitLab, Bitbucket and Azure DevOps**: branch, sync state, pending files and the open PR / MR.
- **Permission audit**: every permission check, who approved it, how long it waited and which rules decided.
- **Project board**: plan progress, files touched, request timeline, background jobs and schedules.
- **Themes**: 8 presets and custom colors, per repository or one global theme.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install prodash --marketplace heberholanda/Claude-ProDash
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install prodash --marketplace heberholanda/Claude-ProDash
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `heberholanda/Claude-ProDash`, then **Add plugin**.

### Update

```
claude plugin marketplace update claude-prodash
claude plugin update prodash@claude-prodash
```

Then run `/reload-plugins` in an open session, or start a new one. What changed in each version is in [Releases](https://github.com/heberholanda/Claude-ProDash/releases).

### Uninstall

```
claude plugin uninstall prodash@claude-prodash
```

### Requirements

| Feature | Needs |
| --- | --- |
| CPU / GPU / RAM in System Status | Windows (PowerShell + CIM). Other systems, or no GPU counters, show `n/a`. |
| Git section, per-repository themes | `git` on the PATH and a git repository as the session folder (outside a repo, themes are kept per folder) |
| Open PR / MR in Git section | the provider's CLI installed and signed in: [`gh`](https://cli.github.com/) for GitHub, [`glab`](https://gitlab.com/gitlab-org/cli) for GitLab, [`az`](https://learn.microsoft.com/cli/azure/) with the `azure-devops` extension for Azure DevOps; Bitbucket uses its public REST API through Claude Code's own HTTP call (public repositories only). Other hosts show no PR line. |
| 5h / 7d rate limits | a Claude subscription (the API has no such windows) |

## Use

The pane opens by itself when the terminal is wide enough (144+ columns). Type `/prodash` to open it at any time.

When it is docked beside the transcript, the pane can take up to 45% of the terminal's width. A wide terminal shows everything.

### Main view

| Section | Shows |
| --- | --- |
| **System Status** | `ONLINE` / `DEGRADED` (CPU ≥ 90%) / `SYNCING`, CPU bar, GPU bar (busiest engine, as Task Manager shows it), RAM used/total, CPU history |
| **Agent Overview** | model · branch, busy/idle, effort level, permission mode, context window bar with tokens used/window and compactions, session cost and request count, one row each for the 5h round and the weekly limit: % used, reset time and time left (`no reading yet` until the API reports that window) |
| **Action Bar** | `1` Forks · `2` Perms · `3` Board · `4` MCP · `5` Context · `6` Theme; the open view is the bright one |
| **MCP Servers** | connected servers, tool count and schema tokens; the 5 heaviest servers with their tokens (failed / pending ones first, with their status) |
| **Context** | % used, tokens used / window, a stacked bar, the 4 heaviest categories and the free space, with tokens and share |
| **Git** | titled by the remote's provider (GitHub, GitLab, Bitbucket, Azure DevOps, or the host name): `owner/repo`, branch → upstream, ahead/behind, stash, open PR (MR on GitLab), last commit, files pending commit (staged / modified / new) with their paths |
| **Active Forks** | `main` and one row per running subagent with its current activity (the task it has in progress, else its latest tool call), elapsed time and tokens; click a row to open that agent's transcript, `main` to come back |

### Action bar views

Press the key again, or **BACK**, to return to the main view.

**`1` Forks**: Active Forks at full height, for when the list does not fit the main view: `main` and every subagent with its current activity, tool calls, elapsed time and tokens. Pick one to open its transcript, `main` to come back.

**`2` Perms**: every permission check of the session.
- A color strip with one square per check: allowed, approved by the auto-mode classifier, approved by you, pending, denied.
- Totals by kind, by category (file · shell · other), reads vs writes, main vs forks.
- Average wait for an approval and the auto-approve rate.
- **Top rules**: the settings rules that decided most often.
- **Top tools**: calls run and denied per tool.
- **Recent asks & denials**: time, outcome, tool, command or file, wait, and the reason for a denial.

**`3` Board**:
- **Plan**: steps of the last approved plan (plan mode) with progress, marked done when a completed task matches the step; task counts and the task in progress.
- **Files touched**: each file edited this session with `+` / `−` lines, new files marked.
- **Timeline**: your requests with time, tool calls and duration.
- **Background**: shells and monitors running in the background.
- **Scheduled**: cron jobs and wakeups with their next run.

**`4` MCP**: every MCP server with its status, tools loaded / total, calls, errors, average latency, last use and schema tokens, and the error of a failed one; the summary splits the tokens in context now from the deferred ones.

**`5` Context**: the whole `/context` breakdown: model, autocompact threshold, every category (messages, system tools, skills, system prompt, MCP tools, memory files, autocompact buffer, free space, deferred tools) heaviest first with Free space last, the memory files with their tokens, and the skills heaviest first.

**`6` Theme**: the dashboard's colors.
- **Presets** (soft palettes): `default`, `matrix`, `dracula`, `nord`, `amber`, `cyberpunk`, `mono`, and `vivid` (bright colors).
- **Custom**: starts from the last preset and lets you set each role (border, ok, warn, bad, info, accent, dim, text) from a list of colors or by typing `#rrggbb` + Enter. Changed roles show `*`; **RESET CUSTOM** undoes them.
- **Per repository**: each repository (by its root folder; outside a repo, the session folder) can have its own theme. A repo without one uses the global theme. The header shows the theme in use and where it comes from: `(repo)`, `(global)` or `(global, forced)`.
- **Scope**: `This repo` saves preset and color changes for the current repository only; `Global` saves them to the global theme. The view opens on the scope of the theme in use.
- **Force global theme**: every repository uses the global theme; repo themes are kept and come back when it is turned off.
- **USE GLOBAL IN THIS REPO**: drops this repository's own theme.
- Themes are saved across sessions.

To type in the custom fields, open the pane with `/prodash` so it holds the keyboard.

## How it gets its data

The mod only uses the Claude Code plugin API: it reads tool calls, permission checks, model requests, turns and the session's usage as they happen. What it runs, sends and hooks is listed in [What the mod runs, sends and hooks](#what-the-mod-runs-sends-and-hooks).

| Data | Source |
| --- | --- |
| Agents and forks | `$.agent.list()`, polled every 250 ms while a fork runs, every 1 s otherwise |
| Context, cost, rate limits | `$.session.usage()` every 1 s, written only when a figure changes |
| Context breakdown, MCP schema tokens | `$.session.usage({ breakdown: 'summary' })` (local estimate, no API call) after each turn and every 30 s |
| Model, effort, requests | each model request (`turn.step`) |
| Permission checks | `tool.check`; an ask's outcome when its call returns |
| MCP servers | the session's tool list every 30 s, `WaitForMcpServers` / `ToolSearch` results, MCP tool calls |
| Files, plan, tasks, background, schedules | the results of Edit / Write, ExitPlanMode, TaskCreate / TaskUpdate / TodoWrite, background Bash / Monitor, CronCreate / CronList |
| CPU / GPU / RAM | one PowerShell CIM query every 15 s |
| Git | `git status` every 10 s (60 s outside a repo), `git log` when HEAD moves, remote and the open PR/MR every 60 s |
| Themes | the plugin store: `prodash.theme` (global), `prodash.theme.repo:<repo root>` (one per repository), `prodash.theme.force`; the repo root comes from `git rev-parse --show-toplevel` when the session starts |

### What the mod runs, sends and hooks

**Programs it runs.** Each one by name, with no shell, from the session's folder:

| Program | Arguments | Why |
| --- | --- | --- |
| `git` | `status --porcelain=v2 --branch --show-stash`, `log -1`, `remote get-url origin`, `branch --show-current`, `rev-parse --show-toplevel` | the Git section, and the repository root that per-repository themes are keyed by |
| `gh` | `pr view --json number,state,title` | the open pull request on GitHub |
| `glab` | `mr view -F json` | the open merge request on GitLab |
| `az` | `repos pr list --source-branch <branch> --status active` | the open pull request on Azure DevOps |
| `powershell` | `-NoProfile -NonInteractive -Command` with one fixed, read-only CIM query (`Win32_Processor`, `Win32_OperatingSystem`, the GPU engine counters), written out in full in `hooks/register.tsx` | CPU, RAM and GPU in System Status (Windows) |

`gh`, `glab` and `az` run only when the `origin` remote is on that provider, and use the sign-in you already gave them, to talk to that provider's own servers. The mod reads no token, key or password itself.

**What leaves your machine.** Only the open PR / MR lookup:
- `gh`, `glab` or `az` ask your git provider for the PR / MR of the current branch.
- For Bitbucket, Claude Code's own HTTP call (`$.http.fetch`) sends an unauthenticated `GET` to `https://api.bitbucket.org/2.0/repositories/<workspace>/<repo>/pullrequests`, which carries the repository name and the branch name.

The Bitbucket URL is the only one the mod builds: its host is always `api.bitbucket.org`, and only the workspace, repository and branch names, read from `git`, change. What comes back is read as JSON for the PR number, state and title; it is never run, and no command the mod runs comes from the network.

Nothing else is sent anywhere. The session's folder (`session.cwd`) is only used to run `git` there, and the conversation (`session.messages`, read once to fill the request timeline) never leaves the pane.

**Hooks.** Every hook only watches and passes its event on unchanged; none decides, rewrites or blocks anything:
- `tool.check` (a permission check): records the decision your rules, settings or you already made, for the `2` Perms view, and returns that same decision. It never answers a check. It is the mod's only hook on a permission check.
- The mod has no hook on `agent.spawn`: subagents are read from `$.agent.list()`, and their description, permission mode and tools are never touched.
- `classic.Stop`: reads the background shells and scheduled jobs, for the Board.
- `turn.step`, `tool.call`, `session.compact`, `turn.start`, `turn.complete`, `prompt.submit`: count requests, tool calls, compactions and your prompts (the prompt text stays in the pane).
- `session.start` starts the timers and loads the saved theme; `session.measure` refreshes the context breakdown.
- `ui.render` draws only the mod's own pane; on the session-mode indicator it only reads which modes are on (to tell auto mode's classifier apart) and passes it on unchanged.
- `command.run` answers only its own `/prodash` command, registered with `$.command.register`.
- Clicking a row in Active Forks calls `$.ui.view`, Claude Code's own call to show that agent's transcript; it comes from no other plugin.

### Limitations

- Counters start when the mod loads. Earlier permission checks and tool calls are not shown; earlier requests appear in the timeline without a time.
- A subagent leaves Active Forks once it ends.
- A fork's activity is built from its tool calls and tasks; the short summary Claude Code's own subagent panel shows is not in the plugin API.
- There is no API event for "the person refused this ask": a call that waited on an ask and ends with an error worded as a refusal is counted as denied.
- The classifier is only told apart from your own approvals while the session shows auto mode.
- Background shells and schedules are rebuilt from tool calls and refreshed each time Claude stops; there is no live list.
- Bitbucket has no official CLI: the open PR shows for public repositories only.
- `az` is run by name with no shell. Where it is installed only as a `.cmd` script (Windows), it may not start, and the Azure DevOps PR line stays hidden.
- A repository's theme is tied to its folder: a moved or renamed folder, or a second clone, starts from the global theme.

## Performance

Nothing the mod does holds a tool call or a model request. Per-call data (logs, tool counts, permission checks, MCP stats, fork counters) stays in memory; only what changed is written, in one batch per second and at the end of each turn. Timers never overlap and they back off when idle. Every list kept in memory has a cap: 500 log lines, 300 permission checks, 200 files, 50 requests.

## Develop

The mod is a Claude Code plugin of function hooks:

```
.claude-plugin/plugin.json        manifest
.claude-plugin/marketplace.json   makes this repo installable
hooks/hooks.json                  names the hooks module
hooks/register.tsx                the whole mod
types/index.d.ts                  the state it keeps (its contract)
tests/prodash.test.tsx            tests (rendering, counters, layout)
```

```
claude plugin validate .
claude plugin test .
```

To run it from a working copy: `claude --plugin-dir <this folder>`.

## License

MIT
