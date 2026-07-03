import { WavesIcon } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export function ChartPlaceholder({
  message = "Start the app stack to see live metrics.",
}: {
  message?: string
}) {
  return (
    <div className="flex h-[220px] items-center justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WavesIcon />
          </EmptyMedia>
          <EmptyTitle>No samples yet</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
