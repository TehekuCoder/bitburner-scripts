import { NS } from "@ns";

// Import aller modularen Krypto-Solver
import { solveRoman } from "/modules/solvers/solveRoman";
import { solveBaseConversion } from "/modules/solvers/solveBaseConversion";
import { solvePr0verFl0 } from "/modules/solvers/solvePr0verFl0";
import { solveOpenWebAccessPoint } from "/modules/solvers/solveOpenWebAccessPoint";
import { solveDeskMemo } from "/modules/solvers/solveDeskMemo";
import { solveCloudBlare } from "/modules/solvers/solveCloudBlare";
import { solveAnagram } from "/modules/solvers/solveAnagram";
import { solveNIL } from "/modules/solvers/solveNIL";
import { solveDeepGreen } from "/modules/solvers/solveDeepGreen";
import { solveAccountsManager } from "/modules/solvers/solveAccountsManager";
import { solveFactoriOs } from "/modules/solvers/solveFactoriOs";

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

  if (ns.args.length < 5) {
    ns.tprint("❌ Fehler: Zu wenige Argumente vom Crawler übergeben.");
    return;
  }

  const host = String(ns.args[0]);
  const modelId = String(ns.args[1]);
  const pwLen = Number(ns.args[2]);
  const pwHint = String(ns.args[3]);
  const data = String(ns.args[4]);

  if (isServerInCooldown(ns, host)) {
    ns.print(`⏳ ${host} ist noch im Cooldown. Breche ab.`);
    return;
  }

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

  // --- PHASE 1: HEURISTISCHE SCHNELLSCHÜSSE ---
  const smartGuesses = getHeuristicCandidates(details);
  for (const guess of smartGuesses) {
    if ((await ns.dnet.authenticate(host, guess)).success) {
      ns.tprint(`🚀 [SOLVER] Blitz-Erfolg bei ${host} via Heuristik: "${guess}"`);
      ns.writePort(5, `${host}:${guess}`);
      return;
    }
  }

  // --- PHASE 2: MODULARE MODELL-WEICHE ---
  ns.print(`🔨 Krypto-Angriff auf ${host} [${modelId}] gestartet...`);
  let correctPassword: string | null = null;

  switch (details.modelId) {
    case "BellaCuore":
      correctPassword = await solveRoman(ns, host, details);
      break;
    case "OctantVoxel":
      correctPassword = await solveBaseConversion(ns, host, details);
      break;
    case "Pr0verFl0":
      correctPassword = await solvePr0verFl0(ns, host, details);
      break;
    case "OpenWebAccessPoint":
      correctPassword = await solveOpenWebAccessPoint(ns, host, details);
      break;
    case "DeskMemo_3.1":
      correctPassword = await solveDeskMemo(ns, host, details);
      break;
    case "CloudBlare(tm)":
      correctPassword = await solveCloudBlare(ns, host, details);
      break;
    case "ZeroLogon":
      if ((await ns.dnet.authenticate(host, "")).success) correctPassword = "";
      break;
    case "PHP 5.4":
      correctPassword = await solveAnagram(ns, host, details);
      break;
    case "NIL":
      correctPassword = await solveNIL(ns, host, details);
      break;
    case "DeepGreen":
      correctPassword = await solveDeepGreen(ns, host, details);
      break;
    case "AccountsManager_4.2":
      correctPassword = await solveAccountsManager(ns, host, details);
      break;
    case "Factori-Os":
      correctPassword = await solveFactoriOs(ns, host, details);
      break;
    default:
      ns.print(`⚠️ Unbekanntes Modell: ${details.modelId}. Starte Dictionary-Fallback...`);
      if (await dictionaryAttack(ns, host, details)) return;
      if (await fileLootAttack(ns, host, details)) return;
      break;
  }

  // --- PHASE 3: FINALE AUSWERTUNG ---
  if (correctPassword !== null) {
    const authResult = await ns.dnet.authenticate(host, correctPassword);
    if (authResult.success) {
      ns.writePort(5, `${host}:${correctPassword}`);
      updateJsonDatabase(ns, host, correctPassword); // 🔥 Lokales JSON schreiben
      ns.tprint(`🎉 [SUCCESS] ${host} erfolgreich gehackt! PW: "${correctPassword}"`);
      return;
    }
  }

  ns.tprint(`❌ [FAILED] Konnte ${host} nicht brechen. Setze Cooldown.`);
  setServerCooldown(ns, host);
}

function isServerInCooldown(ns: NS, host: string): boolean {
  if (!ns.fileExists(COOLDOWN_FILE)) return false;
  const lines = ns.read(COOLDOWN_FILE).split("\n");
  const now = Date.now();

  for (const line of lines) {
    const [cHost, cTime] = line.split(",");
    if (cHost === host) {
      if (now - Number(cTime) < COOLDOWN_MS) {
        return true;
      }
    }
  }
  return false;
}

function setServerCooldown(ns: NS, host: string): void {
  let content = "";
  const now = Date.now();

  if (ns.fileExists(COOLDOWN_FILE)) {
    const lines = ns.read(COOLDOWN_FILE).split("\n");
    content = lines
      .filter((line) => {
        const [_, cTime] = line.split(",");
        return now - Number(cTime) < COOLDOWN_MS;
      })
      .join("\n");
  }

  content += (content ? "\n" : "") + `${host},${now}`;
  ns.write(COOLDOWN_FILE, content, "w");
}

// 🔥 NEU: Schreibt sauber strukturiert Key-Value-Paare in das lokale JSON
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
    // Wir extrahieren alle eindeutigen, validen Passwörter aus den existierenden Einträgen
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