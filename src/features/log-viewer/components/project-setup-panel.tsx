import { Checkbox } from "@/shared/components/ui/checkbox"
import { Input } from "@/shared/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select"
import type { IProjectSetupState } from "@/features/log-viewer/interfaces/log-viewer.interfaces"

interface ProjectSetupPanelProps {
  setup: IProjectSetupState
  onChange: (value: Partial<IProjectSetupState>) => void
}

export function ProjectSetupPanel({ setup, onChange }: ProjectSetupPanelProps) {
  return (
    <section className="rounded-xl border bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Project setup</p>
      <div className="mt-2 grid gap-2">
        <Input
          value={setup.projectName}
          onChange={(event) => onChange({ projectName: event.target.value })}
          placeholder="Project name"
        />

        <div className="grid grid-cols-2 gap-2">
          <Select value={setup.stack} onValueChange={(value) => onChange({ stack: value as IProjectSetupState["stack"] })}>
            <SelectTrigger>
              <SelectValue placeholder="Tech stack" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="laravel">Laravel</SelectItem>
              <SelectItem value="node">Node</SelectItem>
              <SelectItem value="go">Go</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={setup.logOutput}
            onValueChange={(value) => onChange({ logOutput: value as IProjectSetupState["logOutput"] })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Log output" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdout">Stdout only</SelectItem>
              <SelectItem value="file">File only</SelectItem>
              <SelectItem value="mixed">Stdout + file</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 rounded-md border bg-background px-2 py-2 text-xs">
          <Checkbox
            checked={setup.combineFileLogs}
            onCheckedChange={(checked) => onChange({ combineFileLogs: checked === true })}
          />
          Merge multi file logs into one timeline
        </label>
      </div>
    </section>
  )
}
