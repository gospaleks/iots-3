/**
 * Generic /stats query wrapper. Each service polls on the same `pollMs`
 * cadence and exposes its loading/error state through a uniform
 * `ServiceStatus` triple ("up" | "down" | "loading").
 */
import { useQuery, type QueryKey } from "@tanstack/react-query"

export type ServiceStatus = "up" | "down" | "loading"

function statusOf(q: { isError: boolean; data: unknown }): ServiceStatus {
  if (q.isError) return "down"
  return q.data ? "up" : "loading"
}

export interface ServiceQuery<T> {
  data: T | undefined
  status: ServiceStatus
}

export function useServiceStats<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  pollMs: number
): ServiceQuery<T> {
  const q = useQuery({
    queryKey: key,
    queryFn: fetcher,
    refetchInterval: pollMs,
  })
  return { data: q.data, status: statusOf(q) }
}
