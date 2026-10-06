import { NS, ProgramName, FactionName } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, async () => {
    if (!ns.singularity) return false;
    const action = String(ns.args[0] ?? "");

    switch (action) {
      case "home-upgrade-ram":
        return ns.singularity.upgradeHomeRam();

      case "home-upgrade-cores":
        return ns.singularity.upgradeHomeCores();

      case "program-purchase-tor":
        return ns.singularity.purchaseTor();

      case "program-purchase": {
        const prog = String(ns.args[1] ?? "") as ProgramName;
        return prog ? ns.singularity.purchaseProgram(prog) : false;
      }

      case "player-purchase-aug": {
        const faction = String(ns.args[1] ?? "") as FactionName;
        const aug = String(ns.args[2] ?? "");
        return faction && aug
          ? ns.singularity.purchaseAugmentation(faction, aug)
          : false;
      }

      case "player-purchase-aug-batch": {
        const batch = JSON.parse(String(ns.args[1] ?? "[]")) as {
          faction: FactionName;
          name: string;
        }[];
        if (!Array.isArray(batch) || batch.length === 0) return false;

        const expectedCost = Number(ns.args[2]);
        const hasExpectedCost =
          Number.isFinite(expectedCost) && expectedCost >= 0;
        if (
          hasExpectedCost &&
          ns.getServerMoneyAvailable("home") < expectedCost
        ) {
          ns.tprint("[WARN] Augmentations-Batch abgebrochen: Zu wenig Geld.");
          return false;
        }

        for (const item of batch) {
          if (!item.faction || !item.name) return false;

          if (!hasExpectedCost) {
            const currentMoney = ns.getServerMoneyAvailable("home");
            const currentPrice = ns.singularity.getAugmentationPrice(item.name);
            if (currentMoney < currentPrice) {
              ns.tprint(
                `[WARN] Batch abgebrochen für ${item.name}: Zu wenig Geld.`,
              );
              return false;
            }
          }

          if (
            !ns.singularity.purchaseAugmentation(item.faction, item.name)
          ) {
            ns.tprint(`[ERROR] Kauf fehlgeschlagen für: ${item.name}`);
            return false;
          }
          ns.print(`[SUCCESS] Gekauft: ${item.name}`);
        }
        return true;
      }

      case "player-purchase-nfg": {
        const faction = String(ns.args[1] ?? "") as FactionName;
        const maximumPrice = Number(ns.args[2] ?? 0);
        if (!faction || !Number.isFinite(maximumPrice) || maximumPrice <= 0) {
          return false;
        }
        const currentPrice = ns.singularity.getAugmentationPrice(
          "NeuroFlux Governor",
        );
        if (
          currentPrice > maximumPrice ||
          ns.getServerMoneyAvailable("home") < currentPrice
        ) {
          return false;
        }
        return ns.singularity.purchaseAugmentation(
          faction,
          "NeuroFlux Governor",
        );
      }

      case "player-install-augs": {
        const startScript = (ns.args[1] as string) || "init.js";
        ns.singularity.installAugmentations(startScript);
        return false;
      }

      default:
        return false;
    }
  });
}
