"use client"

import * as React from "react"
import menuData from "@/features/log-viewer/mocks/log-menu.json"
import { NavMain } from "@/shared/components/nav-main"
import { NavProjects } from "@/shared/components/nav-projects"
import { NavUser } from "@/shared/components/nav-user"
import { TeamSwitcher } from "@/shared/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/shared/components/ui/sidebar"
import { getIconByName } from "@/shared/lib/icon-mapper"

type MenuService = {
  title: string
  url: string
  icon: string
  isActive?: boolean
  items?: { title: string; url: string }[]
}

type MenuConnection = {
  name: string
  url: string
  icon: string
}

const services = menuData.services as MenuService[]
const connections = (menuData.connections ?? []) as MenuConnection[]

const data = {
  user: menuData.user,
  teams: menuData.teams.map((team) => ({
    ...team,
    logo: getIconByName(team.icon),
  })),
  navMain: services.map((service) => ({
    title: service.title,
    url: service.url,
    icon: getIconByName(service.icon),
    isActive: service.isActive,
    items: service.items,
  })),
  projects: connections.map((connection) => ({
    name: connection.name,
    url: connection.url,
    icon: getIconByName(connection.icon),
  })),
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        {data.projects.length > 0 ? <NavProjects projects={data.projects} /> : null}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
