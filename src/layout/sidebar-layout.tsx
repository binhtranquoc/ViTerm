import { useEffect, useState, type ReactNode } from "react";
import { AppSidebar } from "@/shared/components/app-sidebar";
import { MasterLayout } from "@/layout/master-layout";
import {
  SidebarInset,
  SidebarProvider,
} from "@/shared/components/ui/sidebar";

interface SidebarLayoutProps {
  children: ReactNode;
}

export function SidebarLayout({
  children,
}: SidebarLayoutProps) {
  const [isSidebarVisible, setIsSidebarVisible] = useState(true)

  // handle terminal workspace sidebar visibility animation
  useEffect(() => {
    const handleVisibilityChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ visible?: boolean }>
      setIsSidebarVisible(customEvent.detail?.visible !== false)
    }

    window.addEventListener("terminal-workspace-sidebar-visibility", handleVisibilityChange)
    return () => {
      window.removeEventListener("terminal-workspace-sidebar-visibility", handleVisibilityChange)
    }
  }, [])

  return (
    <SidebarProvider
      className="h-full min-h-0 overflow-hidden"
      open={isSidebarVisible}
      onOpenChange={setIsSidebarVisible}
    >
      <AppSidebar />
      <SidebarInset className="h-full min-h-0 overflow-hidden">
        <MasterLayout>{children}</MasterLayout>
      </SidebarInset>
    </SidebarProvider>
  );
}
