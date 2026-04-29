import type { IAddPaneDraft, ILogRecord, IProjectRunCommand } from "@/features/log-viewer/interfaces/log-viewer.interfaces"

export const DEFAULT_ADD_PANE_DRAFT: IAddPaneDraft = {
  runtimeTarget: "local",
  projectPath: "",
  sshHostId: "",
}

export const MAX_RECORDS_FRONTEND = 2000

export const appendLatestRecords = <T,>(currentRecords: T[], incomingRecords: T[], maxRecords: number): T[] => {
  if (incomingRecords.length === 0) return currentRecords
  if (incomingRecords.length >= maxRecords) {
    return incomingRecords.slice(incomingRecords.length - maxRecords)
  }
  const overflowCount = currentRecords.length + incomingRecords.length - maxRecords
  if (overflowCount <= 0) {
    return [...currentRecords, ...incomingRecords]
  }
  return [...currentRecords.slice(overflowCount), ...incomingRecords]
}

export const invokeTauri = async <T,>(command: string, payload?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, payload)
}

export const isTauriRuntime = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

export const getProjectFolderName = (projectPath: string) => {
  const normalizedProjectPath = projectPath.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  if (!normalizedProjectPath) return ""
  const pathSegments = normalizedProjectPath.split("/").filter(Boolean)
  return pathSegments[pathSegments.length - 1] ?? ""
}

const ANSI_ESCAPE_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|][^\x07]*(?:\x07|\x1b\\))/g
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g
const NGINX_COMBINED_RE =
  /^(?:[\w][\w.-]*\s*\|\s*)?(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^\s"]+)[^"]*"\s+(\d{3})\s+(\d+|-)\s+"([^"]*)"\s+"([^"]*)"(?:\s+"([^"]*)")?/
const SQLSERVER_LINE_RE =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s+([A-Za-z][\w.-]*)\s+(.+)$/
const SQLSERVER_ERROR_DETAIL_RE = /Error:\s*(\d+),\s*Severity:\s*(\d+),\s*State:\s*(\d+)\.?/i
const SQLSERVER_LOGIN_FAILED_RE = /^Login failed for user '([^']+)'\.\s*Reason:\s*(.+?)\s*\[CLIENT:\s*([^\]]+)\]/i
const COMMON_TIMESTAMP_RE = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/

const normalizeTimestamp = (rawTimestamp: string) => {
  const sanitizedTimestamp = rawTimestamp.replace(",", ".")
  const parsedDate = new Date(sanitizedTimestamp.includes("T") ? sanitizedTimestamp : `${sanitizedTimestamp}Z`)
  return Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString()
}

const detectTextLevel = (message: string): ILogRecord["level"] => {
  const loweredMessage = message.toLowerCase()
  if (/\b(error|err|fatal|critical|fail(?:ed)?|panic)\b/i.test(loweredMessage)) return "error"
  if (/\b(warn|warning)\b/i.test(loweredMessage)) return "warn"
  if (/\b(debug|trace|verbose)\b/i.test(loweredMessage)) return "debug"
  if (/\b(info|notice)\b/i.test(loweredMessage)) return "info"
  return "unknown"
}

const sanitizeTerminalLine = (rawLine: string) =>
  rawLine.replace(ANSI_ESCAPE_RE, "").replace(CONTROL_CHAR_RE, "")

const parseNginxDate = (rawDate: string) => {
  const match = rawDate.match(
    /(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{4})/,
  )
  if (!match) return new Date().toISOString()
  const [, day, month, year, hms, timezoneOffset] = match
  const parsedDate = new Date(`${month} ${day} ${year} ${hms} ${timezoneOffset}`)
  return Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString()
}

export const extractFlattenedFields = (value: unknown): Record<string, string> => {
  const flattenedFields: Record<string, string> = {}
  const walk = (currentValue: unknown, prefix: string) => {
    if (currentValue === null || currentValue === undefined) return
    if (Array.isArray(currentValue)) {
      if (prefix.length > 0 && currentValue.length > 0) {
        flattenedFields[prefix] = JSON.stringify(currentValue)
      }
      return
    }
    if (typeof currentValue === "object") {
      for (const [key, childValue] of Object.entries(currentValue as Record<string, unknown>)) {
        walk(childValue, prefix ? `${prefix}.${key}` : key)
      }
      return
    }
    if (prefix.length > 0) {
      flattenedFields[prefix] = String(currentValue)
    }
  }
  walk(value, "")
  return flattenedFields
}

export const extractJsonOnly = (rawLine: string): { parsed: Record<string, unknown>; cleanedLine: string } | null => {
  const cleanedLine = sanitizeTerminalLine(rawLine).trim()
  const jsonStart = cleanedLine.indexOf("{")
  if (jsonStart === -1) return null
  const jsonSlice = cleanedLine.slice(jsonStart)
  try {
    const parsed = JSON.parse(jsonSlice)
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { parsed: parsed as Record<string, unknown>, cleanedLine: jsonSlice }
    }
  } catch {
    const jsonEnd = jsonSlice.lastIndexOf("}")
    if (jsonEnd > 0) {
      try {
        const parsed = JSON.parse(jsonSlice.slice(0, jsonEnd + 1))
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          return { parsed: parsed as Record<string, unknown>, cleanedLine: jsonSlice.slice(0, jsonEnd + 1) }
        }
      } catch {}
    }
  }
  return null
}

