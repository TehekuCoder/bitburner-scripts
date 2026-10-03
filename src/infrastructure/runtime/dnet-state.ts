import { NS } from "@ns";
import {
  COOLDOWN_FILE,
  DNET_COOLDOWN_STATE_PORT,
  MASTER_DB_FILE,
} from "/shared/constants/darknet.js";
import { DnetAuthAttemptState } from "/shared/types/network.js";

interface DnetSharedState {
  cooldowns: Record<string, number>;
  passwords: Record<string, string>;
}

function mergeCooldowns(
  destination: Map<string, number>,
  candidate: unknown,
): void {
  if (!candidate || typeof candidate !== "object") return;
  for (const [host, rawTimestamp] of Object.entries(candidate)) {
    if (typeof rawTimestamp !== "number" || !Number.isFinite(rawTimestamp)) {
      continue;
    }
    destination.set(
      host,
      Math.max(destination.get(host) ?? -Infinity, rawTimestamp),
    );
  }
}

function readCooldownFile(ns: NS): Map<string, number> {
  const cooldowns = new Map<string, number>();
  if (!ns.fileExists(COOLDOWN_FILE)) return cooldowns;

  for (const line of ns.read(COOLDOWN_FILE).split("\n")) {
    const [host, rawTimestamp] = line.split(",");
    const timestamp = Number(rawTimestamp);
    if (!host || !Number.isFinite(timestamp)) continue;
    cooldowns.set(host, Math.max(cooldowns.get(host) ?? -Infinity, timestamp));
  }
  return cooldowns;
}

function readStateSnapshot(ns: NS): DnetSharedState {
  const state: DnetSharedState = { cooldowns: {}, passwords: {} };
  const data = ns.getPortHandle(DNET_COOLDOWN_STATE_PORT).peek();
  if (typeof data !== "string" || data.length === 0) return state;

  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return state;

    const record = parsed as Record<string, unknown>;
    if ("cooldowns" in record || "passwords" in record) {
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
    } else {
      const legacyCooldowns = new Map<string, number>();
      mergeCooldowns(legacyCooldowns, parsed);
      state.cooldowns = Object.fromEntries(legacyCooldowns);
    }
  } catch (error) {
    ns.print(`DNet-Cooldown-Port ${DNET_COOLDOWN_STATE_PORT} ist ungültig: ${String(error)}`);
  }
  return state;
}

function readPasswordFile(ns: NS): Record<string, string> {
  if (!ns.fileExists(MASTER_DB_FILE)) return {};
  try {
    const parsed: unknown = JSON.parse(ns.read(MASTER_DB_FILE));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch (error) {
    ns.print(`DNet-Passwort-Datenbank konnte nicht gelesen werden: ${String(error)}`);
    return {};
  }
}

function writeStateSnapshot(
  ns: NS,
  cooldowns: Map<string, number>,
  passwords: Record<string, string>,
): void {
  const port = ns.getPortHandle(DNET_COOLDOWN_STATE_PORT);
  port.clear();
  const state: DnetSharedState = {
    cooldowns: Object.fromEntries(cooldowns),
    passwords,
  };
  if (!port.tryWrite(JSON.stringify(state))) {
    throw new Error(
      `DNet-Cooldown-Snapshot konnte nicht auf Port ${DNET_COOLDOWN_STATE_PORT} geschrieben werden.`,
    );
  }
}

export function loadDnetCooldowns(ns: NS): Map<string, number> {
  const cooldowns = new Map<string, number>();
  mergeCooldowns(cooldowns, readStateSnapshot(ns).cooldowns);
  mergeCooldowns(cooldowns, Object.fromEntries(readCooldownFile(ns)));
  return cooldowns;
}

export function loadDnetPasswords(ns: NS): Record<string, string> {
  const state = readStateSnapshot(ns);
  const localPasswords = readPasswordFile(ns);
  return { ...localPasswords, ...state.passwords };
}

export async function authenticateDnet(
  ns: NS,
  host: string,
  password: string,
  attemptState?: DnetAuthAttemptState,
): Promise<Awaited<ReturnType<NS["dnet"]["authenticate"]>>> {
  try {
    const result = await ns.dnet.authenticate(host, password);
    if (!result.success && result.code !== 401 && attemptState) {
      attemptState.inconclusive = true;
    }
    return result;
  } catch (error) {
    if (attemptState) attemptState.inconclusive = true;
    throw error;
  }
}

export function recordDnetCooldown(
  ns: NS,
  host: string,
  timestamp: number,
): void {
  if (!host || !Number.isFinite(timestamp)) {
    throw new Error("Ungültiger Host oder Zeitstempel für DNet-Cooldown.");
  }

  const cooldowns = loadDnetCooldowns(ns);
  cooldowns.set(host, Math.max(cooldowns.get(host) ?? -Infinity, timestamp));
  writeStateSnapshot(ns, cooldowns, loadDnetPasswords(ns));
}

export function recordDnetPassword(
  ns: NS,
  host: string,
  password: string,
): void {
  if (!host || typeof password !== "string") {
    throw new Error("Ungültiger Host oder Passwort für DNet-Snapshot.");
  }
  const passwords = loadDnetPasswords(ns);
  passwords[host] = password;
  writeStateSnapshot(ns, loadDnetCooldowns(ns), passwords);
}

export async function publishDnetState(
  ns: NS,
  cooldowns: Map<string, number>,
  passwords: Record<string, string>,
): Promise<void> {
  const mergedCooldowns = loadDnetCooldowns(ns);
  for (const [host, timestamp] of cooldowns) {
    mergedCooldowns.set(
      host,
      Math.max(mergedCooldowns.get(host) ?? -Infinity, timestamp),
    );
  }
  const mergedPasswords = { ...passwords, ...loadDnetPasswords(ns) };
  const contents = [...mergedCooldowns.entries()]
    .sort(([hostA], [hostB]) => hostA.localeCompare(hostB))
    .map(([host, timestamp]) => `${host},${timestamp}`)
    .join("\n");

  writeStateSnapshot(ns, mergedCooldowns, mergedPasswords);
  await ns.write(COOLDOWN_FILE, contents, "w");
}
