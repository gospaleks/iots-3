/**
 * Shared axios client factory + per-service base URLs.
 *
 * Base URLs come from Vite env (VITE_*_URL); defaults target the local
 * docker `app` stack (ingestion :3001, storage :3002, analytics :3003).
 * The services must have CORS enabled (CORS_ORIGINS) for the browser to read these.
 */
import axios, { type AxiosInstance } from "axios"

const env = import.meta.env

export const INGESTION_URL = env.VITE_INGESTION_URL ?? "http://localhost:3001"
export const STORAGE_URL = env.VITE_STORAGE_URL ?? "http://localhost:3002"
export const ANALYTICS_URL = env.VITE_ANALYTICS_URL ?? "http://localhost:3003"

export const TIMEOUT_MS = 3000

export function createServiceClient(baseURL: string): AxiosInstance {
  return axios.create({ baseURL, timeout: TIMEOUT_MS })
}
