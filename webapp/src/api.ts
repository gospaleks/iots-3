import axios from "axios";
import { io, Socket } from "socket.io-client";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3003";

export const http = axios.create({ baseURL: API_URL, timeout: 5000 });

export type CepEvent = {
  event_type: string;
  device: string;
  ts?: number;
  window_start?: number;
  window_end?: number;
  avg_temp?: number;
  max_temp?: number;
  min_temp?: number;
  avg_humidity?: number;
  avg_co?: number;
  avg_lpg?: number;
  avg_smoke?: number;
  sample_count?: number;
  co?: number;
  temp?: number;
};

export type EnrichedAlert = {
  ts: number;
  device: string;
  event_type: string;
  actual_avg_temp: number | null;
  forecast_next_avg_temp: number | null;
  forecast_available: boolean;
  model_version: string | null;
  message: string;
  window_start?: number | null;
  window_end?: number | null;
  decision_time_ms?: number;
};

export type ForecastPoint = {
  ts: number;
  actual_avg_temp: number | null;
  forecast_next_avg_temp: number | null;
  forecast_available: boolean;
  event_type: string;
};

export function connectSocket(): Socket {
  return io(API_URL, { transports: ["websocket", "polling"] });
}

export async function fetchEvents(limit = 100): Promise<CepEvent[]> {
  const { data } = await http.get<CepEvent[]>("/api/events", { params: { limit } });
  return data;
}
export async function fetchAlerts(limit = 100): Promise<EnrichedAlert[]> {
  const { data } = await http.get<EnrichedAlert[]>("/api/alerts", { params: { limit } });
  return data;
}
export async function fetchForecast(device: string, limit = 100): Promise<ForecastPoint[]> {
  const { data } = await http.get<ForecastPoint[]>(`/api/forecast/${encodeURIComponent(device)}`, { params: { limit } });
  return data;
}
export async function fetchDevices(): Promise<string[]> {
  const { data } = await http.get<{ devices: string[] }>("/api/devices");
  return data.devices;
}
