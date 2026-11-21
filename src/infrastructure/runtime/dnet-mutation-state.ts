import type { DnetHostObservation } from "/shared/types/network.js";

export interface DnetSharedState {
  cooldowns: Record<string, number>;
  passwords: Record<string, string>;
  mutationEpoch: number;
  lastMutationAt: number;
  hosts: Record<string, DnetHostObservation>;
}

export function parseDnetStateSnapshot(rawData: unknown): DnetSharedState {
  const state: DnetSharedState = {
    cooldowns: {},
    passwords: {},
    mutationEpoch: 0,
    lastMutationAt: 0,
    hosts: {},
  };
  if (typeof rawData !== "string" || rawData.length === 0) return state;

  try {
    const parsed: unknown = JSON.parse(rawData);
    if (!parsed || typeof parsed !== "object") return state;

    const record = parsed as Record<string, unknown>;
    if ("cooldowns" in record || "passwords" in record || "mutationEpoch" in record) {
      if (record.cooldowns && typeof record.cooldowns === "object") {
        for (const [host, timestamp] of Object.entries(record.cooldowns)) {
          if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
            state.cooldowns[host] = timestamp;
          }
        }
      }
      if (record.passwords && typeof record.passwords === "object") {
        for (const [host, password] of Object.entries(record.passwords)) {
          if (typeof password === "string") state.passwords[host] = password;
        }
      }
      if (typeof record.mutationEpoch === "number" && Number.isFinite(record.mutationEpoch)) {
        state.mutationEpoch = Math.max(0, Math.floor(record.mutationEpoch));
      }
      if (typeof record.lastMutationAt === "number" && Number.isFinite(record.lastMutationAt)) {
        state.lastMutationAt = Math.max(0, record.lastMutationAt);
      }
      if (record.hosts && typeof record.hosts === "object") {
        for (const [host, rawHost] of Object.entries(record.hosts)) {
          if (!rawHost || typeof rawHost !== "object") continue;
          const hostRecord = rawHost as Partial<DnetHostObservation>;
          if (
            typeof hostRecord.hostname !== "string" ||
            typeof hostRecord.observedAt !== "number" ||
            typeof hostRecord.observedMutationEpoch !== "number"
          ) continue;
          state.hosts[host] = hostRecord as DnetHostObservation;
        }
      }
    } else {
      for (const [host, timestamp] of Object.entries(record)) {
        if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
          state.cooldowns[host] = timestamp;
        }
      }
    }
  } catch {
    return state;
  }
  return state;
}
