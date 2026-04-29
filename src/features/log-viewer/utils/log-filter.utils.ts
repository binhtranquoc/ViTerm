import type {
  ILogFieldFilterCondition,
  ILogPaneFilters,
  ILogRecord,
  TLogSourceType,
} from "@/features/log-viewer/interfaces/log-viewer.interfaces"

export const matchFieldCondition = (record: ILogRecord, condition: ILogFieldFilterCondition) => {
  const fieldName = condition.field.trim()
  if (!fieldName) return true
  const fields = record.fields ?? {}
  const actual = fields[fieldName]
  const expected = condition.value.trim().toLowerCase()

  switch (condition.operator) {
    case "exists":
      return actual !== undefined
    case "equals":
      return (actual ?? "").toLowerCase() === expected
    case "not_equals":
      return (actual ?? "").toLowerCase() !== expected
    case "contains":
      return (actual ?? "").toLowerCase().includes(expected)
    default:
      return true
  }
}

const matchCommonFilters = (record: ILogRecord, filters: ILogPaneFilters) => {
  if (filters.level !== "all" && record.level !== filters.level) return false

  if (filters.keyword.trim().length > 0) {
    const keyword = filters.keyword.toLowerCase()
    if (
      !record.message.toLowerCase().includes(keyword) &&
      !record.raw.toLowerCase().includes(keyword)
    ) {
      return false
    }
  }

  if (filters.fieldConditions.length > 0) {
    for (const condition of filters.fieldConditions) {
      if (!matchFieldCondition(record, condition)) return false
    }
  }

  return true
}

const filterStdoutRecords = (records: ILogRecord[], filters: ILogPaneFilters) => {
  return records.filter((record) => matchCommonFilters(record, filters))
}

const filterFileRecords = (records: ILogRecord[], filters: ILogPaneFilters) => {
  return records.filter((record) => matchCommonFilters(record, filters))
}

export const filterRecordsBySourceType = (
  sourceType: TLogSourceType,
  records: ILogRecord[],
  filters: ILogPaneFilters,
) => {
  if (sourceType === "stdout") {
    return filterStdoutRecords(records, filters)
  }
  return filterFileRecords(records, filters)
}
