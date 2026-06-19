import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const targetHost = ns.args[0] as string;
  const password = ns.args[1] as string;

  if (targetHost && password !== undefined) {
    const sessionConnected = await ns.dnet.connectToSession(targetHost, password);
    if (!sessionConnected) {
      ns.print(`🔴 Loot-Fehler: Keine Session auf ${targetHost}.`);
      return;
    }
  }

  const host = targetHost || ns.getHostname();

  // Social Engineering triggern
  await ns.dnet.phishingAttack();

  const files = ns.ls(host, ".cache");

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
            // 1. Lokal sichern
            ns.write("/passwords.txt", `\n${cleanPw}`, "a");
            // 2. 🔥 NEU: Global an den Master funken, falls es ein Serverpasswort war!
            ns.writePort(5, `${host}:${cleanPw}`);
          }
        }
        ns.rm(file, host);
      }
    } catch (e) {
      ns.print(`⚠️ Fehler beim Looten von ${file} auf ${host}: ${e}`);
    }
  }
}