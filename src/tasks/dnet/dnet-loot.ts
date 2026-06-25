import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const currentHost = ns.getHostname();

  if (currentHost === "home") return;

  const files = ns.ls(currentHost, ".cache");
  if (files.length > 0) {
    ns.print(`💰 ${files.length} Cache-Dateien gefunden. Verarbeite...`);
  }

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
            ns.write("/passwords.txt", `\n${cleanPw}`, "a");
            ns.writePort(5, `${currentHost}:${cleanPw}`);
          }
        }
        ns.rm(file, currentHost);
      }
    } catch (e) {
      ns.print(`⚠️ Fehler beim Looten von ${file}: ${e}`);
    }
  }
}