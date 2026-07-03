import { cn } from "@/lib/utils"
import type { ServiceStatus } from "@/hooks/use-dashboard-data"

// Status semantics need a "success" color the crimson theme palette lacks,
// so emerald-500 is a deliberate raw-color exception here; down/loading use tokens.
const DOT: Record<ServiceStatus, string> = {
  up: "bg-emerald-500",
  down: "bg-destructive",
  loading: "bg-muted-foreground animate-pulse",
}

const TITLE: Record<ServiceStatus, string> = {
  up: "online",
  down: "offline",
  loading: "connecting",
}

export function HealthIndicator({
  label,
  status,
}: {
  label: string
  status: ServiceStatus
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      title={`${label}: ${TITLE[status]}`}
    >
      <span className={cn("size-2 rounded-full", DOT[status])} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}
