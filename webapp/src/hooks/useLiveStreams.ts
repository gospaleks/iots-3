import { useEffect, useRef, useState } from "react";
import { connectSocket, CepEvent, EnrichedAlert } from "../api";

const MAX_EVENTS = 200;
const MAX_ALERTS = 100;

export function useLiveStreams(
  seedEvents: CepEvent[] = [],
  seedAlerts: EnrichedAlert[] = []
) {
  const [events, setEvents] = useState<CepEvent[]>(seedEvents);
  const [alerts, setAlerts] = useState<EnrichedAlert[]>(seedAlerts);
  const [connected, setConnected] = useState(false);
  const seeded = useRef({ events: false, alerts: false });

  // seed once when snapshot arrives
  useEffect(() => {
    if (!seeded.current.events && seedEvents.length > 0) {
      setEvents((prev) => (prev.length === 0 ? seedEvents : prev));
      seeded.current.events = true;
    }
  }, [seedEvents]);
  useEffect(() => {
    if (!seeded.current.alerts && seedAlerts.length > 0) {
      setAlerts((prev) => (prev.length === 0 ? seedAlerts : prev));
      seeded.current.alerts = true;
    }
  }, [seedAlerts]);

  useEffect(() => {
    const socket = connectSocket();
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("event", (evt: CepEvent) => {
      setEvents((prev) => {
        const next = [...prev, evt];
        return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
      });
    });
    socket.on("alert", (a: EnrichedAlert) => {
      setAlerts((prev) => {
        const next = [...prev, a];
        return next.length > MAX_ALERTS ? next.slice(next.length - MAX_ALERTS) : next;
      });
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  return { events, alerts, connected };
}
