// daemons/finance-manager.ts

import { NS } from "@ns";
import { PATHS } from "/lib/paths.js";
import { hasGang, hasSleeve, hasSingularity } from "/lib/utils.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🚀 Finance-Manager (Dispatcher) gestartet.");

  const tryLaunch = (scriptPath: string): void => {
    if (!ns.fileExists(scriptPath, "home")) {
      ns.print(`[FINANCE-MGR] Script nicht gefunden: ${scriptPath}`);
      return;
    }
    if (ns.isRunning(scriptPath, "home")) return;

    const pid = ns.run(scriptPath, 1);
    if (pid > 0) {
      ns.print(`[FINANCE-MGR] Gestartet: ${scriptPath} (pid ${pid})`);
    } else {
      ns.print(`[FINANCE-MGR] Start fehlgeschlagen: ${scriptPath}`);
    }
  };

  while (true) {
    const homeMaxRam = ns.getServerMaxRam("home");

    // 0. Zentrale Finance-Core starten
    tryLaunch(PATHS.core.financeCore);

    // 1. Basis-Evaluatoren starten (brauchen keine speziellen APIs)
    tryLaunch(PATHS.lib.evaluators.pserv);
    tryLaunch(PATHS.lib.evaluators.hacknet);

    // 2. Bedingte Evaluatoren starten (Singularity / RAM-Thresholds)
    if (hasSingularity(ns)) {
      tryLaunch(PATHS.lib.evaluators.home);
      tryLaunch(PATHS.lib.evaluators.programs);
      if (homeMaxRam >= 512) {
        tryLaunch(PATHS.lib.evaluators.player);
      }
    }

    if (hasGang(ns) && ns.isRunning(PATHS.managers.gang)) {
      tryLaunch(PATHS.lib.evaluators.gang);
    }

    if (hasSleeve(ns) && ns.isRunning(PATHS.managers.sleeve)) {
      tryLaunch(PATHS.lib.evaluators.sleeve);
    }

    // 3. Stock-Evaluator starten, sobald ns.stock technisch verfügbar ist
    // (Der Evaluator selbst entscheidet dann, ob er Lizenzen kauft oder Aktien handelt)
    if (Boolean(ns.stock)) {
      tryLaunch(PATHS.lib.evaluators.stock);
    }

    // Warte 2 Sekunden bis zum nächsten Check
    await ns.sleep(2000);
  }
}