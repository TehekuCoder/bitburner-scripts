import { NS } from "@ns";
import { PAYLOADS } from "/lib/constants";



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