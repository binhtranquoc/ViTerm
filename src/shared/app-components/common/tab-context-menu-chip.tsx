import type { ReactNode } from "react"
import { X } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu"

interface TabContextMenuChipProps {
  id: string
  title: string
  icon: ReactNode
  isActive: boolean
  isMenuOpen: boolean
  onMenuOpenChange: (id: string, open: boolean) => void
  onActivate: (id: string) => void
  onOpenContextMenu: (id: string) => void
  onClose: (id: string) => void
  menuContent: ReactNode
}

export function TabContextMenuChip({
  id,
  title,
  icon,
  isActive,
  isMenuOpen,
  onMenuOpenChange,
  onActivate,
  onOpenContextMenu,
  onClose,
  menuContent,
}: TabContextMenuChipProps) {
  return (
    <DropdownMenu open={isMenuOpen} onOpenChange={(open) => onMenuOpenChange(id, open)}>
      <DropdownMenuTrigger asChild>
        <div
          className={`group flex h-8 shrink-0 items-center gap-1 rounded-md border px-1.5 transition-all ${
            isActive
              ? "border-primary/70 bg-primary/15 text-foreground shadow-sm"
              : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          onPointerDown={(e) => {
            // Keep left click behavior for "activate tab" only.
            // Context menu is opened via right click.
            if (e.button === 0) e.preventDefault()
          }}
          onClick={() => onActivate(id)}
          onContextMenu={(e) => {
            e.preventDefault()
            onOpenContextMenu(id)
          }}
        >
          <button type="button" className="flex items-center gap-1.5 px-1 text-sm">
            {icon}
            <span>{title}</span>
          </button>
          <button
            type="button"
            className="ml-0.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onClose(id)
            }}
            aria-label="Close tab"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {menuContent}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
