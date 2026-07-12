import { API_URL } from "../api";

export function StatusBar({ connected, deviceCount }: { connected: boolean; deviceCount: number }) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-[#26355e] bg-[#111a2e]">
      <div>
        <h1 className="text-2xl font-semibold">IoTS Project 3 — CEP + MaaS Dashboard</h1>
        <p className="text-sm text-slate-400 mono">
          Analytics @ <span className="text-[#4dabf7]">{API_URL}</span> · devices seen: {deviceCount}
        </p>
      </div>
      <div
        className={
          "flex items-center gap-2 px-3 py-1.5 rounded border text-sm mono " +
          (connected
            ? "border-[#37d67a] text-[#37d67a] bg-[#37d67a]/10"
            : "border-[#f14a4a] text-[#f14a4a] bg-[#f14a4a]/10")
        }
      >
        <span className={"inline-block w-2 h-2 rounded-full " + (connected ? "bg-[#37d67a]" : "bg-[#f14a4a]")} />
        Socket.IO {connected ? "connected" : "disconnected"}
      </div>
    </header>
  );
}
