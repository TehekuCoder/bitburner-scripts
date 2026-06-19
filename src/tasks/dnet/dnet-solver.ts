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
const COOLDOWN_MS = 5 * 60 * 1000; // 5 Minuten Pause für blockierte Server

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (ns.args.length < 5) {
    ns.tprint("❌ Fehler: Zu wenige Argumente vom Crawler übergeben.");
    return;
  }

  // 1. Parameter vom Crawler einlesen
  const host = String(ns.args[0]);
  const modelId = String(ns.args[1]);
  const pwLen = Number(ns.args[2]);
  const pwHint = String(ns.args[3]);
  const data = String(ns.args[4]);

  // 2. Persistenten Cooldown-Check durchführen (Datei-basiert)
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
    passwordFormat: "numeric", // Hinweis: Falls der Crawler das Format kennt, hier dynamisch mappen!
  };

  // --- PHASE 1: HEURISTISCHE SCHNELLSCHÜSSE ---
  const smartGuesses = getHeuristicCandidates(details);
  ns.print(`🎯 Generierte ${smartGuesses.length} Heuristik-Kandidaten...`);

  for (const guess of smartGuesses) {
    const res = await ns.dnet.authenticate(host, guess);
    if (res.success) {
      ns.tprint(
        `🚀 [SOLVER] Blitz-Erfolg bei ${host} via Heuristik: "${guess}"`,
      );
      ns.writePort(5, `${host}:${guess}`);
      return;
    }
  }

  // --- PHASE 2: SCHNELLE DICTIONARY- & LOOT-ANGRIFFE ---
  ns.print(
    "⚠️ Heuristik fehlgeschlagen. Starte Standard-Wörterbuch-Attacke...",
  );

  if (await dictionaryAttack(ns, host, details)) {
    ns.print(`🎉 [OK] Dictionary Attack erfolgreich auf ${host}.`);
    return;
  }
  if (await fileLootAttack(ns, host, details)) {
    ns.print(`🎉 [OK] File Loot Attack erfolgreich auf ${host}.`);
    return;
  }

  // --- PHASE 3: MODULARE MODELL-WEICHE (KRYPTO) ---
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
      const passCloud = await solveCloudBlare(ns, host, details);
      if (passCloud) {
        const resCloud = await ns.dnet.authenticate(host, passCloud);
        if (resCloud.success) correctPassword = passCloud;
      }
      break;
    case "ZeroLogon":
      const resZero = await ns.dnet.authenticate(host, "");
      if (resZero.success) correctPassword = "";
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
      ns.print(
        `⚠️ Unbekanntes Modell: ${details.modelId}. Versuche AccountsManager-Fallback...`,
      );
      correctPassword = await solveAccountsManager(ns, host, details);
      break;
  }

  // --- PHASE 4: FINALE AUSWERTUNG & NETZWERK-AUTH ---
  if (correctPassword !== null) {
    const authResult = await ns.dnet.authenticate(host, correctPassword);
    if (authResult.success) {
      ns.writePort(5, `${host}:${correctPassword}`);
      updatePasswordFile(ns, correctPassword);
      ns.tprint(
        `🎉 [SUCCESS] ${host} erfolgreich gehackt! PW: "${correctPassword}"`,
      );
      return;
    }
  }

  // Wenn ALLE Stricke gerissen sind (Heuristik, Dictionary, Krypto fehlgeschlagen):
  ns.tprint(`❌ [FAILED] Konnte ${host} nicht brechen. Setze Cooldown.`);
  setServerCooldown(ns, host);
}

// ============================================================================
// HILFSFUNKTIONEN FÜR PERSISTENTEN COOLDOWN
// ============================================================================

function isServerInCooldown(ns: NS, host: string): boolean {
  if (!ns.fileExists(COOLDOWN_FILE, "home")) return false;
  const lines = ns.read(COOLDOWN_FILE).split("\n");
  const now = Date.now();

  for (const line of lines) {
    const [cHost, cTime] = line.split(",");
    if (cHost === host) {
      if (now - Number(cTime) < COOLDOWN_MS) {
        return true; // Noch gesperrt
      }
    }
  }
  return false;
}

function setServerCooldown(ns: NS, host: string): void {
  let content = "";
  const now = Date.now();

  if (ns.fileExists(COOLDOWN_FILE, "home")) {
    // Altes Zeug filtern, um die Datei sauber zu halten
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

// ============================================================================
// RESTLICHE HILFSFUNKTIONEN (Dictionary, Loot, Heuristik)
// ============================================================================

async function dictionaryAttack(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
): Promise<boolean> {
  if (!ns.fileExists("/passwords.txt", "home")) return false;

  const list = [
    ...new Set(
      ns
        .read("/passwords.txt")
        .split(/[\r\n,]+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
    ),
  ];

  for (const pw of list) {
    if (details.passwordLength && pw.length !== details.passwordLength)
      continue;
    if (details.passwordFormat === "numeric" && !/^\d+$/.test(pw)) continue;
    if (details.passwordFormat === "alphabetic" && !/^[a-zA-Z]+$/.test(pw))
      continue;

    if ((await ns.dnet.authenticate(host, pw)).success) {
      ns.writePort(5, `${host}:${pw}`);
      return true;
    }
  }
  return false;
}

async function fileLootAttack(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
): Promise<boolean> {
  try {
    const files = ns.ls(host, ".txt");
    for (const file of files) {
      const content = ns.read(file).trim();
      if (content.length <= (details.passwordLength || 20)) {
        if ((await ns.dnet.authenticate(host, content)).success) {
          ns.writePort(5, `${host}:${content}`);
          return true;
        }
      }
    }
  } catch {}
  return false;
}

function updatePasswordFile(ns: NS, newPw: string): void {
  const file = "/passwords.txt";
  if (
    !newPw ||
    newPw.includes("You have discovered") ||
    newPw.includes(" shares of")
  )
    return;

  const pws = new Set<string>();
  if (ns.fileExists(file)) {
    ns.read(file)
      .split(/[\n,]+/)
      .forEach((p) => p.trim() && pws.add(p.trim()));
  }

  if (!pws.has(newPw)) {
    ns.write(file, `\n${newPw}`, "a");
  }
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
