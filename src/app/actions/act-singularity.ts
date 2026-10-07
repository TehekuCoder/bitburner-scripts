import { NS, ProgramName, FactionName } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";
import { AUG_PRICE_MULT } from "/shared/constants/game-defaults.js";

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
        const maximumPrice = Number(ns.args[3]);
        if (
          !faction ||
          !aug ||
          !ns.getPlayer().factions.includes(faction) ||
          !Number.isFinite(maximumPrice) ||
          maximumPrice <= 0 ||
          ns.singularity.getAugmentationPrice(aug) > maximumPrice ||
          ns.getServerMoneyAvailable("home") <
            ns.singularity.getAugmentationPrice(aug) ||
          !ns.singularity
            .getAugmentationPrereq(aug)
            .every((prereq) =>
              ns.singularity.getOwnedAugmentations(true).includes(prereq),
            )
        ) {
          ns.tprint(
            `[WARN] Augmentations-Kauf abgebrochen: Voraussetzungen für ${aug || "unbekannt"} haben sich geändert.`,
          );
          return false;
        }
        return ns.singularity.purchaseAugmentation(faction, aug);
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
        if (!batch.every((item) => item?.faction && item?.name)) {
          ns.tprint("[ERROR] Augmentations-Batch enthält ungültige Einträge.");
          return false;
        }

        const availableAugs = new Set(
          ns.singularity.getOwnedAugmentations(true),
        );
        let multiplier = 1;
        let projectedCost = 0;
        for (const item of batch) {
          const prereqs = ns.singularity.getAugmentationPrereq(item.name);
          if (!prereqs.every((prereq) => availableAugs.has(prereq))) {
            ns.tprint(
              `[WARN] Augmentations-Batch abgebrochen: Voraussetzung für ${item.name} fehlt oder ist falsch sortiert.`,
            );
            return false;
          }

          const price = ns.singularity.getAugmentationPrice(item.name);
          if (!Number.isFinite(price) || price <= 0) {
            ns.tprint(
              `[ERROR] Ungültiger aktueller Preis für Augmentation ${item.name}.`,
            );
            return false;
          }
          projectedCost += price * multiplier;
          multiplier *= AUG_PRICE_MULT;
          availableAugs.add(item.name);
        }

        if (
          (hasExpectedCost && projectedCost > expectedCost + 1) ||
          ns.getServerMoneyAvailable("home") < projectedCost
        ) {
          ns.tprint(
            `[WARN] Augmentations-Batch abgebrochen: Benötigt $${ns.format.number(projectedCost)}, Budget $${ns.format.number(hasExpectedCost ? expectedCost : ns.getServerMoneyAvailable("home"))}.`,
          );
          return false;
        }

        for (const item of batch) {
          const currentPrice = ns.singularity.getAugmentationPrice(item.name);
          if (
            ns.getServerMoneyAvailable("home") < currentPrice ||
            !ns.singularity
              .getAugmentationPrereq(item.name)
              .every((prereq) =>
                ns.singularity.getOwnedAugmentations(true).includes(prereq),
              )
          ) {
            ns.tprint(
              `[ERROR] Batch teilweise ausgeführt; Kaufbedingungen für ${item.name} haben sich geändert.`,
            );
            return false;
          }
          if (!ns.singularity.purchaseAugmentation(item.faction, item.name)) {
            ns.tprint(`[ERROR] Kauf fehlgeschlagen für: ${item.name}`);
            return false;
          }
          ns.print(`[SUCCESS] Gekauft: ${item.name}`);
        }
        return true;
      }

      case "player-donate-faction": {
        const faction = String(ns.args[1] ?? "") as FactionName;
        const amount = Number(ns.args[2]);
        if (
          !faction ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          !ns.getPlayer().factions.includes(faction) ||
          ns.getServerMoneyAvailable("home") < amount ||
          ns.singularity.getFactionFavor(faction) <
            ns.getFavorToDonate() ||
          (ns.gang?.inGang() &&
            ns.gang.getGangInformation().faction === faction)
        ) {
          ns.tprint(
            `[WARN] Spende an ${faction || "unbekannte Fraktion"} abgebrochen: Voraussetzungen nicht erfüllt.`,
          );
          return false;
        }
        return ns.singularity.donateToFaction(faction, amount);
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
