import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import {
  BN8_VIOLET_CONGRUITY_AUGMENTATION,
  getDaedalusAugmentationRequirement,
  getHackingAugmentationValue,
  hasBothFourSigmaLicenses,
  hasGraftingUnlock,
  hasHackingAugmentationBenefit,
  shouldPrioritizeVioletCongruityGraft,
} from "/domain/evaluators/purchase/bn8-augmentation.js";
import { loadBnMults } from "/lib/utils.js";

const RETRY_DELAY_MS = 30_000;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new LoggerClient(ns, "BN8-GRAFTING");

  if (ns.getResetInfo().currentNode !== 8 || !hasGraftingUnlock(ns)) {
    logger.info("Grafting ist in diesem Run nicht freigeschaltet.");
    return;
  }

  while (true) {
    if (
      !hasBothFourSigmaLicenses(ns) ||
      ns.singularity.getOwnedAugmentations(false).includes("The Red Pill") ||
      !ns.grafting
    ) {
      await ns.sleep(RETRY_DELAY_MS);
      continue;
    }

    const requiredAugs = getDaedalusAugmentationRequirement(
      loadBnMults(ns).DaedalusAugsRequirement ?? 1,
    );
    const installedAugs = ns.singularity.getOwnedAugmentations(false);
    const ownedAugSet = new Set(
      ns.singularity.getOwnedAugmentations(true),
    );
    const daedalusJoined = ns.getPlayer().factions.includes("Daedalus");
    const shouldGraftViolet = shouldPrioritizeVioletCongruityGraft(
      daedalusJoined,
      ownedAugSet.has(BN8_VIOLET_CONGRUITY_AUGMENTATION),
    );
    if (installedAugs.length >= requiredAugs && !shouldGraftViolet) {
      await ns.sleep(RETRY_DELAY_MS);
      continue;
    }

    const player = ns.getPlayer();
    const currentWork = ns.singularity.getCurrentWork();
    if (player.city !== "New Tokyo") {
      await ns.sleep(RETRY_DELAY_MS);
      continue;
    }
    if (currentWork !== null) {
      const isDaedalusRepWork =
        currentWork.type === "FACTION" &&
        currentWork.factionName === "Daedalus";
      if (!shouldGraftViolet || !isDaedalusRepWork) {
        await ns.sleep(RETRY_DELAY_MS);
        continue;
      }
      if (!ns.singularity.stopAction()) {
        logger.warn("Daedalus-Rufarbeit konnte für Violet-Grafting nicht beendet werden.");
        await ns.sleep(RETRY_DELAY_MS);
        continue;
      }
      logger.info("Daedalus-Rufarbeit beendet; Violet-Grafting hat Vorrang.");
    }

    const candidate = ns.grafting
      .getGraftableAugmentations()
      .filter(
        (name) =>
          name !== "The Red Pill" &&
          ns.singularity
            .getAugmentationPrereq(name)
            .every((prerequisite) => ownedAugSet.has(prerequisite)) &&
          (shouldGraftViolet
            ? name === BN8_VIOLET_CONGRUITY_AUGMENTATION
            : hasHackingAugmentationBenefit(
                ns.singularity.getAugmentationStats(name),
              )),
      )
      .map((name) => ({
        name,
        price: ns.grafting.getAugmentationGraftPrice(name),
        value: getHackingAugmentationValue(
          ns.singularity.getAugmentationStats(name),
        ),
      }))
      .filter(
        (item) =>
          Number.isFinite(item.price) &&
          item.price > 0 &&
          item.price <= player.money &&
          Number.isFinite(item.value) &&
          (item.name === BN8_VIOLET_CONGRUITY_AUGMENTATION ||
            item.value > 0),
      )
      .sort((a, b) => b.value / b.price - a.value / a.price)[0];

    if (!candidate) {
      await ns.sleep(RETRY_DELAY_MS);
      continue;
    }

    if (!ns.grafting.graftAugmentation(candidate.name, false)) {
      logger.warn(`Grafting konnte nicht gestartet werden: ${candidate.name}`);
      await ns.sleep(RETRY_DELAY_MS);
      continue;
    }

    logger.info(
      `Grafting gestartet: ${candidate.name} ($${ns.format.number(candidate.price)}).`,
    );
    try {
      await ns.grafting.waitForOngoingGrafting();
      if (!ns.singularity.getOwnedAugmentations(false).includes(candidate.name)) {
        logger.warn(`Grafting nicht abgeschlossen: ${candidate.name}`);
        await ns.sleep(RETRY_DELAY_MS);
      } else {
        logger.success(`Grafting abgeschlossen: ${candidate.name}`);
      }
    } catch (error) {
      logger.warn(`Grafting wurde unterbrochen: ${String(error)}`);
      await ns.sleep(RETRY_DELAY_MS);
    }
  }
}
