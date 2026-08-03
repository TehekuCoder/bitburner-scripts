import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const currentHost = ns.getHostname();
  
  ns.tprint(`🏴‍☠️ [Darknet Loot] Starte Looting-Prozedur auf ${currentHost}...`);

  // 1. .cache Dateien finden und öffnen
  const cacheFiles = ns.ls(currentHost, ".cache");
  if (cacheFiles.length > 0) {
    ns.tprint(`📦 ${cacheFiles.length} .cache Datei(en) gefunden. Öffne Cache...`);
    for (const file of cacheFiles) {
      try {
        ns.dnet.openCache(file);
        ns.tprint(`   🟢 Erfolgreich geöffnet: ${file}`);
      } catch (e) {
        ns.tprint(`   🔴 Fehler beim Öffnen von ${file}`);
      }
    }
  } else {
    ns.tprint("ℹ️ Keine .cache Dateien auf diesem Server vorhanden.");
  }

  // 2. Phishing-Attacken ausführen
  ns.tprint("🎣 Führe Phishing-Angriffe durch...");
  for (let i = 0; i < 5; i++) {
    try {
      ns.dnet.phishingAttack();
      await ns.sleep(300);
    } catch {
      ns.tprint("⚠️ Phishing-Angriff fehlgeschlagen oder nicht verfügbar.");
      break;
    }
  }

  ns.tprint(`✅ [Darknet Loot] Looting auf ${currentHost} abgeschlossen.`);
}