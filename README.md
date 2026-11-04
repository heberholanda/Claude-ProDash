# Claude ProDash

Dashboard Pro mod for Claude Code: one pane beside the chat with system status, agent overview, session metrics, the active git repository and the live subagents (forks).

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

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `heberholanda/Claude-ProDash`, then Add plugin.

## Use

The pane opens by itself on wide terminals (144+ columns); `/prodash` opens it anytime.

| Section | Shows |
| --- | --- |
| System Status | online state, CPU load bar and history, RAM (Windows) |
| Agent Overview | model · branch, busy/idle, effort, mode, request count, context window, cost, 5h/7d rate limits, last request TTFT, agent counters |
| Session Metrics | duration, tokens, cost, last turn cost |
| Action Bar | `1` Agent Select · `2` Gate Perms · `3` Save Log · `4` Project Board |
| Gate Perms | every permission check as a color strip; allowed / classifier / approved / pending / denied; file · shell · other; read vs write; main vs forks; avg approval wait; top rules; top tools; recent asks and denials |
| Project Board | approved plan progress, files touched with +/- lines, request timeline, background shells and monitors, scheduled jobs |
| GitHub | repo, branch → upstream, ahead/behind, stash, PR (needs `gh`), last commit, files pending commit |
| Active Forks | each subagent's status, tool calls and elapsed time |

## Develop

```
claude plugin validate .
claude plugin test .
```


## License

MIT
