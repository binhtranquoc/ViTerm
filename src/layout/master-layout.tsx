import type { ReactNode } from "react"

interface MasterLayoutProps {
  children: ReactNode
}

export function MasterLayout({ children }: MasterLayoutProps) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col gap-4 overflow-hidden px-[10px] py-[10px] sm:px-4 lg:px-5 2xl:px-5">
      {children}
    </div>
  )
}
