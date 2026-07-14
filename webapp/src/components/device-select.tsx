import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { deviceProfile } from "@/lib/api"

interface DeviceSelectProps {
  devices: string[]
  value: string | null
  onChange: (device: string) => void
}

export function DeviceSelect({ devices, value, onChange }: DeviceSelectProps) {
  const selected = value ? deviceProfile(value) : null

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(v) => {
        if (typeof v === "string") onChange(v)
      }}
    >
      <SelectTrigger
        className="h-11 w-full sm:w-80"
        disabled={devices.length === 0}
      >
        {selected ? (
          <span className="flex items-center gap-2 truncate">
            <span className="font-medium">{selected.label}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {value}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">Waiting for devices…</span>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {devices.map((d) => {
            const p = deviceProfile(d)
            return (
              <SelectItem key={d} value={d}>
                <span className="flex flex-col">
                  <span className="font-medium">{p.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {d} · {p.hint}
                  </span>
                </span>
              </SelectItem>
            )
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
