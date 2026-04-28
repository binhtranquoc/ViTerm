import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/components/ui/breadcrumb"

interface SimpleBreadcrumbProps {
  items: string[]
  current: string
}

export function SimpleBreadcrumb({ items, current }: SimpleBreadcrumbProps) {
  return (
    <Breadcrumb>
      <BreadcrumbList className="text-xs">
        {items.map((item) => (
          <BreadcrumbItem key={item}>
            <span>{item}</span>
            <BreadcrumbSeparator />
          </BreadcrumbItem>
        ))}
        <BreadcrumbItem>
          <BreadcrumbPage className="text-xs">{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
