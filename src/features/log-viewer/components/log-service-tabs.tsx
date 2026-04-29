import { Button } from "@/shared/components/ui/button"
import { useAppDispatch, useAppSelector } from "@/shared/stores/hooks"
import { setPaneService } from "@/features/log-viewer/store/log-viewer-slice"

interface LogServiceTabsProps {
  paneId: string
  activeServiceId: string
}

export function LogServiceTabs({ paneId, activeServiceId }: LogServiceTabsProps) {
  const dispatch = useAppDispatch()
  const { services } = useAppSelector((state) => state.logViewer)

  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
        {services.map((service) => (
          <Button
            key={service.id}
            size="sm"
            variant={service.id === activeServiceId ? "default" : "outline"}
            className="shrink-0"
            onClick={() => dispatch(setPaneService({ paneId, serviceId: service.id }))}
          >
            {service.title}
          </Button>
        ))}
      </div>
    </div>
  )
}
