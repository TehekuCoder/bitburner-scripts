import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  // 1. Parameter vom Solver auslesen
  const targetHost = ns.args[0] as string;
  const password = ns.args[1] as string;

  // 2. Falls vom Solver aufgerufen, authentifizieren wir diese PID für die Session
  if (targetHost && password !== undefined) {
    const sessionConnected = await ns.dnet.connectToSession(
      targetHost,
      password,
    );
    if (!sessionConnected) {
      ns.tprint(
        `🔴 Loot-Fehler: Konnte Verbindung zur Session auf ${targetHost} nicht herstellen.`,
      );
      return;
    }
  }

  // 3. Flexibler Host-Fallback
  const host = targetHost || ns.getHostname();

  // 4. Phishing-Angriff ausführen
  await ns.dnet.phishingAttack();

  // 5. Cache-Dateien gezielt auf dem Ziel-Host suchen
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
            // Absoluter Pfad im VFS sorgt dafür, dass es im Root landet
            ns.write("/passwords.txt", `\n${cleanPw}`, "a");
          }
        }
        // Datei vom Ziel-Host löschen, um dort aufzuräumen
        ns.rm(file, host);
      }
    } catch (e) {
      ns.tprint(`⚠️ Fehler beim Verarbeiten von ${file} auf ${host}: ${e}`);
    }
  }
}
