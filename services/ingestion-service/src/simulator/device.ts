import { DataSource } from '../data-source/data-source';

/** One simulated device: a stable id, its profile, and its per-device seq counter. */
export interface SimDevice {
  id: string;
  profileIndex: number;
  seq: number;
}

/**
 * Build `numDevices` simulated devices, mapped onto the available profiles
 * round-robin. When numDevices ≤ profileCount the real MACs are used 1:1;
 * otherwise ids are suffixed with the device index to stay unique while keeping
 * the originating profile visible (e.g. `00:0f:00:70:91:0a-37`).
 */
export function buildDevices(numDevices: number, dataSource: DataSource): SimDevice[] {
  const profiles = dataSource.profileCount();
  const oneToOne = numDevices <= profiles;
  const devices: SimDevice[] = [];
  for (let i = 0; i < numDevices; i++) {
    const profileIndex = i % profiles;
    const base = dataSource.profileId(profileIndex);
    devices.push({
      id: oneToOne ? base : `${base}-${i}`,
      profileIndex,
      seq: 0,
    });
  }
  return devices;
}
