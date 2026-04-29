import { useForm } from "react-hook-form"
import { useEffect } from "react"
import { z } from "zod"
import { Button } from "@/shared/components/ui/button"
import { Input } from "@/shared/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select"
import { useAppDispatch, useAppSelector } from "@/shared/stores/hooks"
import { resetPaneFilters, setPaneFilters } from "@/features/log-viewer/store/log-viewer-slice"

const filterSchema = z.object({
  keyword: z.string().max(100),
  level: z.enum(["all", "error", "warn", "info", "debug", "unknown"]),
  source: z.enum(["all", "json", "stdout"]),
})

type FilterFormValues = z.infer<typeof filterSchema>

interface LogFilterFormProps {
  paneId: string
}

export function LogFilterForm({ paneId }: LogFilterFormProps) {
  const dispatch = useAppDispatch()
  const pane = useAppSelector((state) => state.logViewer.panes.find((item) => item.id === paneId))
  const filters = pane?.filters ?? { keyword: "", level: "all", source: "all" }

  const form = useForm<FilterFormValues>({
    defaultValues: filters,
  })

  const onSubmit = (values: FilterFormValues) => {
    const parsed = filterSchema.safeParse(values)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      if (firstIssue?.path[0] === "keyword") {
        form.setError("keyword", { message: firstIssue.message })
      }
      return
    }
    dispatch(setPaneFilters({ paneId, filters: parsed.data }))
  }

  const onReset = () => {
    dispatch(resetPaneFilters({ paneId }))
    form.reset({
      keyword: "",
      level: "all",
      source: "all",
    })
  }

  useEffect(() => {
    form.reset(filters)
  }, [filters, form])

  return (
    <form
      className="grid grid-cols-1 gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:p-4 xl:grid-cols-[minmax(260px,2fr)_minmax(160px,1fr)_minmax(180px,1fr)_auto_auto]"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Input placeholder="Search logs..." className="sm:col-span-2 xl:col-span-1" {...form.register("keyword")} />
      {form.formState.errors.keyword ? (
        <p className="text-sm text-destructive sm:col-span-2 xl:col-span-5">{form.formState.errors.keyword.message}</p>
      ) : null}

      <Select value={form.watch("level")} onValueChange={(value) => form.setValue("level", value as FilterFormValues["level"])}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Level" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All levels</SelectItem>
          <SelectItem value="error">Error</SelectItem>
          <SelectItem value="warn">Warn</SelectItem>
          <SelectItem value="info">Info</SelectItem>
          <SelectItem value="debug">Debug</SelectItem>
          <SelectItem value="unknown">Unknown</SelectItem>
        </SelectContent>
      </Select>

      <Select value={form.watch("source")} onValueChange={(value) => form.setValue("source", value as FilterFormValues["source"])}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          <SelectItem value="json">JSON</SelectItem>
          <SelectItem value="stdout">Stdout</SelectItem>
        </SelectContent>
      </Select>

      <Button type="submit" className="w-full xl:w-auto">Apply</Button>
      <Button type="button" variant="outline" className="w-full xl:w-auto" onClick={onReset}>
        Reset
      </Button>
    </form>
  )
}
