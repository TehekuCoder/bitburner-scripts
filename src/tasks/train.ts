import { NS, GymLocationName, GymType, CityName } from "@ns";
import { COMBAT_STATS, GYM_STAT_MAP, DISPLAY_MAP } from "/lib/constants";
import { loadStrategyState, patchProgressState } from "/lib/state.js";
import { LoggerClient } from "/lib/logger-client.js";

const TRAVEL_COST = 200_000;
const SLEEP_INTERVAL_MS = 2_000;
const DEFAULT_COMBAT_TARGET = 15;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new LoggerClient(ns, "TRAIN");
  logger.info("🏋️ Gym-Training-Worker gestartet...");

  const sing = ns.singularity;
  const useFocus = !sing
    .getOwnedAugmentations(false)
    .includes("Neuroreceptor Management Implant");

  let lastProgressBar = "";
  let lastActiveStat: string | null = null;

  while (true) {
    const state = loadStrategyState(ns);
    const mode = state?.strategy || "IDLE";

    const argTarget = typeof ns.args[0] === "number" ? ns.args[0] : 0;
    const targetStat = argTarget > 0 ? argTarget : (state?.targetStat ?? DEFAULT_COMBAT_TARGET);

    if (mode !== "TRAIN") {
      logger.info(`Modus ist nun '${mode}'. Beende Gym-Worker.`);
      return;
    }

    const player = ns.getPlayer();

    // Stadt-Wahl: Volhaven (Powerhouse Gym) > Sector-12 (Powerhouse Gym)
    // 💡 Typisierung explizit als CityName
    let targetCity: CityName = ns.enums.CityName.Sector12;
    if (player.money >= TRAVEL_COST || player.city === ns.enums.CityName.Volhaven) {
      targetCity = ns.enums.CityName.Volhaven;
    }

    if (player.city !== targetCity) {
      logger.info(`Reise nach ${targetCity} für Gym-Training...`);
      if (!sing.travelToCity(targetCity)) {
        logger.error(`Reise nach ${targetCity} fehlgeschlagen.`);
        await ns.sleep(SLEEP_INTERVAL_MS);
        continue;
      }
    }

    const gymName: GymLocationName = "Powerhouse Gym";
    const lowStat = COMBAT_STATS.find((stat) => player.skills[stat] < targetStat);

    if (lowStat) {
      const shortStat = GYM_STAT_MAP[lowStat];
      const currentWork = sing.getCurrentWork();
      const isAlreadyTraining =
        currentWork?.type === "CLASS" &&
        currentWork.classType === (shortStat as unknown as GymType) &&
        currentWork.location === gymName;

      if (!isAlreadyTraining) {
        if (lastActiveStat !== shortStat) {
          logger.info(`Wechsele Workout auf [${DISPLAY_MAP[lowStat]}] (Ziel: ${targetStat})`);
          lastActiveStat = shortStat;
        }

        const success = sing.gymWorkout(gymName, shortStat, useFocus);
        if (!success) {
          logger.error(`Konnte gymWorkout("${gymName}", "${shortStat}") nicht ausführen.`);
        }
      }

      const currentLevel = Math.floor(player.skills[lowStat]);
      const nextProgressBar = `🏋️ ${DISPLAY_MAP[lowStat]}: ${currentLevel}/${targetStat}`;

      if (nextProgressBar !== lastProgressBar) {
        patchProgressState(ns, { progressBar: nextProgressBar });
        lastProgressBar = nextProgressBar;
      }
    } else {
      if (lastProgressBar !== "🏋️ Combat Stats [DONE]") {
        logger.success(`Alle Combat-Stats auf Ziel-Level ${targetStat} trainiert!`);
        patchProgressState(ns, { progressBar: "🏋️ Combat Stats [DONE]" });
        lastProgressBar = "🏋️ Combat Stats [DONE]";
        sing.stopAction();
      }
      return;
    }

    await ns.sleep(SLEEP_INTERVAL_MS);
  }
}