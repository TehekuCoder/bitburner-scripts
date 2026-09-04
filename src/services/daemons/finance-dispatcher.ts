import { NS } from "@ns";
import { PATHS } from "/infrastructure/runtime/paths.js";
import {
  hasGang,
  hasSleeve,
  hasSingularity,
  loadBnMults,
  hasCorporation,
  formatRam,
} from "/lib/utils.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🚀 Finance-Manager (Sequenzieller Dispatcher) gestartet.");

  // Helper: Führt ein Skript aus und wartet auf dessen Beendigung
  const runAndWait = async (scriptPath: string): Promise<boolean> => {
    if (!ns.fileExists(scriptPath, "home")) return false;

    const reqRam = ns.getScriptRam(scriptPath, "home");
    const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");

    // Falls nicht genug freier RAM da ist, überspringen
    if (freeRam < reqRam) {
      ns.print(
        `[FINANCE-MGR] ⚠️ Übersprungen: ${scriptPath} (Benötigt: ${formatRam(reqRam)}, Frei: ${formatRam(freeRam)})`,
      );
      return false;
    }

    try {
      const pid = ns.run(scriptPath, 1);
      if (pid > 0) {
        while (ns.isRunning(pid)) {
          await ns.sleep(50);
        }
        return true;
      }
    } catch (err) {
      ns.print(
        `[FINANCE-MGR] ❌ Fehler beim Ausführen von ${scriptPath}: ${err}`,
      );
    }
    return false;
  };

  while (true) {
    const bnMults = loadBnMults(ns);

    // 0. Finance-Core als Dauerläufer (UI & Kauf-Abwicklung)
    if (
      ns.fileExists(PATHS.app.orchestration.financeCore, "home") &&
      !ns.isRunning(PATHS.app.orchestration.financeCore, "home")
    ) {
      const coreRam = ns.getScriptRam(
        PATHS.app.orchestration.financeCore,
        "home",
      );
      const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
      if (freeRam >= coreRam) {
        ns.run(PATHS.app.orchestration.financeCore, 1);
      }
    }

    // 1. Purchased Servers (cloud.js - ~6.05 GB)
    const CloudLimit = ns.cloud?.getServerLimit() ?? 0;
    const CloudMult = bnMults.CloudServerLimit ?? 1.0;
    if (CloudLimit > 0 && CloudMult > 0) {
      await runAndWait(PATHS.domain.evaluators.purchase.cloud);
    }

    // 2. Hacknet (hacknet.js - ~9.85 GB)
    if ((bnMults.HacknetNodeMoney ?? 1.0) > 0) {
      await runAndWait(PATHS.domain.evaluators.purchase.hacknet);
    }

    // 3. Singularity Evaluatoren
    if (hasSingularity(ns)) {
      await runAndWait(PATHS.domain.evaluators.purchase.home); // home.js (~9.65 GB)
      await runAndWait(PATHS.domain.evaluators.purchase.programs); // programs.js (~5.55 GB)

      // Player-Augmentations evaluieren (Prüfung auf freien RAM erfolgt dynamisch)
      await runAndWait(PATHS.domain.evaluators.purchase.player); // player.js (~28.10 GB)
    }

    // 4. Gang (gang.js - ~13.60 GB)
    if (
      hasGang(ns) &&
      (bnMults.GangUniqueAugs ?? 1.0) > 0 &&
      ns.isRunning(PATHS.services.managers.gang)
    ) {
      await runAndWait(PATHS.domain.evaluators.purchase.gang);
    }

    // 5. Sleeves (sleeve.js - ~20.50 GB)
    if (hasSleeve(ns) && ns.isRunning(PATHS.services.managers.sleeve)) {
      await runAndWait(PATHS.domain.evaluators.purchase.sleeve);
    }

    // 6. Stock Market (stock.js - ~19.80 GB)
    if (Boolean(ns.stock)) {
      await runAndWait(PATHS.domain.evaluators.purchase.stock);
    }

    // 7. Corporation Evaluator
    if (hasCorporation(ns) && !ns.corporation.hasCorporation()) {
      await runAndWait(PATHS.domain.evaluators.purchase.corporation);
    }

    // Pause zwischen den Evaluations-Zyklen
    await ns.sleep(3000);
  }
}
