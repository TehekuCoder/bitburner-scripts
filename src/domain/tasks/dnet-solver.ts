import { NS } from "@ns";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";
import {
  DnetAuthAttemptState,
  ServerAuthDetails,
} from "/shared/types/network.js";
import { runSolver } from "../solvers/solveManager";
import {
  COOLDOWN_MS,
  COOLDOWN_FILE,
  DNET_MASTER_PORT,
} from "/shared/constants/darknet";
import { DnetMasterMessage } from "/shared/types/network";
import {
  loadDnetCooldowns,
  loadDnetPasswords,
  authenticateDnet,
  recordDnetCooldown,
  recordDnetPassword,
} from "/infrastructure/runtime/dnet-state.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (ns.args.length < 1) return;
  const host = String(ns.args[0]);
  const currentHost = ns.getHostname();
  const logger = new Logger(ns, `SOLVER-${host}`);
  const authAttemptState: DnetAuthAttemptState = { inconclusive: false };

  if (isServerInCooldown(ns, host)) return;

  let details: ReturnType<NS["dnet"]["getServerDetails"]> | null = null;
  try {
    details = ns.dnet.getServerDetails(host);
  } catch (error: unknown) {
    logger.error(
      `❌ Konnte ServerDetails für '${host}' auf '${currentHost}' nicht abrufen: ${String(error)}`,
    );
    return;
  }

  if (!details) {
    logger.error(`❌ Konnte ServerDetails für '${host}' nicht abrufen.`);
    return;
  }
  if (details.isOnline === false) {
    logger.warn(`Darknet-Server ${host} ist offline; kein Cooldown gesetzt.`);
    return;
  }

  // 🚨 CRITICAL FIX: Wenn bereits eine Session besteht, abgebrochen & direkt als Erfolg werten
  if (details.hasSession) {
    logger.info(
      `ℹ️ Session auf ${host} ist bereits aktiv. Kein neuer Angriff nötig.`,
    );
    return;
  }

  // 1. Bekannte Passwörter aus Cache prüfen
  const cachedPw = loadDnetPasswords(ns)[host];
  if (
    typeof cachedPw === "string" &&
    (await tryAuthenticate(ns, host, cachedPw, logger, authAttemptState))
  ) {
    handleSuccess(ns, host, cachedPw, logger);
    return;
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
    authAttemptState,
  );

  // 3. Fallback: Wörterbuch- & Loot-Angriff
  if (password === null) {
    logger.warn(
      `⚠️ Kein Solver-Ergebnis für '${details.modelId}' auf ${host}. Starte Fallbacks.`,
    );
    password = await dictionaryAttack(
      ns,
      host,
      details,
      logger,
      authAttemptState,
    );
    if (password === null) {
      password = await fileLootAttack(
        ns,
        host,
        details,
        logger,
        authAttemptState,
      );
    }
  }

  // 4. Passwort verifizieren & Anmelden
  if (password !== null) {
    if (
      await tryAuthenticate(ns, host, password, logger, authAttemptState)
    ) {
      handleSuccess(ns, host, password, logger);
    } else if (!authAttemptState.inconclusive) {
      logger.error(`❌ Ermitteltes Passwort für ${host} wurde abgelehnt. Setze Cooldown.`);
      await setServerCooldown(ns, host, logger);
    } else {
      logger.warn(`Authentifizierung bei ${host} war nicht aussagekräftig; kein Cooldown gesetzt.`);
    }
  } else if (!authAttemptState.inconclusive) {
    logger.warn(`⏳ Konnte ${host} nicht knacken. Aktiviere Cooldown.`);
    await setServerCooldown(ns, host, logger);
  } else {
    logger.warn(`Authentifizierung bei ${host} war nicht aussagekräftig; kein Cooldown gesetzt.`);
  }
}

function handleSuccess(ns: NS, host: string, pw: string, logger: Logger): void {
  recordDnetPassword(ns, host, pw);
  const message: DnetMasterMessage = { type: "password", host, password: pw };
  if (!ns.tryWritePort(DNET_MASTER_PORT, JSON.stringify(message))) {
    logger.error(`Passwort für ${host} konnte nicht an den DNet-Master übermittelt werden.`);
  }
  logger.success(`🎉 [SUCCESS] Server gebrochen: ${host}.`);
}

function isServerInCooldown(ns: NS, host: string): boolean {
  const timestamp = loadDnetCooldowns(ns).get(host) ?? -Infinity;
  return Date.now() - timestamp < COOLDOWN_MS;
}

async function setServerCooldown(
  ns: NS,
  host: string,
  logger: Logger,
): Promise<void> {
  const timestamp = Date.now();
  recordDnetCooldown(ns, host, timestamp);
  await ns.write(COOLDOWN_FILE, `${host},${timestamp}\n`, "a");
  const message: DnetMasterMessage = { type: "cooldown", host, timestamp };
  if (!ns.tryWritePort(DNET_MASTER_PORT, JSON.stringify(message))) {
    logger.warn(`Cooldown für ${host} konnte nicht an den DNet-Master übermittelt werden.`);
  }
}

async function dictionaryAttack(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
  logger: Logger,
  authAttemptState: DnetAuthAttemptState,
): Promise<string | null> {
  const passwordDb = loadDnetPasswords(ns);
  const targetLen = details.passwordLength;

  for (const candidate of Object.values(passwordDb)) {
    if (
      candidate.length >= 30 ||
      candidate.includes("You have discovered")
    )
      continue;
    if (
      targetLen !== undefined &&
      candidate.length !== targetLen &&
      candidate !== ""
    ) continue;

    if (
      await tryAuthenticate(ns, host, candidate, logger, authAttemptState)
    ) return candidate;
  }
  return null;
}

async function fileLootAttack(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
  logger: Logger,
  authAttemptState: DnetAuthAttemptState,
): Promise<string | null> {
  try {
    const currentHost = ns.getHostname();
    const files = ns.ls(host, ".txt");
    const maxLen = details.passwordLength ?? 30;

    for (const file of files) {
      if (!ns.scp(file, currentHost, host) || !ns.fileExists(file, currentHost)) {
        logger.warn(`Loot-Datei ${file} konnte nicht von ${host} übertragen werden.`);
        continue;
      }
      const content = ns.read(file).replace(/\r?\n$/, "");
      ns.rm(file, currentHost);

      if (
        (content.length <= maxLen || content === "") &&
        (await tryAuthenticate(ns, host, content, logger, authAttemptState))
      ) {
        return content;
      }
    }
  } catch (error) {
    logger.warn(`Loot-Angriff auf ${host} fehlgeschlagen: ${String(error)}`);
  }
  return null;
}

async function tryAuthenticate(
  ns: NS,
  host: string,
  pw: string,
  logger: Logger,
  authAttemptState: DnetAuthAttemptState,
): Promise<boolean> {
  try {
    const authResult = await authenticateDnet(ns, host, pw, authAttemptState);
    if (authResult.success) return true;
    logger.debug(`Authentifizierung auf ${host} abgelehnt (Code ${authResult.code}).`);
    return false;
  } catch (error) {
    logger.warn(`Authentifizierungsanfrage an ${host} fehlgeschlagen: ${String(error)}`);
    return false;
  }
}
