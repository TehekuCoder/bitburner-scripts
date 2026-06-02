import { NS, GymType, CityName } from "@ns";

type GymStat = "strength" | "defense" | "dexterity" | "agility";

interface BotState {
  strategy: string;
  targetStat?: number;
}

const STAT_MAP: Record<GymStat, GymType> = {
  strength: "str",
  defense: "def",
  dexterity: "dex",
  agility: "agi",
};

const COMBAT_STATS: GymStat[] = ["strength", "defense", "dexterity", "agility"];

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🏋️ Training-Worker gestartet...");

  const sing = ns.singularity;

  while (true) {
    let mode = "TRAIN";
    let targetStat = 0;

    // State auslesen
    if (ns.fileExists("bitos_state.txt", "home")) {
      try {
        const content = ns.read("bitos_state.txt");
        if (content) {
          const state = JSON.parse(content) as BotState;
          mode = state.strategy;
          if (state.targetStat) targetStat = state.targetStat;
        }
      } catch {
        // Schutz vor Lese-/Schreibkollisionen
      }
    }

    // Wenn der Dispatcher den Modus ändert, beenden wir uns sauber
    if (mode !== "TRAIN") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Training.`);
      return;
    }

    const p = ns.getPlayer();
    // Finde den ersten Stat, der den Meilenstein noch nicht erreicht hat
    const lowStat = COMBAT_STATS.find((s) => p.skills[s] < targetStat);

    if (lowStat) {
      // Reisen falls wir nicht in Sector-12 sind
      if (p.city !== "Sector-12") {
        ns.print("[TRAVEL] Reise nach Sector-12 für das Powerhouse Gym.");
        sing.travelToCity("Sector-12" as CityName);
      }

      const shortStat = STAT_MAP[lowStat];
      const useFocus = !sing.getOwnedAugmentations(false).includes("Neuroreceptor Management Implant");
      
      const currentWork = sing.getCurrentWork();
      const isAlreadyTraining = currentWork?.type === "CLASS" && currentWork.classType === lowStat;

      if (!isAlreadyTraining) {
        ns.print(`[GYM] Starte Training: ${lowStat} bis Level ${targetStat}...`);
        sing.gymWorkout("Powerhouse Gym", shortStat, useFocus);
      }
    } else {
      ns.print("[INFO] Alle Stats haben den aktuellen Meilenstein erreicht. Warte auf Dispatcher...");
    }

    await ns.sleep(4000);
  }
}