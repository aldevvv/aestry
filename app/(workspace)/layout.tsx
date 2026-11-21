import { cookies } from "next/headers"

import { AppSidebar } from "@/components/app-sidebar"
import { WorkspaceHeader } from "@/components/workspace-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"

// Must match SIDEBAR_COOKIE_NAME in components/ui/sidebar.tsx.
const SIDEBAR_STATE_COOKIE = "sidebar_state"

// The shell reads the sidebar-state cookie to restore the expanded/collapsed
// preference without a flash. That is runtime data by design, so this shared
// layout opts out of instant-navigation validation (see route segment config
// "instant"); content beneath it still prerenders and streams.
export const instant = false

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get(SIDEBAR_STATE_COOKIE)?.value !== "false"

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>
        <WorkspaceHeader />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  )
}
