export type TLogSourceType = "stdout" | "file"

export type TLogParserType = "json" | "text" | "nginx"

export type TLogLevel = "error" | "warn" | "info" | "debug" | "unknown"

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
}

export interface ILogPaneFilters {
  keyword: string
  level: "all" | TLogLevel
  sourceType: "all" | TLogSourceType
  parserType: "all" | TLogParserType
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
  projectName: string
  stack: "laravel" | "node" | "go" | "custom"
  logOutput: "stdout" | "file" | "mixed"
  combineFileLogs: boolean
}
