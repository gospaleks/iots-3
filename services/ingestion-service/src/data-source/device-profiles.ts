/**
 * The three real device profiles from the dataset (shared/dataset_info.md §2.2).
 * Replay buckets CSV rows by these MACs; random generates within these ranges.
 * Simulated devices are mapped onto these profiles round-robin so the three
 * environmental characters are preserved even when NUM_DEVICES ≫ 3.
 */
export interface Range {
  min: number;
  max: number;
}

export interface DeviceProfile {
  mac: string;
  label: string;
  // Random-mode value ranges, approximated from the dataset's per-device character.
  co: Range;
  humidity: Range;
  lpg: Range;
  smoke: Range;
  temp: Range;
  lightProb: number;
  motionProb: number;
}

export const DEVICE_PROFILES: DeviceProfile[] = [
  {
    mac: '00:0f:00:70:91:0a',
    label: 'stable-cool-humid',
    co: { min: 0.0045, max: 0.0065 },
    humidity: { min: 50, max: 75 },
    lpg: { min: 0.007, max: 0.009 },
    smoke: { min: 0.019, max: 0.025 },
    temp: { min: 19, max: 23 },
    lightProb: 0.3,
    motionProb: 0.02,
  },
  {
    mac: '1c:bf:ce:15:ec:4d',
    label: 'highly-variable',
    co: { min: 0.001, max: 0.012 },
    humidity: { min: 20, max: 99 },
    lpg: { min: 0.003, max: 0.012 },
    smoke: { min: 0.008, max: 0.032 },
    temp: { min: 19, max: 30 },
    lightProb: 0.5,
    motionProb: 0.05,
  },
  {
    mac: 'b8:27:eb:bf:9d:51',
    label: 'stable-warm-dry',
    co: { min: 0.003, max: 0.007 },
    humidity: { min: 1, max: 25 },
    lpg: { min: 0.006, max: 0.009 },
    smoke: { min: 0.016, max: 0.024 },
    temp: { min: 22, max: 31 },
    lightProb: 0.4,
    motionProb: 0.03,
  },
];

/** MAC → profile index, for bucketing replay rows. */
export const PROFILE_INDEX_BY_MAC: ReadonlyMap<string, number> = new Map(
  DEVICE_PROFILES.map((p, i) => [p.mac, i]),
);
