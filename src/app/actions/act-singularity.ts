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
        const maximumPrice = Number(ns.args[3]);
        const factionIsAvailable =
          ns.getPlayer().factions.includes(faction) ||
          (ns.gang?.inGang() &&
            ns.gang.getGangInformation().faction === faction);
        if (
          !faction ||
          !aug ||
          !factionIsAvailable ||
          !Number.isFinite(maximumPrice) ||
          maximumPrice <= 0 ||
          ns.singularity.getAugmentationPrice(aug) > maximumPrice ||
          ns.singularity.getFactionRep(faction) <
            ns.singularity.getAugmentationRepReq(aug) ||
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

      default:
        return false;
    }
  });
}
