import { NS } from "@ns";
import { Logger } from "../core/logger.js";
import { runSolver } from "/modules/solvers/solveManager";
import { ServerAuthDetails } from "/core/types.js";
import { COOLDOWN_FILE, COOLDOWN_MS } from "/lib/constants.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (ns.args.length < 1) return;
  const host = String(ns.args[0]);

  const logger = new Logger(
    ns,
    `SOLVER-${host}`,
    "INFO",
    "/logs/dnet_system.txt"
  );

  if (isServerInCooldown(ns, host)) return;

  const connectedServers = ns.dnet.probe();
  if (!connectedServers.includes(host)) {
    logger.warn(`⚠️ Host '${host}' nicht mehr erreichbar. Abbruch.`);
    return;
  }

  // 1. Live-Details vom Server laden
  const details = ns.dnet.getServerDetails(host) as ServerAuthDetails;
  if (!details) {
    logger.error(`❌ Konnte ServerDetails für '${host}' nicht abrufen.`, false);
    return;
  }

  logger.info(`🔨 Krypto-Angriff auf Modell [${details.modelId}] gestartet...`);

  // 2. Haupt-Solver ausführen
  let password = await runSolver(ns, host, details.modelId || "Unknown", details);

  // 3. Fallbacks ausführen, falls der Solver kein Passwort fand
  if (!password) {
    logger.warn(`⚠️ Kein Solver-Ergebnis für '${details.modelId}' auf ${host}. Starte Fallbacks.`);
    password = (await dictionaryAttack(ns, host, details)) || (await fileLootAttack(ns, host, details));
  }

  // 4. Zentraler Abschluss
  if (password) {
    handleSuccess(ns, host, password, logger);
  } else {
    logger.error(`❌ Krypto-Angriff auf ${host} (${details.modelId}) fehlgeschlagen. Cooldown aktiviert.`, false);
    setServerCooldown(ns, host);
  }
}

/**
 * Zentrale Erfolgsabwicklung – vermeidet Code-Duplizierung
 */
function handleSuccess(ns: NS, host: string, pw: string, logger: Logger): void {
  ns.writePort(5, `${host}:${pw}`);
  updateJsonDatabase(ns, host, pw);
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

function setServerCooldown(ns: NS, host: string): void {
  let content = "";
  const now = Date.now();
  if (ns.fileExists(COOLDOWN_FILE)) {
    const lines = ns.read(COOLDOWN_FILE).split("\n");
    content = lines
      .filter((line) => now - Number(line.split(",")[1]) < COOLDOWN_MS)
      .join("\n");
  }
  content += (content ? "\n" : "") + `${host},${now}`;
  ns.write(COOLDOWN_FILE, content, "w");
}

function updateJsonDatabase(ns: NS, host: string, newPw: string): void {
  const file = "/dnet-master-db.json";
  let db: Record<string, string> = {};
  if (ns.fileExists(file)) {
    try {
      db = JSON.parse(ns.read(file));
    } catch {
      db = {};
    }
  }
  db[host] = newPw;
  ns.write(file, JSON.stringify(db, null, 2), "w");
}

async function dictionaryAttack(ns: NS, host: string, details: ServerAuthDetails): Promise<string | null> {
  const jsonDbFile = "/dnet-master-db.json";
  if (!ns.fileExists(jsonDbFile)) return null;
  try {
    const db = JSON.parse(ns.read(jsonDbFile));
    const list = [...new Set(Object.values(db) as string[])].filter(
      (pw) => pw !== undefined && !pw.includes("You have discovered") && pw.length < 30
    );
    for (const pw of list) {
      if (details.passwordLength && pw.length !== details.passwordLength) continue;
      if ((await ns.dnet.authenticate(host, pw)).success) {
        return pw;
      }
    }
  } catch {}
  return null;
}

async function fileLootAttack(ns: NS, host: string, details: ServerAuthDetails): Promise<string | null> {
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