import { NS } from "@ns";

// 📦 DEFINITION DER KERN-WORKER (utils/provision.ts)
const PAYLOADS = [
  "tasks/hack.js",
  "tasks/grow.js",
  "tasks/weaken.js",
  "tasks/share.js",
  "tasks/work.js",       // WICHTIG: Haupt-Worker hinzugefügt!
  "tasks/xp-grind.js"    // WICHTIG: XP-Farmer hinzugefügt!
];

/**
 * Kopiert alle benötigten Worker-Skripte auf den Zielserver, falls sie fehlen.
 * @param ns NS API Objekt
 * @param serverName Der Zielserver (z.B. "p-serv-01" oder "n00dles")
 */
export async function provisionServer(ns: NS, serverName: string): Promise<void> {
  // Home braucht keine Kopien seiner eigenen Dateien
  if (serverName === "home") return;

  const missingFiles = PAYLOADS.filter(file => !ns.fileExists(file, serverName));
  
  if (missingFiles.length > 0) {
    await ns.scp(missingFiles, serverName, "home");
    // Optional: Log ausgeben, wenn das aufrufende Skript das wünscht
    // ns.print(`[PROVISION] 📦 Worker-Payloads auf ${serverName} installiert.`);
  }
}