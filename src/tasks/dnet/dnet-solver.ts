import { NS } from "@ns";

// Import aller modularen Krypto-Solver
import { solveRoman } from "/modules/solvers/solveRoman";
import { solveBaseConversion } from "/modules/solvers/solveBaseConversion";
import { solvePr0verFl0 } from "/modules/solvers/solvePr0verFl0";
import { solveOpenWebAccessPoint } from "/modules/solvers/solveOpenWebAccessPoint";
import { solveDeskMemo } from "/modules/solvers/solveDeskMemo";
import { solveCloudBlare } from "/modules/solvers/solveCloudBlare";
// import { solveDefaults } from "/modules/solvers/solveDefaults";
import { solveAnagram } from "/modules/solvers/solveAnagram";
import { solveNIL } from "/modules/solvers/solveNIL";
import { solveDeepGreen } from "/modules/solvers/solveDeepGreen";
import { solveAccountsManager } from "/modules/solvers/solveAccountsManager";
import { solveFreshInstall } from "/modules/solvers/solveFreshInstall";
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

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (ns.args.length < 5) {
    ns.tprint("❌ Fehler: Zu wenige Argumente vom Crawler übergeben.");
    return;
  }

  // 1. Parameter aus ns.args extrahieren
  const host = String(ns.args[0]);
  const modelId = String(ns.args[1]);
  const pwLen = Number(ns.args[2]);
  const pwHint = String(ns.args[3]);
  const data = String(ns.args[4]);

  // 2. ServerAuthDetails-Objekt für die Framework-Kompatibilität rekonstruieren
  const details: ServerAuthDetails = {
    isConnectedToCurrentServer: true,
    hasSession: false,
    modelId: modelId,
    passwordLength: pwLen,
    passwordHint: pwHint,
    data: data,
    logTrafficInterval: 60,
    passwordFormat: "numeric", // Standard-Fallback
  };

  ns.print(`🔨 Krypto-Angriff auf ${host} [${modelId}] gestartet...`);

  // --- SPRINT 1: SCHNELLE VORAB-ANGRIFFE ---
  // Wenn ein schneller Angriff fruchtet, sparen wir uns die schweren Algorithmen
  if (await dictionaryAttack(ns, host, details)) {
    await handleSuccess(ns, host);
    return;
  }
  if (await fileLootAttack(ns, host, details)) {
    await handleSuccess(ns, host);
    return;
  }

  // --- SPRINT 2: MODULARE MODELL-WEICHE ---
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
      const passCloud = await solveCloudBlare(ns, details);
      if (passCloud) {
        const resCloud = await ns.dnet.authenticate(host, passCloud);
        if (resCloud.success) correctPassword = passCloud;
      }
      break;

    case "ZeroLogon":
      // ZeroLogon benötigt keinen komplexen Solver, da das Passwort immer leer ist
      const resZero = await ns.dnet.authenticate(host, "");
      if (resZero.success) correctPassword = "";
      break;

    case "FreshInstall_1.0":
      correctPassword = await solveFreshInstall(ns, host, details);
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
      // Delegiere die schwere Arbeit an das spezialisierte Sub-Modul
      correctPassword = await solveFactoriOs(ns, host, details);
      break;

    default:
      ns.tprint(
        `⚠️ Unbekanntes Server-Modell: ${details.modelId}. Versuche generischen Notfall-Knick...`,
      );
      // Generischer Fallback für unidentifizierte numerische Server
      correctPassword = await solveAccountsManager(ns, host, details);
      break;
  }

  // --- SPRINT 3: AUSWERTUNG & LOOT ---
  if (correctPassword !== null) {
    // 🔥 FIX: Das gefundene Passwort MUSS in die passwords.txt geschrieben werden!
    updatePasswordFile(ns, correctPassword);
    await handleSuccess(ns, host);
  } else {
    ns.print(
      `❌ [FAILED] Konnte Verschlüsselung von ${host} mit keinem Sub-Modul brechen.`,
    );
  }
}

// ============================================================================
// HILFSFUNKTIONEN FÜR DIE VORAB-ANGRIFFE & POST-LOOT-AUTOMATION
// ============================================================================

/**
 * Führt nach einem erfolgreichen Hack die Post-Exploitation-Loot-Routine aus.
 */
async function handleSuccess(ns: NS, host: string): Promise<void> {
  ns.print(`🎉 [OK] Session für ${host} erfolgreich etabliert.`);
  // Startet deine vollautomatische Daten- und Passwort-Absaugung auf dem Zielserver
  await lootServer(ns, host);
}

/**
 * Standard Dictionary Attack gegen bekannte Passwörter.
 */
async function dictionaryAttack(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
): Promise<boolean> {
  if (!ns.fileExists("passwords.txt", "home")) return false;

  // Nutzt ein Set, um Duplikate zu entfernen, erlaubt aber den leeren String ""
  const list = [
    ...new Set(
      ns
        .read("passwords.txt")
        .split(/[\r\n,]+/)
        .map((p) => p.trim()),
    ),
  ];

  for (const pw of list) {
    if (details.passwordLength && pw.length > details.passwordLength) continue;
    if ((await ns.dnet.authenticate(host, pw)).success) return true;
  }
  return false;
}

/**
 * Durchsucht lokale Textdateien des Zielsystems nach unverschlüsselten Passwörtern.
 */
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
        if ((await ns.dnet.authenticate(host, content)).success) return true;
      }
    }
  } catch {}
  return false;
}

/**
 * Aktualisiert deine zentrale Passwort-Datenbank auf dem Home-Server.
 */
function updatePasswordFile(ns: NS, newPw: string): void {
  const file = "passwords.txt";
  const pws = new Set<string>();

  if (ns.fileExists(file, "home")) {
    ns.read(file)
      .split(/[\n,]+/)
      .forEach((p) => p.trim() && pws.add(p.trim()));
  }

  if (!pws.has(newPw)) {
    ns.write(file, `\n${newPw}`, "a");
  }
}

/**
 * Plündert verschlüsselte Cache-Dateien des infizierten Systems via Phishing.
 */
async function lootServer(ns: NS, targetHost: string): Promise<void> {
  if (targetHost === "home") return;

  // Wartet, bis die Social-Engineering-Kampagne durchgelaufen ist
  await ns.dnet.phishingAttack();

  // Alle gecachten Credentials einsammeln
  const files = ns.ls(targetHost, ".cache");

  for (const file of files) {
    try {
      const result = ns.dnet.openCache(file) as any;
      if (result && result.success) {
        const potentialPw = result.data || result.message;
        if (typeof potentialPw === "string") {
          const cleanPw = potentialPw.includes(":")
            ? potentialPw.split(":").pop()?.trim()
            : potentialPw.trim();

          if (cleanPw) {
            updatePasswordFile(ns, cleanPw);
          }
        }
        ns.rm(file, targetHost);
      }
    } catch (e) {}
  }
}
