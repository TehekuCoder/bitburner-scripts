import { NS, UniversityLocationName, UniversityClassType, CityName } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { loadStrategyState, patchProgressState } from "/infrastructure/state/state";

const TRAVEL_COST = 200_000;
const SLEEP_INTERVAL_MS = 2_000;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new LoggerClient(ns, "UNI");
  logger.info("🎓 Uni-Worker gestartet...");

  const sing = ns.singularity;
  const useFocus = !sing.getOwnedAugmentations(false).includes("Neuroreceptor Management Implant");

  // Kurs flexibel über Args festlegen (Standard: Algorithms für Hacking, Alternativ: Leadership für Charisma)
  const argCourse = ns.args[1] as string | undefined;
  
  let lastProgressBar = "";

  while (true) {
    const state = loadStrategyState(ns);
    const mode: string = state?.strategy || "IDLE";

    const argTarget = typeof ns.args[0] === "number" ? ns.args[0] : 0;
    const targetStat = argTarget > 0 ? argTarget : (state?.targetStat ?? 0);

    if (mode !== "MONEY" && mode !== "UNI" && mode !== "TRAIN") {
      logger.info(`Modus ist nun '${mode}'. Beende Uni-Worker.`);
      return;
    }

    const player = ns.getPlayer();

    // 1. Stadt- & Uni-Wahl
    let targetCity: CityName = ns.enums.CityName.Sector12;
    let targetUni: UniversityLocationName = "Rothman University";

    if (player.money >= TRAVEL_COST || player.city === ns.enums.CityName.Volhaven) {
      targetCity = ns.enums.CityName.Volhaven;
      targetUni = "ZB Institute of Technology";
    }

    // 2. Ziel-Kurs & Stat ermitteln
    let courseName: UniversityClassType = "Algorithms";
    let currentSkillLevel = Math.floor(player.skills.hacking);
    let statLabel = "Hacking";

    if (argCourse === "Charisma" || argCourse === "Leadership") {
      courseName = "Leadership";
      currentSkillLevel = Math.floor(player.skills.charisma);
      statLabel = "Charisma";
    }

    // 3. Reise-Logik
    if (player.city !== targetCity) {
      logger.info(`Reise nach ${targetCity} für Uni-Studium...`);
      if (!sing.travelToCity(targetCity)) {
        logger.error(`Reise nach ${targetCity} fehlgeschlagen.`);
        await ns.sleep(SLEEP_INTERVAL_MS);
        continue;
      }
    }

    // 4. Fortschritt & Kursausführung
    if (targetStat > 0 && currentSkillLevel >= targetStat) {
      if (lastProgressBar !== `🎓 ${statLabel} [DONE]`) {
        logger.success(`${statLabel}-Ziel-Level ${targetStat} erreicht!`);
        patchProgressState(ns, { progressBar: `🎓 ${statLabel} [DONE]` });
        lastProgressBar = `🎓 ${statLabel} [DONE]`;
        sing.stopAction();
      }

      if (mode !== "UNI") {
        return;
      }
    } else {
      const currentWork = sing.getCurrentWork();
      const isAlreadyStudying =
        currentWork?.type === "CLASS" &&
        currentWork.classType === courseName &&
        currentWork.location === targetUni;

      if (!isAlreadyStudying) {
        logger.info(`Belege Kurs '${courseName}' (${statLabel}) an der '${targetUni}'...`);
        sing.universityCourse(targetUni, courseName, useFocus);
      }

      const targetLabel = targetStat > 0 ? `/${targetStat}` : "";
      const nextProgressBar = `🎓 ${statLabel}: ${currentSkillLevel}${targetLabel}`;

      if (nextProgressBar !== lastProgressBar) {
        patchProgressState(ns, { progressBar: nextProgressBar });
        lastProgressBar = nextProgressBar;
      }
    }

    await ns.sleep(SLEEP_INTERVAL_MS);
  }
}