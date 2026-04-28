import { Folder } from "lucide-react"

import { SimpleBreadcrumb } from "@/shared/app-components/common/simple-breadcrumb"
import { Button } from "@/shared/components/ui/button"

interface GroupDetailBreadcrumbProps {
  groupName: string
  onBackToAllGroups: () => void
}

export function GroupDetailBreadcrumb({
  groupName,
  onBackToAllGroups,
}: GroupDetailBreadcrumbProps) {
  return (
    <div className="mb-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      <SimpleBreadcrumb items={["Home", "Groups"]} current={groupName} />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Folder className="h-4 w-4 text-muted-foreground" />
          <p className="truncate text-sm font-semibold">{groupName}</p>
        </div>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onBackToAllGroups}>
          Back
        </Button>
      </div>
    </div>
  )
}
