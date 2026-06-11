import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const target = "home";

  ns.disableLog("ALL");
  ns.ui.openTail();

  // Alle potenziellen Filler-Skripte für die Aufräum-Logik definieren
  const fillerScripts = ["share.js", "tasks/weaken-xp.js"];

  while (true) {
    // 1. DYNAMISCHE SKRIPT-WAHL BASIEREND AUF PLAYER-STATUS
    const p = ns.getPlayer();
    let activeScript = "share.js";

    if (p.skills.hacking < 250) {
      activeScript = "tasks/weaken-xp.js"; // Schnelles XP-Skript für JoesGuns
    }

    // --- ANTI-LEAK-CLEANUP ---
    // Falls das jeweils ANDERE Skript noch läuft (z.B. gerade Level 250 erreicht), killen wir es sofort!
    for (const fScript of fillerScripts) {
      if (fScript !== activeScript && ns.isRunning(fScript, target)) {
        ns.print(
          `[CLEANUP] Strategiewechsel erkannt! Beende altes Filler-Skript: ${fScript}`,
        );
        ns.kill(fScript, target);
      }
    }

    const maxRam = ns.getServerMaxRam(target);
    const usedRam = ns.getServerUsedRam(target);
    const scriptRam = ns.getScriptRam(activeScript);

    // 2. DYNAMISCHE PRIORITÄTS-RESERVE
    let reserve = 32;
    if (ns.isRunning("core/sys-batcher.js", "home")) {
      // Dem Batcher 50% oder mindestens 128GB freihalten
      reserve = Math.max(maxRam * 0.5, 128);
    }

    // Aktuelle Threads des AKTIVEN Filler-Skripts ermitteln
    const fillerProc = ns.ps(target).find((p) => p.filename === activeScript);
    const currentThreads = fillerProc ? fillerProc.threads : 0;

    // Verfügbaren RAM präzise berechnen
    const availableRam =
      maxRam - (usedRam - currentThreads * scriptRam) - reserve;
    let targetThreads = Math.floor(availableRam / scriptRam);
    if (targetThreads < 0) targetThreads = 0;

    // 3. ANPASSUNGS-LOGIK (Nur bei signifikanter Änderung)
    const threadDiff = Math.abs(targetThreads - currentThreads);

    // Skalierungsschwellen
    const shouldScaleDown = targetThreads < currentThreads;
    const shouldScaleUp =
      targetThreads > currentThreads && threadDiff > currentThreads * 0.1;

    if (
      targetThreads !== currentThreads &&
      (shouldScaleDown || shouldScaleUp || currentThreads === 0)
    ) {
      // Erst die alte Instanz des aktiven Skripts killen
      if (currentThreads > 0) {
        ns.kill(activeScript, target); // BEHOBEN: Modernes ns.kill verwendet
      }

      // Neu allozieren mit angepasster Stärke
      if (targetThreads > 0) {
        ns.print(
          `[RESOURCE] Allocate lowest priority: ${targetThreads} Threads of ${activeScript} (Reserve: ${reserve}GB)`,
        );

        if (activeScript.includes("weaken")) {
          // WICHTIG: 0 und Math.random() als zusätzliche Argumente verhindern,
          // dass Netscript denkt, es sei exakt dasselbe Skript wie ein regulärer Worker.
          ns.exec(
            activeScript,
            target,
            targetThreads,
            "joesguns",
            0,
            Math.random(),
          );
        } else {
          ns.exec(activeScript, target, targetThreads);
        }
      }
    }

    // Da Filler die niedrigste Prio haben, reicht ein entspannter 10-Sekunden-Takt
    await ns.sleep(10000);
  }
}
