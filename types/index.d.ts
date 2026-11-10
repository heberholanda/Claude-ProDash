export type Level = 'INFO' | 'SUCCESS' | 'USER' | 'WARN' | 'ERROR'
export type LogLine = { at: number; level: Level; text: string; isSub: boolean }
export type Fork = { id: string; name: string; status: string; since: number; tools: number; lastIn: number; out: number; act?: string }
export type Sys = { load?: number; gpu?: number; memUsed?: number; memTotal?: number; hist: number[] }
export type RateLimit = { kind: string; pct: number; resetsAt?: string }
export type Usage = { startedAt: number; ctx?: number; ctxTokens?: number; ctxWindow?: number; limits?: RateLimit[]; usd?: number; tokens: number }
/** the /context breakdown: rows as /context lists them; mcp: schema tokens per MCP server (mcp__<server>__ key) */
export type Ctx = {
  used: number
  max: number
  rows: { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
  /** per MCP server (mcp__<server>__ key): schema tokens of all its tools, how many are loaded and their tokens */
  mcp: Record<string, { tokens: number; loaded: number; inCtx: number }>
  memory: { path: string; type: string; tokens: number }[]
  skills: { name: string; tokens: number }[]
  skillsTotal: number
  compactAt?: number
  model: string
}
export type Mode = 'main' | 'agents' | 'perms' | 'board' | 'mcp' | 'context' | 'theme'
export type Perm = { tool: string; ok: number; denied: number }
export type Live = {
  model?: string
  effort?: string
  reqs: number
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
/** a: allowed by rule/mode, c: classifier approved, h: person approved, p: pending, d: denied */
export type GateKind = 'a' | 'c' | 'h' | 'p' | 'd'
export type GateVia = 'rule' | 'mode' | 'setting' | 'hook' | 'classifier' | 'person'
export type GateEvent = {
  id: string
  at: number
  tool: string
  cat: 'f' | 's' | 'o'
  kind: GateKind
  via: GateVia
  detail: string
  reason?: string
  rule?: string
  agent?: string
  isReadOnly: boolean
  waitMs?: number
}
export type Gate = {
  /** last 300 permission checks, oldest first */
  events: GateEvent[]
  /** all-time counters (events is capped) */
  total: number
  counts: Record<GateKind, number>
  cats: { f: number; s: number; o: number }
  reads: number
  writes: number
  main: number
  forks: number
  rules: { rule: string; n: number }[]
  waitMs: number
  waits: number
}
/** the dashboard's color roles; every color the pane draws is one of these */
export type PaletteKey = 'border' | 'ok' | 'warn' | 'bad' | 'info' | 'accent' | 'amber' | 'dim' | 'dim2' | 'gold' | 'purple' | 'violet' | 'white' | 'user'
export type Palette = Record<PaletteKey, string>
/** name: a preset or 'custom'; base: the preset custom starts from; custom: the roles the user overrode (#rrggbb) */
export type ThemeState = { name: string; base: string; custom: Partial<Palette> }
/** connected: has tools in the session; the rest come from WaitForMcpServers / ToolSearch results */
export type McpStatus = 'connected' | 'pending' | 'failed' | 'needs-auth' | 'disabled'
export type McpServer = {
  name: string
  status: McpStatus
  tools: number
  calls: number
  errors: number
  totalMs: number
  lastAt?: number
  error?: string
}
/** a TodoWrite item (no id) or a Task tool task (id) */
export type Todo = { id?: string; content: string; status: string }
/** a file edited this session through Edit/Write/MultiEdit/NotebookEdit */
export type Touched = { path: string; add: number; del: number; edits: number; isNew: boolean; at: number }
/** one user request of the main conversation */
export type Request = { at?: number; text: string; tools: number; durationMs?: number; isDone: boolean }
/** the latest approved plan (ExitPlanMode) */
export type Plan = { at: number; steps: { text: string; isChecked: boolean }[] }
/** a background shell, monitor or workflow */
export type Bg = { id: string; kind: string; desc: string; status: string; since: number }
/** a session cron / wakeup */
export type Cron = { id: string; schedule: string; prompt: string; recurring: boolean; nextFireAt?: number }

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
      gate: Shaped<Gate>
      touched: Shaped<Touched[]>
      requests: Shaped<Request[]>
      plan: Shaped<Plan | null>
      bg: Shaped<Bg[]>
      crons: Shaped<Cron[]>
      mcp: Shaped<McpServer[]>
      ctx: Shaped<Ctx>
      theme: Shaped<ThemeState>
      live: Shaped<Live>
    }
  }
}
