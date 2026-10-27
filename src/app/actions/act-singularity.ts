import { NS, ProgramName, FactionName } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";

export async function main(ns: NS): Promise<void> {

  // ns.ui.openTail();
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
        const currentPrice = aug
          ? ns.singularity.getAugmentationPrice(aug)
          : Number.NaN;
        const requiredRep = aug
          ? ns.singularity.getAugmentationRepReq(aug)
          : Number.NaN;
        const missingPrereqs = aug
          ? ns.singularity
              .getAugmentationPrereq(aug)
              .filter(
                (prereq) =>
                  !ns.singularity.getOwnedAugmentations(true).includes(prereq),
              )
          : [];
        const factionIsAvailable =
          ns.getPlayer().factions.includes(faction) ||
          (ns.gang?.inGang() &&
            ns.gang.getGangInformation().faction === faction);
        const failures: string[] = [];
        if (!faction || !aug) failures.push("Fraktion oder Augmentation fehlt");
        if (!factionIsAvailable) failures.push(`nicht beigetreten bei ${faction}`);
        if (
          faction &&
          aug &&
          !ns.singularity.getAugmentationsFromFaction(faction).includes(aug)
        ) {
          failures.push(`${faction} bietet ${aug} nicht an`);
        }
        if (
          !Number.isFinite(maximumPrice) ||
          maximumPrice <= 0 ||
          currentPrice > maximumPrice
        ) {
          failures.push(
            `Preis geändert (aktuell $${ns.format.number(currentPrice)}, Request $${ns.format.number(maximumPrice)})`,
          );
        }
        if (
          faction &&
          Number.isFinite(requiredRep) &&
          ns.singularity.getFactionRep(faction) < requiredRep
        ) {
          failures.push(
            `Rep fehlt (${ns.format.number(ns.singularity.getFactionRep(faction))}/${ns.format.number(requiredRep)})`,
          );
        }
        if (ns.getServerMoneyAvailable("home") < currentPrice) {
          failures.push(
            `Geld fehlt ($${ns.format.number(ns.getServerMoneyAvailable("home"))}/$${ns.format.number(currentPrice)})`,
          );
        }
        if (missingPrereqs.length > 0) {
          failures.push(`Voraussetzungen fehlen: ${missingPrereqs.join(", ")}`);
        }
        if (
          aug &&
          ns.singularity.getOwnedAugmentations(true).includes(aug)
        ) {
          failures.push("bereits gekauft");
        }
        if (failures.length > 0) {
          ns.tprint(
            `[WARN] Augmentations-Kauf abgebrochen: ${aug || "unbekannt"} — ${failures.join("; ")}.`,
          );
          return false;
        }
        const purchased = ns.singularity.purchaseAugmentation(faction, aug);
        if (!purchased) {
          ns.tprint(
            `[WARN] Spiel-API hat den Kauf von ${aug} bei ${faction} abgelehnt, obwohl die geprüften Voraussetzungen erfüllt waren.`,
          );
        }
        return purchased;
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
