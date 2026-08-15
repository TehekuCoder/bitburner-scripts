import { NS, CityName, GymType } from "@ns";
import { COMBAT_STATS } from "/lib/constants/game.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";

interface GymOption {
  name: string;
  city: CityName;
  minMoney: number;
}

// Besser strukturierte Gym-Auswahl inkl. Heimatstadt
const GYM_OPTIONS: GymOption[] = [
  { name: "Powerhouse Gym", city: "Sector-12", minMoney: 1_000_000 },
  { name: "Millennium Fitness Gym", city: "Volhaven", minMoney: 1_000_000 },
  { name: "Iron Gym", city: "Sector-12", minMoney: 0 },
];

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Train");

  if (!ns.singularity) {
    logger.error("Singularity-API (SF4) fehlt!");
    return;
  }

  const targetStat = typeof ns.args[0] === "number" ? ns.args[0] : 1500;
  logger.info(`🏋️ Starte Combat-Training bis Target-Stat: ${targetStat}`);

  // Zuordnung der Stat-Namen zu den Bitburner GymType-Kürzeln
  const statToGymType: Record<string, GymType> = {
    strength: "str" as GymType,
    defense: "def" as GymType,
    dexterity: "dex" as GymType,
    agility: "agi" as GymType,
  };

  while (true) {
    const player = ns.getPlayer();

    // 1. Niedrigsten Combat-Stat ermitteln
    const stats = COMBAT_STATS.map((s) => ({
      name: s,
      value: player.skills[s],
    })).sort((a, b) => a.value - b.value);

    const lowest = stats[0];

    if (lowest.value >= targetStat) {
      logger.success(`🎉 Alle Combat-Stats haben ${targetStat} erreicht! Beende Training.`);
      ns.singularity.stopAction();
      break;
    }

    // 2. Bestes bezahlbares Gym wählen
    const selectedGym =
      GYM_OPTIONS.find((g) => player.money >= g.minMoney) ?? GYM_OPTIONS[2];

    // 3. In die richtige Stadt reisen (falls nötig & bezahlbar)
    if (player.city !== selectedGym.city) {
      if (player.money >= 200_000) {
        const traveled = ns.singularity.travelToCity(selectedGym.city);
        if (traveled) {
          logger.info(`✈️ Gereist nach ${selectedGym.city} für [${selectedGym.name}]`);
        }
      } else {
        logger.warn(`Zu wenig Geld für Städtereise nach ${selectedGym.city}. Warte auf Budget...`);
        await ns.sleep(5000);
        continue;
      }
    }

    // 4. Workout starten (mit 'as any' Typecast für Bitburner API-Kompatibilität)
    const gymStat = statToGymType[lowest.name] ?? (lowest.name as GymType);
    const isWorkingOut = ns.singularity.gymWorkout(
      selectedGym.name as any,
      gymStat,
      false,
    );

    if (!isWorkingOut) {
      logger.warn(`Konnte Training für ${lowest.name} im ${selectedGym.name} nicht starten.`);
    }

    await ns.sleep(3000);
  }
}