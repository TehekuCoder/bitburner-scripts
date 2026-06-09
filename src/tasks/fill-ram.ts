import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const target = "home";

  ns.disableLog("ALL");
  ns.ui.openTail();

  while (true) {
    // 1. DYNAMISCHE SKRIPT-WAHL BASIEREND AUF PLAYER-STATUS
    const p = ns.getPlayer();
    let script = "share.js";

    if (p.skills.hacking < 250) {
      script = "tasks/weaken-xp.js"; // Separates, schnelles XP-Skript für JoesGuns
    }

    const maxRam = ns.getServerMaxRam(target);
    const usedRam = ns.getServerUsedRam(target);
    const scriptRam = ns.getScriptRam(script);

    // 2. DYNAMISCHE PRIORITÄTS-RESERVE
    // Wenn der High-End Batcher läuft, MUSS home eine riesige Reserve behalten.
    // Läuft er nicht, reichen die standardmäßigen 32GB für den Kernel/Dispatcher.
    let reserve = 32;
    if (ns.isRunning("core/sys-batcher.js", "home")) {
      // Wenn der Batcher aktiv ist, lassen wir ihm absichtlich 50% des Home-RAMs
      // oder mindestens 128GB frei, damit er seine Wellen ungehindert planen kann!
      reserve = Math.max(maxRam * 0.5, 128);
    }

    // Aktuelle Threads dieses spezifischen Filler-Skripts ermitteln
    const fillerProc = ns.ps(target).find((p) => p.filename === script);
    const currentThreads = fillerProc ? fillerProc.threads : 0;

    // Verfügbaren RAM berechnen
    const availableRam =
      maxRam - (usedRam - currentThreads * scriptRam) - reserve;
    let targetThreads = Math.floor(availableRam / scriptRam);
    if (targetThreads < 0) targetThreads = 0;

    // 3. ANPASSUNGS-LOGIK (Nur bei signifikanter Änderung)
    const threadDiff = Math.abs(targetThreads - currentThreads);

    // Wenn wir runterskalieren müssen, tun wir das SOFORT (wichtig für den Batcher!)
    // Wenn wir hochskalieren, warten wir auf eine Änderung von mindestens 10%
    const shouldScaleDown = targetThreads < currentThreads;
    const shouldScaleUp =
      targetThreads > currentThreads && threadDiff > currentThreads * 0.1;

    if (
      targetThreads !== currentThreads &&
      (shouldScaleDown || shouldScaleUp || currentThreads === 0)
    ) {
      // Erst alle alten Instanzen dieses Filler-Skripts killen
      if (currentThreads > 0) {
        ns.scriptKill(script, target);
      }

      // Neu allozieren
      if (targetThreads > 0) {
        ns.print(
          `[RESOURCE] Allocate lowest priority: ${targetThreads} Threads of ${script} (Reserve: ${reserve}GB)`,
        );

        // Hinweis: Für ein reines XP-Weaken müsste hier das Dummy-Target (z.B. "joesguns") übergeben werden
        if (script.includes("weaken")) {
          ns.exec(script, target, targetThreads, "joesguns", 0, Math.random());
        } else {
          ns.exec(script, target, targetThreads);
        }
      }
    }

    // Da Filler die niedrigste Prio haben, reicht ein entspannter 10-Sekunden-Takt
    await ns.sleep(10000);
  }
}