export const buildJsonRecordFromPty = (
  serviceId: string,
  sourceType: ILogRecord["sourceType"],
  parsedPayload: Record<string, unknown>,
  raw: string,
): ILogRecord => {
  const rawLevel = String(parsedPayload.level ?? parsedPayload.severity ?? parsedPayload.lvl ?? "").toLowerCase()
  const level: ILogRecord["level"] =
    rawLevel === "error" || rawLevel === "fatal" || rawLevel === "critical" ? "error"
    : rawLevel === "warn" || rawLevel === "warning" ? "warn"
    : rawLevel === "debug" || rawLevel === "trace" || rawLevel === "verbose" ? "debug"
    : rawLevel === "info" || rawLevel === "notice" ? "info"
    : "unknown"

  const messageCandidate = parsedPayload.message ?? parsedPayload.msg ?? parsedPayload.log ?? parsedPayload.text
  const message =
    typeof messageCandidate === "string" && messageCandidate.trim()
      ? sanitizeTerminalLine(messageCandidate).trim()
      : raw

  const timestampCandidate = parsedPayload.timestamp ?? parsedPayload.time ?? parsedPayload["@timestamp"]
  const timestamp =
    typeof timestampCandidate === "string" && timestampCandidate ? timestampCandidate : new Date().toISOString()

  return {
    id: `pty-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    serviceId,
    timestamp,
    level,
    parserType: "json",
    sourceType,
    message,
    raw,
    fields: extractFlattenedFields(parsedPayload),
  }
}

export const buildNginxRecordFromPty = (
  serviceId: string,
  sourceType: ILogRecord["sourceType"],
  rawLine: string,
): ILogRecord | null => {
  const normalizedLine = sanitizeTerminalLine(rawLine).trim()
  const matched = normalizedLine.match(NGINX_COMBINED_RE)
  if (!matched) return null

  const [, ip, , timeStr, method, path, status, bytes, referer, userAgent, realIp] = matched
  const statusNumber = Number.parseInt(status, 10)
  const bytesNumber = bytes === "-" ? 0 : Number.parseInt(bytes, 10)
  const level: ILogRecord["level"] = statusNumber >= 500 ? "error" : statusNumber >= 400 ? "warn" : "info"

  const structuredPayload = {
    ip: realIp && realIp !== "-" ? realIp : ip,
    method,
    path,
    status: statusNumber,
    bytes: Number.isNaN(bytesNumber) ? 0 : bytesNumber,
    referer,
    ua: userAgent,
    timestamp: parseNginxDate(timeStr),
    source: "nginx-access",
  }

  return {
    id: `nginx-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    serviceId,
    timestamp: structuredPayload.timestamp,
    level,
    parserType: "nginx",
    sourceType,
    message: `${method} ${path} -> ${status} (${structuredPayload.bytes}b)`,
    raw: JSON.stringify(structuredPayload),
    fields: extractFlattenedFields(structuredPayload),
  }
}

export const buildTextRecordFromPty = (
  serviceId: string,
  sourceType: ILogRecord["sourceType"],
  rawLine: string,
): ILogRecord | null => {
  const normalizedLine = sanitizeTerminalLine(rawLine).trim()
  if (!normalizedLine) return null

  const sqlServerMatched = normalizedLine.match(SQLSERVER_LINE_RE)
  if (sqlServerMatched) {
    const [, timestampText, category, messageText] = sqlServerMatched
    const fields: Record<string, string> = {
      profile: "sqlserver",
      category,
    }
    let level: ILogRecord["level"] = detectTextLevel(messageText)

    const errorDetails = messageText.match(SQLSERVER_ERROR_DETAIL_RE)
    if (errorDetails) {
      const [, errorCode, severity, state] = errorDetails
      fields.error_code = errorCode
      fields.severity = severity
      fields.state = state
      const severityNumber = Number.parseInt(severity, 10)
      if (!Number.isNaN(severityNumber)) {
        if (severityNumber >= 11) level = "error"
        else if (severityNumber >= 6) level = "warn"
      }
    }

    const loginFailedDetails = messageText.match(SQLSERVER_LOGIN_FAILED_RE)
    if (loginFailedDetails) {
      const [, username, reason, client] = loginFailedDetails
      fields.username = username
      fields.reason = reason.trim()
      fields.client = client.trim()
      level = "error"
    }

    return {
      id: `text-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      serviceId,
      timestamp: normalizeTimestamp(timestampText),
      level,
      parserType: "text",
      sourceType,
      message: messageText.trim(),
      raw: normalizedLine,
      fields,
    }
  }

  const timestampText = normalizedLine.match(COMMON_TIMESTAMP_RE)?.[1] ?? ""
  return {
    id: `text-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    serviceId,
    timestamp: timestampText ? normalizeTimestamp(timestampText) : new Date().toISOString(),
    level: detectTextLevel(normalizedLine),
    parserType: "text",
    sourceType,
    message: normalizedLine,
    raw: normalizedLine,
    fields: {},
  }
}

export const getEffectiveFilePaths = (command: IProjectRunCommand) => {
  const filePathList = command.filePaths?.map((filePath) => filePath.trim()).filter(Boolean) ?? []
  if (filePathList.length > 0) return filePathList
  const singlePath = command.filePath?.trim()
  return singlePath ? [singlePath] : []
}
