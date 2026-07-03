import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: string
  unit?: string
  icon?: LucideIcon
  sub?: ReactNode
  loading?: boolean
  emphasis?: boolean
}

export function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  sub,
  loading,
  emphasis,
}: StatCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {Icon ? <Icon className="size-4" /> : null}
          {label}
        </CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums">
          {loading ? (
            <Skeleton className="h-9 w-24" />
          ) : (
            <span className={cn(emphasis && "text-destructive")}>
              {value}
              {unit ? (
                <span className="ml-1 text-base font-normal text-muted-foreground">
                  {unit}
                </span>
              ) : null}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      {sub ? (
        <CardFooter className="text-xs text-muted-foreground">{sub}</CardFooter>
      ) : null}
    </Card>
  )
}
