import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtInt } from "@/lib/format"
import type { StorageStats } from "@/lib/types"

type Metric = { label: string; value: number; bad?: boolean; info?: boolean }

export function IntegrityPanel({ storage }: { storage?: StorageStats }) {
  const metrics: Metric[] = storage
    ? [
        {
          label: "Missing",
          value: storage.seq.missing,
          bad: storage.seq.missing > 0,
        },
        { label: "Gaps", value: storage.seq.gaps, bad: storage.seq.gaps > 0 },
        {
          label: "Duplicates",
          value: storage.seq.duplicates,
          info: storage.seq.duplicates > 0,
        },
        {
          label: "Out of order",
          value: storage.seq.outOfOrder,
          info: storage.seq.outOfOrder > 0,
        },
        {
          label: "Conflicts",
          value: storage.writer.conflicts,
          info: storage.writer.conflicts > 0,
        },
        {
          label: "Buffered",
          value: storage.writer.buffered,
          info: storage.writer.buffered > 0,
        },
      ]
    : []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data integrity</CardTitle>
        <CardDescription>
          per-device seq tracking ({fmtInt(storage?.seq.devices)} devices) ·
          writer {storage?.writer.writeMode ?? "—"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {metrics.length === 0
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))
            : metrics.map((m) => (
                <div
                  key={m.label}
                  className="flex flex-col gap-1 rounded-lg border p-3"
                >
                  <span className="text-xs text-muted-foreground">
                    {m.label}
                  </span>
                  <Badge
                    variant={
                      m.bad ? "destructive" : m.info ? "outline" : "secondary"
                    }
                    className="w-fit tabular-nums"
                  >
                    {fmtInt(m.value)}
                  </Badge>
                </div>
              ))}
        </div>
      </CardContent>
    </Card>
  )
}
