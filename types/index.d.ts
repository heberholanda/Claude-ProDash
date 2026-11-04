export type Level = 'INFO' | 'SUCCESS' | 'USER' | 'WARN' | 'ERROR'
export type LogLine = { at: number; level: Level; text: string; isSub: boolean }
export type Fork = { id: string; name: string; status: string; since: number; tools: number; lastIn: number; out: number }
export type Sys = { load?: number; memUsed?: number; memTotal?: number; hist: number[] }
export type RateLimit = { kind: string; pct: number; resetsAt?: string }
export type Usage = { startedAt: number; ctx?: number; ctxTokens?: number; ctxWindow?: number; limits?: RateLimit[]; usd?: number; lastTurnUsd?: number; turnBaseUsd?: number; tokens: number; ctxHist: number[] }
export type Mode = 'main' | 'agents' | 'perms' | 'board'
export type Perm = { tool: string; ok: number; denied: number }
export type Live = {
  model?: string
  effort?: string
  reqs: number
  ttftMs?: number
  isBusy: boolean
  compactions: number
}
export type GitFile = { xy: string; path: string }
export type Git = {
  isRepo: boolean
  repo?: string
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  stash: number
  last?: string
  pr?: string
  files: GitFile[]
}
export type Todo = { content: string; status: string }

declare module 'claude-code' {
  interface PluginState {
    prodash: {
      logs: Shaped<LogLine[]>
      forks: Shaped<Fork[]>
      sys: Shaped<Sys>
      usage: Shaped<Usage>
      mode: Mode
      perms: Shaped<Perm[]>
      todos: Shaped<Todo[]>
      git: Shaped<Git>
      live: Shaped<Live>
    }
  }
}
