import { NS } from "@ns";
import { PATHS } from "/infrastructure/runtime/paths.js";
import {
  hasGang,
  hasSleeve,
  hasSingularity,
  loadBnMults,
  hasCorporation,
  formatRam,
  isCorporationViable,
  isStockViable,
} from "/lib/utils.js";
import {
  loadFinanceState,
  loadState,
  patchFinanceState,
} from "/infrastructure/state/state.js";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import {
  shouldPrepareBn8GraftingCapacity,
  shouldPrepareBn8SleeveCapacity,
  shouldUnlockBn8SleeveAugPurchases,
} from "/app/orchestration/finance-runtime.js";
import { hasBothFourSigmaLicenses } from "/domain/evaluators/purchase/bn8-augmentation.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new LoggerClient(ns, "FINANCE-DISPATCHER", undefined, "INFO");
  const missingScriptsWarned = new Set<string>();
  const ramWarnings = new Set<string>();
  const startFailures = new Set<string>();
  let financeCoreWarningActive = false;

  const warnOnce = (
    warnings: Set<string>,
    key: string,
    message: string,
    context: Record<string, string | number | boolean | null | undefined>,
  ): void => {
    if (warnings.has(key)) return;
    warnings.add(key);
    logger.warn(message, undefined, { context });
  };

  logger.info("Finance-Dispatcher gestartet.");
  ns.print("🚀 Finance-Manager (Sequenzieller Dispatcher) gestartet.");

  // Helper: Führt ein Skript aus und wartet auf dessen Beendigung
  const runAndWait = async (scriptPath: string): Promise<boolean> => {
    if (!ns.fileExists(scriptPath, "home")) {
      warnOnce(missingScriptsWarned, scriptPath, "Finance-Evaluator nicht gefunden.", {
        scriptPath,
      });
      return false;
    }
    missingScriptsWarned.delete(scriptPath);

    const reqRam = ns.getScriptRam(scriptPath, "home");
    const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");

    // Falls nicht genug freier RAM da ist, überspringen
    if (freeRam < reqRam) {
      warnOnce(ramWarnings, scriptPath, "Finance-Evaluator wegen RAM-Mangel übersprungen.", {
        scriptPath,
        requiredRam: reqRam,
        freeRam,
      });
      ns.print(
        `[FINANCE-MGR] ⚠️ Übersprungen: ${scriptPath} (Benötigt: ${formatRam(reqRam)}, Frei: ${formatRam(freeRam)})`,
      );
      return false;
    }
    ramWarnings.delete(scriptPath);

    try {
      const pid = ns.run(scriptPath, 1);
      if (pid > 0) {
        startFailures.delete(scriptPath);
        while (ns.isRunning(pid)) {
          await ns.sleep(50);
        }
        return true;
      }
      warnOnce(startFailures, scriptPath, "Finance-Evaluator konnte nicht gestartet werden.", {
        scriptPath,
      });
    } catch (err) {
      warnOnce(startFailures, scriptPath, "Fehler beim Starten eines Finance-Evaluators.", {
        scriptPath,
        error: String(err),
      });
      ns.print(
        `[FINANCE-MGR] ❌ Fehler beim Ausführen von ${scriptPath}: ${err}`,
      );
    }
    return false;
  };

  while (true) {
    const bnMults = loadBnMults(ns);
    const isBitNode8 = ns.getResetInfo().currentNode === 8;
    if (
      !isBitNode8 &&
      loadFinanceState(ns)?.bn8SleeveAugPurchasesUnlocked === true
    ) {
      await patchFinanceState(ns, {
        bn8SleeveAugPurchasesUnlocked: false,
      });
    }

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
        const pid = ns.run(PATHS.app.orchestration.financeCore, 1);
        if (pid > 0) {
          financeCoreWarningActive = false;
          logger.info("Finance-Core gestartet.", undefined, {
            context: { pid },
          });
        } else if (!financeCoreWarningActive) {
          financeCoreWarningActive = true;
          logger.warn("Finance-Core konnte nicht gestartet werden.", undefined, {
            context: { requiredRam: coreRam, freeRam },
          });
        }
      } else if (!financeCoreWarningActive) {
        financeCoreWarningActive = true;
        logger.warn("Finance-Core wegen RAM-Mangel nicht gestartet.", undefined, {
          context: { requiredRam: coreRam, freeRam },
        });
      }
    } else {
      financeCoreWarningActive = false;
    }

    if (isBitNode8) {
      const resetInfo = ns.getResetInfo();
      const hasFourSigmaLicenses = hasBothFourSigmaLicenses(ns);
      let financeState = loadFinanceState(ns);
      const sleeveAugPurchasesUnlocked =
        financeState?.bn8SleeveAugPurchasesUnlocked === true;
      if (
        shouldUnlockBn8SleeveAugPurchases(
          resetInfo.currentNode,
          hasFourSigmaLicenses,
          hasSleeve(ns),
          ns.getServerMoneyAvailable("home"),
          sleeveAugPurchasesUnlocked,
        ) &&
        !sleeveAugPurchasesUnlocked
      ) {
        await patchFinanceState(ns, {
          bn8SleeveAugPurchasesUnlocked: true,
        });
        financeState = loadFinanceState(ns);
        logger.info("BN8-Sleeve-Augmentations ab 100T freigeschaltet.");
      }

      const graftingManager = PATHS.services.managers.bn8Grafting;
      const graftingManagerRam = ns.getScriptRam(graftingManager, "home");
      const freeHomeRam =
        ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
      const prepareGraftingCapacity = shouldPrepareBn8GraftingCapacity(
        resetInfo.currentNode,
        resetInfo.ownedSF.get(10) ?? 0,
        Boolean(ns.stock?.has4SDataTixApi()),
        ns.isRunning(graftingManager, "home"),
        graftingManagerRam,
        freeHomeRam,
      );
      if (prepareGraftingCapacity) {
        await runAndWait(PATHS.domain.evaluators.purchase.home);
      }
      if (
        financeState?.bn8SleeveAugPurchasesUnlocked &&
        hasFourSigmaLicenses &&
        hasSleeve(ns)
      ) {
        const sleeveEvaluator = PATHS.domain.evaluators.purchase.sleeve;
        const sleeveEvaluatorRam = ns.getScriptRam(sleeveEvaluator, "home");
        const freeRam =
          ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
        if (
          shouldPrepareBn8SleeveCapacity(
            resetInfo.currentNode,
            hasFourSigmaLicenses,
            true,
            hasSleeve(ns),
            ns.isRunning(sleeveEvaluator, "home"),
            sleeveEvaluatorRam,
            freeRam,
          )
        ) {
          await runAndWait(PATHS.domain.evaluators.purchase.home);
        }
        await runAndWait(sleeveEvaluator);
      }
      if (isStockViable(ns)) {
        await runAndWait(PATHS.domain.evaluators.purchase.stock);
      }
      await ns.sleep(1000);
      continue;
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

    // 6. Stock Market
    if (isStockViable(ns)) {
      await runAndWait(PATHS.domain.evaluators.purchase.stock);
    }

    // 7. Corporation Evaluator
    if (
      hasCorporation(ns) &&
      !ns.corporation.hasCorporation() &&
      isCorporationViable(ns) &&
      !loadState(ns)?.disabledModules?.some(
        (module) => module === "corporation" || module === "corp",
      )
    ) {
      await runAndWait(PATHS.domain.evaluators.purchase.corporation);
    }
    // Pause zwischen den Evaluations-Zyklen
    await ns.sleep(3000);
  }
}
