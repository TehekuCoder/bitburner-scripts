import { NS } from "@ns";
import { PATHS } from "/lib/paths.js";
import { hasGang, hasSleeve, hasSingularity, loadBnMults } from "/lib/utils.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🚀 Finance-Manager (Sequenzieller Dispatcher) gestartet.");

  // Helper: Führt ein Skript aus und wartet auf dessen Beendigung
  const runAndWait = async (scriptPath: string): Promise<void> => {
    if (!ns.fileExists(scriptPath, "home")) return;

    const reqRam = ns.getScriptRam(scriptPath, "home");
    const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");

    // Falls nicht genug freier RAM da ist, überspringen
    if (freeRam < reqRam) {
      ns.print(
        `[FINANCE-MGR] Nicht genug RAM für ${scriptPath} (Benötigt: ${reqRam}GB, Frei: ${freeRam.toFixed(1)}GB)`,
      );
      return;
    }

    const pid = ns.run(scriptPath, 1);
    if (pid > 0) {
      while (ns.isRunning(pid)) {
        await ns.sleep(20);
      }
    }
  };

  while (true) {
    const homeMaxRam = ns.getServerMaxRam("home");
    const bnMults = loadBnMults(ns);

    // 0. Finance-Core als Dauerläufer (UI & Kauf-Abwicklung)
    if (
      ns.fileExists(PATHS.core.financeCore, "home") &&
      !ns.isRunning(PATHS.core.financeCore, "home")
    ) {
      ns.run(PATHS.core.financeCore, 1);
    }

    // 1. Purchased Servers (cloud.js - ~6.05 GB)
    const pservLimit = ns.cloud?.getServerLimit() ?? 0;
    const pservMult = bnMults.CloudServerLimit ?? 1.0;
    if (pservLimit > 0 && pservMult > 0) {
      await runAndWait(PATHS.lib.evaluators.purchase.cloud);
    }

    // 2. Hacknet (hacknet.js - ~9.85 GB)
    if ((bnMults.HacknetNodeMoney ?? 1.0) > 0) {
      await runAndWait(PATHS.lib.evaluators.purchase.hacknet);
    }

    // 3. Singularity Evaluatoren
    if (hasSingularity(ns)) {
      await runAndWait(PATHS.lib.evaluators.purchase.home); // home.js (~9.65 GB)
      await runAndWait(PATHS.lib.evaluators.purchase.programs); // programs.js (~5.55 GB)

      // Player-Augmentations nur evaluieren, wenn ausreichend Home-RAM vorhanden ist
      if (homeMaxRam >= 64) {
        await runAndWait(PATHS.lib.evaluators.purchase.player); // player.js (~28.10 GB)
      }
    }

    // 4. Gang (gang.js - ~13.60 GB)
    if (
      hasGang(ns) &&
      (bnMults.GangUniqueAugs ?? 1.0) > 0 &&
      ns.isRunning(PATHS.managers.gang)
    ) {
      await runAndWait(PATHS.lib.evaluators.purchase.gang);
    }

    // 5. Sleeves (sleeve.js - ~20.50 GB)
    if (hasSleeve(ns) && ns.isRunning(PATHS.managers.sleeve)) {
      await runAndWait(PATHS.lib.evaluators.purchase.sleeve);
    }

    // 6. Stock Market (stock.js - ~19.80 GB)
    if (Boolean(ns.stock)) {
      await runAndWait(PATHS.lib.evaluators.purchase.stock);
    }

    // Pause zwischen den Evaluations-Zyklen
    await ns.sleep(3000);
  }
}
