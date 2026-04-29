export type TLogSourceType = "stdout" | "file"

export type TLogParserType = "json" | "text" | "logfmt" | "nginx" | "laravel"

export type TLogLevel = "error" | "warn" | "info" | "debug" | "unknown"
export type TLogFieldOperator = "equals" | "not_equals" | "contains" | "exists"

export type TLogPaneStatus = "running" | "paused" | "stopped" | "error"

export interface ILogService {
  id: string
  title: string
  runtimeTarget: "local" | "ssh"
  sshHostId?: string
  sourceType: TLogSourceType
  parserType: TLogParserType
  sourceLabel: string
  filePath?: string
  filePaths?: string[]
}

export interface ILogRecord {
  id: string
  serviceId: string
  timestamp: string
  level: TLogLevel
  parserType: TLogParserType
  sourceType: TLogSourceType
  message: string
  raw: string
  fields?: Record<string, string>
}

export interface ILogFieldFilterCondition {
  id: string
  field: string
  operator: TLogFieldOperator
  value: string
}

export interface ILogPaneFilters {
  keyword: string
  level: "all" | TLogLevel
  fieldConditions: ILogFieldFilterCondition[]
}

export interface ILogPaneState {
  id: string
  terminalTabId: string
  title: string
  serviceId: string
  status: TLogPaneStatus
  accentTone: "blue" | "green" | "amber" | "purple"
  filters: ILogPaneFilters
}

export interface IProjectRunCommand {
  id: string
  name: string
  command: string
  cwd: string
  sourceType: TLogSourceType
  filePath?: string
  filePaths?: string[]
  status: "idle" | "running" | "paused" | "error"
}

export interface IProjectLogSource {
  id: string
  name: string
  sourceType: TLogSourceType
  parserType: TLogParserType
  filePath?: string
  mergeKey: "separate" | "merged"
}

export interface IProjectSetupState {
  stack: "laravel" | "node" | "go" | "custom"
  logOutput: "stdout" | "file" | "mixed"
  combineFileLogs: boolean
  fileLogPaths: string[]
}

export interface ISshRemoteEntry {
  name: string
  path: string
  is_dir: boolean
}

export interface IAddPaneDraft {
  runtimeTarget: "local" | "ssh"
  projectPath: string
  sshHostId: string
}

export interface ITauriLogEntry {
  id: string
  source_id: string
  timestamp: string
  level: "error" | "warn" | "info" | "debug" | "unknown"
  parser_type?: "json" | "text" | "logfmt" | "nginx" | "laravel"
  message: string
  raw: string
  fields?: Record<string, string>
}

export interface ILogBatchPayload {
  source_id: string
  entries: ITauriLogEntry[]
}

export interface ISourceStatusPayload {
  source_id: string
  status: "running" | "paused" | "stopped" | "error"
}

export interface IPtyOutputPayload {
  tab_id: string
  data: string
}

export interface ICreatedPaneResult {
  paneId: string
  paneTitle: string
  projectPath: string
}

export interface ILogViewerWorkspaceCache {
  services: ILogService[]
  panes: ILogPaneState[]
  activePaneId: string
  runCommands: IProjectRunCommand[]
  logSources: IProjectLogSource[]
  projectSetup: IProjectSetupState
  addPaneDraft: IAddPaneDraft
  paneFilterDrafts: Record<string, ILogPaneFilters>
  paneLiveStates: Record<string, boolean>
  recordsByServiceId: Record<string, ILogRecord[]>
}
