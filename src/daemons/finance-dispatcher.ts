import { NS } from "@ns";
import { PATHS } from "/lib/paths.js";
import { hasGang, hasSleeve, hasSingularity, loadBnMults } from "/lib/utils.js";

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
    const bnMults = loadBnMults(ns);

    // 0. Zentrale Finance-Core starten
    tryLaunch(PATHS.core.financeCore);

    // 1. PServ nur starten, wenn das Server-Limit > 0 ist (z. B. deaktiviert in BN9)
    const pservLimit = ns.cloud?.getServerLimit() ?? 0;
    const pservMult = bnMults.CloudServerLimit ?? 1.0;
    if (pservLimit > 0 && pservMult > 0) {
      tryLaunch(PATHS.lib.evaluators.purchase.cloud);
    }

    // 2. Hacknet Evaluator (sofern nicht durch BN-Mult totgeschaltet)
    if ((bnMults.HacknetNodeMoney ?? 1.0) > 0) {
      tryLaunch(PATHS.lib.evaluators.purchase.hacknet);
    }

    // 3. Bedingte Evaluatoren starten (Singularity / RAM-Thresholds)
    if (hasSingularity(ns)) {
      tryLaunch(PATHS.lib.evaluators.purchase.home);
      tryLaunch(PATHS.lib.evaluators.purchase.programs);
      if (homeMaxRam >= 512) {
        tryLaunch(PATHS.lib.evaluators.purchase.player);
      }
    }

    if (hasGang(ns) && (bnMults.GangUniqueAugs ?? 1.0) > 0 && ns.isRunning(PATHS.managers.gang)) {
      tryLaunch(PATHS.lib.evaluators.purchase.gang);
    }

    if (hasSleeve(ns) && ns.isRunning(PATHS.managers.sleeve)) {
      tryLaunch(PATHS.lib.evaluators.purchase.sleeve);
    }

    // 4. Stock-Evaluator
    if (Boolean(ns.stock)) {
      tryLaunch(PATHS.lib.evaluators.purchase.stock);
    }

    await ns.sleep(2000);
  }
}