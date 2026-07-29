import { NS } from "@ns";
import { runSolver } from "solvers/solveManager.js";
import { COOLDOWN_FILE, COOLDOWN_MS } from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { ServerAuthDetails } from "/lib/types.js";

function isAuthSuccess(result: unknown): boolean {
  if (typeof result === "boolean") return result;
  if (result && typeof result === "object" && "success" in result) {
    return Boolean((result as { success?: boolean }).success);
  }
  return false;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (ns.args.length < 1) return;
  const host = String(ns.args[0]);
  const currentHost = ns.getHostname();

  const logger = new Logger(ns, `SOLVER-${host}`);

  if (isServerInCooldown(ns, host)) return;

  const jsonDbFile = "/dnet-master-db.json";

  // DB von Home holen, falls nicht lokal vorhanden
  if (currentHost !== "home" && ns.fileExists(jsonDbFile, "home")) {
    ns.scp(jsonDbFile, currentHost, "home");
  }

  // 1. Bekannte Passwörter aus Cache prüfen
  if (ns.fileExists(jsonDbFile)) {
    try {
      const db = JSON.parse(ns.read(jsonDbFile));
      if (db[host] !== undefined) {
        if (await tryAuthenticate(ns, host, db[host])) {
          logger.success(
            `🎉 [SUCCESS] Session für ${host} über bekannten Passwort-Cache hergestellt!`,
          );
          handleSuccess(ns, host, db[host], logger);
          return;
        }
      }
    } catch {}
  }

  const details = ns.dnet.getServerDetails(host) as ServerAuthDetails;
  if (!details) {
    logger.error(`❌ Konnte ServerDetails für '${host}' nicht abrufen.`);
    await setServerCooldown(ns, host);
    return;
  }

  logger.info(`🔨 Krypto-Angriff auf Modell [${details.modelId}] gestartet...`);

  // 2. Krypto-Solver ausführen
  let password = await runSolver(
    ns,
    host,
    details.modelId || "Unknown",
    details,
    logger,
  );

  // 3. Fallback: Wörterbuch- & Loot-Angriff
  if (password === null) {
    logger.warn(
      `⚠️ Kein Solver-Ergebnis für '${details.modelId}' auf ${host}. Starte Fallbacks.`,
    );
    password =
      (await dictionaryAttack(ns, host, details)) ||
      (await fileLootAttack(ns, host, details));
  }

  // 4. Passwort verifizieren & Anmelden
  if (password !== null) {
    if (await tryAuthenticate(ns, host, password)) {
      handleSuccess(ns, host, password, logger);
    } else {
      logger.error(
        `❌ Passwort "${password}" ermittelt, aber Auth fehlgeschlagen. Setze Cooldown.`,
      );
      await setServerCooldown(ns, host);
    }
  } else {
    logger.warn(`⏳ Konnte ${host} nicht knacken. Aktiviere Cooldown.`);
    await setServerCooldown(ns, host);
  }
}

function handleSuccess(ns: NS, host: string, pw: string, logger: Logger): void {
  // Passwort an den zentralen Master senden
  ns.writePort(5, JSON.stringify({ host, password: pw }));
  logger.success(`🎉 [SUCCESS] Server gebrochen! ${host} -> "${pw}"`);
}

function isServerInCooldown(ns: NS, host: string): boolean {
  if (!ns.fileExists(COOLDOWN_FILE)) return false;
  const lines = ns.read(COOLDOWN_FILE).split("\n");
  const now = Date.now();

  for (const line of lines) {
    const parts = line.split(",");
    if (parts.length >= 2) {
      const [cHost, cTime] = parts;
      if (cHost === host && now - Number(cTime) < COOLDOWN_MS) {
        return true;
      }
    }
  }
  return false;
}

async function setServerCooldown(ns: NS, host: string): Promise<void> {
  const now = Date.now();
  await ns.write(COOLDOWN_FILE, `${host},${now}\n`, "a");
}

async function dictionaryAttack(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
): Promise<string | null> {
  const jsonDbFile = "/dnet-master-db.json";
  if (!ns.fileExists(jsonDbFile)) return null;
  try {
    const db = JSON.parse(ns.read(jsonDbFile));
    const list = [...new Set(Object.values(db) as string[])].filter(
      (pw) =>
        pw !== undefined &&
        !pw.includes("You have discovered") &&
        pw.length < 30,
    );
    for (const pw of list) {
      if (
        details.passwordLength !== undefined &&
        pw.length !== details.passwordLength
      )
        continue;
      if (await tryAuthenticate(ns, host, pw)) return pw;
    }
  } catch {}
  return null;
}

async function fileLootAttack(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
): Promise<string | null> {
  try {
    const currentHost = ns.getHostname();
    const files = ns.ls(host, ".txt");

    for (const file of files) {
      ns.scp(file, currentHost, host);
      const content = ns.read(file).trim();
      ns.rm(file, currentHost);

      if (content.length <= (details.passwordLength || 30)) {
        if (await tryAuthenticate(ns, host, content)) return content;
      }
    }
  } catch {}
  return null;
}

async function tryAuthenticate(ns: NS, host: string, pw: string): Promise<boolean> {
  try {
    const authResult = await ns.dnet.authenticate(host, pw);
    return isAuthSuccess(authResult);
  } catch {
    return false;
  }
}