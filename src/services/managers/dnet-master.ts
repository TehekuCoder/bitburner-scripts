import { NS } from "@ns";
import {
  DNET_MASTER_PORT,
} from "/shared/constants/darknet.js";
import { DnetMasterMessage } from "/shared/types/network.js";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import {
  loadDnetCooldowns,
  loadDnetPasswords,
  publishDnetState,
} from "/infrastructure/runtime/dnet-state.js";

function parseMasterMessage(rawData: unknown): DnetMasterMessage | null {
  if (typeof rawData !== "string") return null;

  try {
    const parsed: unknown = JSON.parse(rawData);
    if (!parsed || typeof parsed !== "object") return null;

    const record = parsed as Record<string, unknown>;
    if (typeof record.host !== "string" || !record.host) return null;

    if (
      record.type === "cooldown" &&
      typeof record.timestamp === "number" &&
      Number.isFinite(record.timestamp)
    ) {
      return {
        type: "cooldown",
        host: record.host,
        timestamp: record.timestamp,
      };
    }

    if (
      (record.type === "password" || record.type === undefined) &&
      typeof record.password === "string"
    ) {
      return {
        type: "password",
        host: record.host,
        password: record.password,
      };
    }
  } catch {
    const firstColon = rawData.indexOf(":");
    if (firstColon > 0) {
      return {
        type: "password",
        host: rawData.substring(0, firstColon),
        password: rawData.substring(firstColon + 1),
      };
    }
  }

  return null;
}

async function savePasswordDatabase(
  ns: NS,
  jsonDbFile: string,
  textDbFile: string,
  passwordDb: Record<string, string>,
): Promise<void> {
  await ns.write(jsonDbFile, JSON.stringify(passwordDb, null, 2), "w");

  const uniquePasswords = [...new Set(Object.values(passwordDb))]
    .map((password) => password.trim())
    .filter(
      (password) =>
        password.length > 0 &&
        !password.includes("You have discovered") &&
        !password.includes("shares of") &&
        password.length < 30,
    );
  await ns.write(textDbFile, uniquePasswords.join("\n"), "w");
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const jsonDbFile = "/dnet-master-db.json";
  const textDbFile = "/passwords.txt";
  const logger = new LoggerClient(ns, "DNET-MASTER");
  logger.info(
    `🖥️ Darknet-Master gestartet. Synchronisiere Meldungen über Port ${DNET_MASTER_PORT}...`,
  );

  const passwordDb = loadDnetPasswords(ns);
  const cooldowns = loadDnetCooldowns(ns);
  await savePasswordDatabase(ns, jsonDbFile, textDbFile, passwordDb);
  await publishDnetState(ns, cooldowns, passwordDb);

  while (true) {
    const handle = ns.getPortHandle(DNET_MASTER_PORT);
    let passwordDbChanged = false;
    let cooldownsChanged = false;

    for (const [host, password] of Object.entries(loadDnetPasswords(ns))) {
      if (passwordDb[host] !== password) {
        passwordDb[host] = password;
        passwordDbChanged = true;
      }
    }
    for (const [host, timestamp] of loadDnetCooldowns(ns)) {
      if (timestamp > (cooldowns.get(host) ?? -Infinity)) {
        cooldowns.set(host, timestamp);
        cooldownsChanged = true;
      }
    }

    while (!handle.empty()) {
      const message = parseMasterMessage(handle.read());
      if (!message) {
        logger.warn("Ungültige Meldung auf dem DNet-Master-Port verworfen.");
        continue;
      }

      if (message.type === "password") {
        if (passwordDb[message.host] !== message.password) {
          passwordDb[message.host] = message.password;
          logger.success(`🔑 Passwort für ${message.host} registriert.`);
        }
        passwordDbChanged = true;
      } else {
        const previousTimestamp = cooldowns.get(message.host) ?? -Infinity;
        if (message.timestamp > previousTimestamp) {
          cooldowns.set(message.host, message.timestamp);
          cooldownsChanged = true;
        }
      }
    }

    if (passwordDbChanged) {
      await savePasswordDatabase(ns, jsonDbFile, textDbFile, passwordDb);
    }

    if (cooldownsChanged || passwordDbChanged) {
      await publishDnetState(ns, cooldowns, passwordDb);
    }

    await ns.asleep(500);
  }
}
