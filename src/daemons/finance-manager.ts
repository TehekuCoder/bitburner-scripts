// managers/finance-manager.ts

import { NS } from "@ns";
import { PATHS } from "/lib/paths.js";
import { 
  hasGang, 
  hasSleeve, 
  hasSingularity 
} from "/lib/utils.js";

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
    // 0. Zentrale Finance-Core starten
    tryLaunch(PATHS.core.financeCore);

    // 1. Basis-Evaluatoren starten (brauchen keine speziellen APIs)
    tryLaunch(PATHS.lib.evaluators.home);
    tryLaunch(PATHS.lib.evaluators.hacknet);
    tryLaunch(PATHS.lib.evaluators.stock);
    tryLaunch(PATHS.lib.evaluators.pserv);
    tryLaunch(PATHS.lib.evaluators.programs);

    // 2. Bedingte Evaluatoren starten (Sparen extrem viel RAM im Early-Node!)
    if (hasGang(ns)) {
      tryLaunch(PATHS.lib.evaluators.gang);
    }
    if (hasSleeve(ns)) {
      tryLaunch(PATHS.lib.evaluators.sleeve);
    }
    if (hasSingularity(ns)) {
      tryLaunch(PATHS.lib.evaluators.player);
    }

    // Warte 2 Sekunden, bevor die nächste Runde getriggert wird
    await ns.sleep(2000);
  }
}
