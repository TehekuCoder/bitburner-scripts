import { NS } from "@ns";
import { runSolver } from "solvers/solveManager.js";
import { COOLDOWN_FILE, COOLDOWN_MS } from "/lib/constants";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { ServerAuthDetails } from "/lib/types";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (ns.args.length < 1) return;
  const host = String(ns.args[0]);

  const logger = new Logger(ns, `SOLVER-${host}`);

  if (isServerInCooldown(ns, host)) return;

  const connectedServers = ns.dnet.probe();
  if (!connectedServers.includes(host)) {
    logger.warn(`⚠️ Host '${host}' nicht mehr erreichbar. Abbruch.`);
    return;
  }

  // 1. Live-Details vom Server laden
  const details = ns.dnet.getServerDetails(host) as ServerAuthDetails;
  if (!details) {
    logger.error(`❌ Konnte ServerDetails für '${host}' nicht abrufen.`);
    return;
  }

  // 1.1 Prüfen, ob der Server bereits geknackt wurde (Session existiert)
  if (details.hasSession) {
    logger.info(
      `✅ Session auf '${host}' existiert bereits. Solver wird vorzeitig beendet.`,
    );
    return;
  }

  // 1.2 Prüfen, ob das Passwort bereits in der Master-DB steht
  const jsonDbFile = "/dnet-master-db.json";
  if (ns.fileExists(jsonDbFile)) {
    try {
      const db = JSON.parse(ns.read(jsonDbFile));
      if (db[host] !== undefined) {
        logger.info(
          `🔍 Bekanntes Passwort für '${host}' in DB gefunden. Teste Login...`,
        );
        const auth = await ns.dnet.authenticate(host, db[host]);
        if (auth.success) {
          logger.success(
            `🎉 [SUCCESS] Direkt-Login erfolgreich! Überspringe Solver.`,
          );
          handleSuccess(ns, host, db[host], logger);
          return;
        } else {
          logger.warn(
            `⚠️ Gespeichertes Passwort war inkorrekt. Starte regulären Angriff.`,
          );
        }
      }
    } catch {}
  }

  logger.info(`🔨 Krypto-Angriff auf Modell [${details.modelId}] gestartet...`);

  // 2. Haupt-Solver ausführen
  let password = await runSolver(
    ns,
    host,
    details.modelId || "Unknown",
    details,
  );

  // 3. Fallbacks ausführen (Strikt auf null prüfen, da "" ein gültiges PW ist!)
  if (password === null) {
    logger.warn(
      `⚠️ Kein Solver-Ergebnis für '${details.modelId}' auf ${host}. Starte Fallbacks.`,
    );
    password =
      (await dictionaryAttack(ns, host, details)) ||
      (await fileLootAttack(ns, host, details));
  }

  // 4. Authentifizierung & Abschluss
  if (password !== null) {
    // ⚡ FIX: Hier muss der tatsächliche Login-Aufruf stattfinden!
    const auth = await ns.dnet.authenticate(host, password);
    if (auth.success) {
      handleSuccess(ns, host, password, logger);
    } else {
      logger.error(
        `❌ Passwort "${password}" für ${host} ermittelt, aber Login verweigert. Cooldown aktiviert.`,
      );
      await setServerCooldown(ns, host);
    }
  } else {
    logger.error(
      `❌ Krypto-Angriff auf ${host} (${details.modelId}) fehlgeschlagen. Cooldown aktiviert.`,
    );
    await setServerCooldown(ns, host);
  }
}

/**
 * Zentrale Erfolgsabwicklung: Sendet Daten sicher als JSON an Port 5.
 * Die Dateiwartung übernimmt ausschließlich der DNET-MASTER.
 */
function handleSuccess(ns: NS, host: string, pw: string, logger: Logger): void {
  ns.writePort(5, JSON.stringify({ host, password: pw }));
  logger.success(`🎉 [SUCCESS] Server gebrochen! ${host} -> "${pw}"`);
}

function isServerInCooldown(ns: NS, host: string): boolean {
  if (!ns.fileExists(COOLDOWN_FILE)) return false;
  const lines = ns.read(COOLDOWN_FILE).split("\n");
  const now = Date.now();
  for (const line of lines) {
    const [cHost, cTime] = line.split(",");
    if (cHost === host && now - Number(cTime) < COOLDOWN_MS) return true;
  }
  return false;
}

async function setServerCooldown(ns: NS, host: string): Promise<void> {
  let content = "";
  const now = Date.now();
  if (ns.fileExists(COOLDOWN_FILE)) {
    const lines = ns.read(COOLDOWN_FILE).split("\n");
    content = lines
      .filter((line) => line.trim() && now - Number(line.split(",")[1]) < COOLDOWN_MS)
      .join("\n");
  }
  content += (content ? "\n" : "") + `${host},${now}`;
  await ns.write(COOLDOWN_FILE, content, "w");
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
      if (details.passwordLength !== undefined && pw.length !== details.passwordLength)
        continue;
      if ((await ns.dnet.authenticate(host, pw)).success) {
        return pw;
      }
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
    const files = ns.ls(host, ".txt");
    for (const file of files) {
      const content = ns.read(file).trim();
      if (content.length <= (details.passwordLength || 20)) {
        if ((await ns.dnet.authenticate(host, content)).success) {
          return content;
        }
      }
    }
  } catch {}
  return null;
}