/**
 * Storage service client — GET /stats.
 */
import type { StorageStats } from "@/lib/types"
import { createServiceClient, STORAGE_URL } from "./client"

const storage = createServiceClient(STORAGE_URL)

export async function fetchStorageStats(): Promise<StorageStats> {
  const { data } = await storage.get<StorageStats>("/stats")
  return data
}
