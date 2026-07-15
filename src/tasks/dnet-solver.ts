import { NS } from "@ns";
import { Logger } from "../core/logger.js";
import { runSolver } from "/modules/solvers/solveManager";

export interface ServerAuthDetails {
  isConnectedToCurrentServer: boolean;
  hasSession: boolean;
  modelId: string;
  passwordHint: string;
  data: string;
  logTrafficInterval: number;
  passwordLength: number;
  passwordFormat:
    | "numeric"
    | "alphabetic"
    | "alphanumeric"
    | "ASCII"
    | "unicode";
}

const COOLDOWN_FILE = "/dnet-cooldowns.txt";
const COOLDOWN_MS = 5 * 60 * 1000;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (ns.args.length < 5) return;

  const host = String(ns.args[0]);
  const modelId = String(ns.args[1]);
  const pwLen = Number(ns.args[2]);
  const pwHint = String(ns.args[3]);
  const data = String(ns.args[4]);

  const logger = new Logger(
    ns,
    `SOLVER-${host}`,
    "INFO",
    "/logs/dnet_system.txt",
  );

  if (isServerInCooldown(ns, host)) return;

  const details: ServerAuthDetails = {
    isConnectedToCurrentServer: true,
    hasSession: false,
    modelId: modelId,
    passwordLength: pwLen,
    passwordHint: pwHint,
    data: data,
    logTrafficInterval: 60,
    passwordFormat: "numeric",
  };

  const connectedServers = ns.dnet.probe();
  if (!connectedServers.includes(host)) {
    logger.warn(`⚠️ Host '${host}' nach Thread-Reload verloren gegangen. Abbruch.`);
    return;
  }

  // Heuristik-Vorprüfung
  const smartGuesses = getHeuristicCandidates(details);
  for (const guess of smartGuesses) {
    if ((await ns.dnet.authenticate(host, guess)).success) {
      logger.success(`🚀 Blitz-Erfolg via Heuristik auf ${host}: "${guess}"`);
      ns.writePort(5, `${host}:${guess}`);
      updateJsonDatabase(ns, host, guess);
      return;
    }
  }

  logger.info(`🔨 Krypto-Angriff auf Modell [${modelId}] gestartet...`);
  
  // Der Manager übernimmt die Arbeit und wählt den passenden Solver
  const correctPassword = await runSolver(ns, host, modelId, details);

  // Fallback, falls kein passender Solver registriert ist oder fehlschlug
  if (correctPassword === null) {
    logger.warn(`⚠️ Kein Solver-Ergebnis für ${modelId}. Starte Dictionary- & File-Loot-Fallback.`);
    if (await dictionaryAttack(ns, host, details)) return;
    if (await fileLootAttack(ns, host, details)) return;
  }

  if (correctPassword !== null) {
    const authResult = await ns.dnet.authenticate(host, correctPassword);
    if (authResult.success) {
      ns.writePort(5, `${host}:${correctPassword}`);
      updateJsonDatabase(ns, host, correctPassword);
      logger.success(`🎉 [SUCCESS] Server gebrochen! ${host} -> "${correctPassword}"`);
      return;
    }
  }

  logger.error(`❌ Krypto-Angriff auf ${host} fehlgeschlagen. Cooldown aktiviert.`, false);
  setServerCooldown(ns, host);
}

// --- HILFSFUNKTIONEN ---

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

async function dictionaryAttack(ns: NS, host: string, details: ServerAuthDetails): Promise<boolean> {
  const jsonDbFile = "/dnet-master-db.json";
  if (!ns.fileExists(jsonDbFile)) return false;
  try {
    const db = JSON.parse(ns.read(jsonDbFile));
    const list = [...new Set(Object.values(db) as string[])].filter(
      (pw) => pw !== undefined && !pw.includes("You have discovered") && pw.length < 30
    );
    for (const pw of list) {
      if (details.passwordLength && pw.length !== details.passwordLength) continue;
      if ((await ns.dnet.authenticate(host, pw)).success) {
        ns.writePort(5, `${host}:${pw}`);
        updateJsonDatabase(ns, host, pw);
        return true;
      }
    }
  } catch {}
  return false;
}

async function fileLootAttack(ns: NS, host: string, details: ServerAuthDetails): Promise<boolean> {
  try {
    const files = ns.ls(host, ".txt");
    for (const file of files) {
      const content = ns.read(file).trim();
      if (content.length <= (details.passwordLength || 20)) {
        if ((await ns.dnet.authenticate(host, content)).success) {
          ns.writePort(5, `${host}:${content}`);
          updateJsonDatabase(ns, host, content);
          return true;
        }
      }
    }
  } catch {}
  return false;
}

function getHeuristicCandidates(details: ServerAuthDetails): string[] {
  const candidates: string[] = [];
  const len = details.passwordLength;
  const model = details.modelId?.toLowerCase() || "";
  if (model.includes("laika")) {
    if (len === 3) candidates.push("max");
    if (len === 4) candidates.push("fido", "spot");
    if (len === 5) candidates.push("rover");
  }
  if (model.includes("fresh") || model.includes("install")) {
    if (len === 4) candidates.push("0000");
    if (len === 5) candidates.push("12345", "admin");
    if (len === 8) candidates.push("password");
  }
  if (candidates.length === 0) {
    if (len === 3) candidates.push("max");
    if (len === 4) candidates.push("fido", "spot", "0000");
    if (len === 5) candidates.push("rover", "12345", "admin");
    if (len === 8) candidates.push("password");
  }
  return [...new Set(candidates)].filter((pw) => pw.length === len);
}