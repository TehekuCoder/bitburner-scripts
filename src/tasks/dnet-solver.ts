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

  const jsonDbFile = "/dnet-master-db.json";

  // Bitburner 3.0: Erstelle zuerst die Session für diesen spezifischen PID, falls Passwort bekannt
  if (ns.fileExists(jsonDbFile)) {
    try {
      const db = JSON.parse(ns.read(jsonDbFile));
      if (db[host] !== undefined) {
        const sessionCreated = ns.dnet.connectToSession(host, db[host]);
        if (sessionCreated) {
          logger.success(`🎉 [SUCCESS] Session für PID erfolgreich hergestellt! Überspringe Solver.`);
          handleSuccess(ns, host, db[host], logger);
          return;
        }
      }
    } catch {}
  }

  const details = ns.dnet.getServerDetails(host) as ServerAuthDetails;
  if (!details) {
    logger.error(`❌ Konnte ServerDetails für '${host}' nicht abrufen.`);
    return;
  }

  logger.info(`🔨 Krypto-Angriff auf Modell [${details.modelId}] gestartet...`);

  let password = await runSolver(
    ns,
    host,
    details.modelId || "Unknown",
    details,
  );

  if (password === null) {
    logger.warn(`⚠️ Kein Solver-Ergebnis für '${details.modelId}' auf ${host}. Starte Fallbacks.`);
    password =
      (await dictionaryAttack(ns, host, details)) ||
      (await fileLootAttack(ns, host, details));
  }

  if (password !== null) {
    const auth = await ns.dnet.authenticate(host, password);
    const isSuccess = typeof auth === "boolean" ? auth : (auth && auth.success);

    if (isSuccess || ns.dnet.connectToSession(host, password)) {
      handleSuccess(ns, host, password, logger);
    } else {
      logger.error(`❌ Passwort "${password}" für ${host} ermittelt, aber Authentifizierung fehlgeschlagen.`);
      await setServerCooldown(ns, host);
    }
  } else {
    logger.error(`❌ Krypto-Angriff auf ${host} (${details.modelId}) fehlgeschlagen. Cooldown aktiviert.`);
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
      (pw) => pw !== undefined && !pw.includes("You have discovered") && pw.length < 30,
    );
    for (const pw of list) {
      if (details.passwordLength !== undefined && pw.length !== details.passwordLength)
        continue;
      if (ns.dnet.connectToSession(host, pw)) return pw;
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
        if (ns.dnet.connectToSession(host, content)) return content;
      }
    }
  } catch {}
  return null;
}