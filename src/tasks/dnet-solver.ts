import { NS } from "@ns";
import { runSolver } from "solvers/solveManager.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { ServerAuthDetails } from "/lib/types/network";
import { COOLDOWN_FILE, COOLDOWN_MS } from "/lib/constants/dnet";

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

  let details: ServerAuthDetails | null = null;
  try {
    details = ns.dnet.getServerDetails(host) as ServerAuthDetails;
  } catch (err: any) {
    logger.error(
      `❌ Konnte ServerDetails für '${host}' auf '${currentHost}' nicht abrufen: ${err?.message || err}`,
    );
    await setServerCooldown(ns, host);
    return;
  }

  if (!details) {
    logger.error(`❌ Konnte ServerDetails für '${host}' nicht abrufen.`);
    await setServerCooldown(ns, host);
    return;
  }

  // 🚨 CRITICAL FIX: Wenn bereits eine Session besteht, abgebrochen & direkt als Erfolg werten
  if (details.hasSession) {
    logger.info(
      `ℹ️ Session auf ${host} ist bereits aktiv. Kein neuer Angriff nötig.`,
    );
    return;
  }

  const jsonDbFile = "/dnet-master-db.json";

  if (currentHost !== "home" && ns.fileExists(jsonDbFile, "home")) {
    ns.scp(jsonDbFile, currentHost, "home");
  }

  // 1. Bekannte Passwörter aus Cache prüfen
  if (ns.fileExists(jsonDbFile)) {
    try {
      const db = JSON.parse(ns.read(jsonDbFile));
      const cachedPw = db[host];
      if (cachedPw && (await tryAuthenticate(ns, host, cachedPw))) {
        handleSuccess(ns, host, cachedPw, logger);
        return;
      }
    } catch {}
  }

  logger.info(
    `🔨 Krypto-Angriff auf Modell [${details.modelId || "Unknown"}] gestartet...`,
  );

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
  ns.writePort(5, JSON.stringify({ host, password: pw }));
  logger.success(`🎉 [SUCCESS] Server gebrochen! ${host} -> "${pw}"`);
}

function isServerInCooldown(ns: NS, host: string): boolean {
  if (!ns.fileExists(COOLDOWN_FILE)) return false;
  const lines = ns.read(COOLDOWN_FILE).split("\n");
  const now = Date.now();

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length >= 2 && parts[0] === host) {
      return now - Number(parts[1]) < COOLDOWN_MS;
    }
  }
  return false;
}

async function setServerCooldown(ns: NS, host: string): Promise<void> {
  await ns.write(COOLDOWN_FILE, `${host},${Date.now()}\n`, "a");
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
    const targetLen = details.passwordLength;

    for (const pw of Object.values(db) as string[]) {
      if (!pw || pw.length >= 30 || pw.includes("You have discovered"))
        continue;
      if (targetLen !== undefined && pw.length !== targetLen) continue;

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
    const maxLen = details.passwordLength || 30;

    for (const file of files) {
      ns.scp(file, currentHost, host);
      const content = ns.read(file).trim();
      ns.rm(file, currentHost);

      if (
        content.length <= maxLen &&
        (await tryAuthenticate(ns, host, content))
      ) {
        return content;
      }
    }
  } catch {}
  return null;
}

async function tryAuthenticate(
  ns: NS,
  host: string,
  pw: string,
): Promise<boolean> {
  try {
    const authResult = await ns.dnet.authenticate(host, pw);
    return isAuthSuccess(authResult);
  } catch {
    return false;
  }
}
