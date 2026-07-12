export function DeviceSelector({
  devices,
  value,
  onChange,
}: {
  devices: string[];
  value: string | null;
  onChange: (device: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-400">device</span>
      <select
        className="bg-[#182545] border border-[#26355e] rounded px-2 py-1 mono text-slate-200"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {devices.length === 0 && <option value="">(no devices yet)</option>}
        {devices.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </label>
  );
}
