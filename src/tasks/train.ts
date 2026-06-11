import { NS, GymType, CityName } from "@ns";
import { loadState, saveState } from "core/state-manager.js"; // Zentraler State-Manager

type GymStat = "strength" | "defense" | "dexterity" | "agility";

const STAT_MAP: Record<GymStat, GymType> = {
  strength: "str",
  defense: "def",
  dexterity: "dex",
  agility: "agi",
};

// Schöne Namen fürs HUD
const DISPLAY_MAP: Record<GymStat, string> = {
  strength: "Str",
  defense: "Def",
  dexterity: "Dex",
  agility: "Agi",
};

const COMBAT_STATS: GymStat[] = ["strength", "defense", "dexterity", "agility"];

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🏋️ Training-Worker gestartet...");

  const sing = ns.singularity;

  while (true) {
    // --- 1. STATE VIA MANAGER LADEN ---
    const state = loadState(ns);
    const mode = state?.strategy || "IDLE";
    const targetStat = state?.targetStat || 0;

    // Wenn der Dispatcher den Modus ändert, beenden wir uns sauber
    if (mode !== "TRAIN") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Training.`);
      return;
    }

    const p = ns.getPlayer();
    // Finde den ersten Stat, der den Meilenstein noch nicht erreicht hat
    const lowStat = COMBAT_STATS.find((s) => p.skills[s] < targetStat);

    if (lowStat) {
      const shortStat = STAT_MAP[lowStat];

      // BEHOBEN: Bitburner 3.0 Enum-Nutzung für die Städtereise
      if (p.city !== ns.enums.CityName.Sector12) {
        ns.print(`[TRAVEL] Reise nach Sector-12 für das Powerhouse Gym.`);
        sing.travelToCity(ns.enums.CityName.Sector12);
      }

      // Prüfen, ob wir das Synapsen-Implantat haben (erlaubt Multitasking ohne Fokus)
      const useFocus = !sing
        .getOwnedAugmentations(false)
        .includes("Neuroreceptor Management Implant");

      // BEHOBEN: "as any" zwingt den Compiler, die neuen Bitburner 3.0 Typen zu akzeptieren,
      // selbst wenn deine lokalen Definitionen noch veraltet sind.
      const currentWork = sing.getCurrentWork() as any;
      const isAlreadyTraining =
        currentWork?.type === "GYM" && currentWork.statType === shortStat;

      if (!isAlreadyTraining) {
        ns.print(
          `[GYM] Starte Training: ${lowStat} bis Level ${targetStat}...`,
        );

        const success = sing.gymWorkout("Powerhouse Gym", shortStat, useFocus);

        if (!success) {
          ns.print(
            `[WARN] Konnte Training nicht starten. Eventuell pleite? (Gyms kosten Geld)`,
          );
        }
      }

      // --- 2. HUD UPDATE ---
      if (state) {
        const currentLevel = Math.floor(p.skills[lowStat]);
        state.progressBar = `🏋️ ${DISPLAY_MAP[lowStat]}: ${currentLevel}/${targetStat}`;
        saveState(ns, state);
      }
    } else {
      ns.print(
        "[INFO] Alle Stats haben den aktuellen Meilenstein erreicht. Warte auf Dispatcher...",
      );
      if (state) {
        state.progressBar = "🏋️ Combat Stats [DONE]";
        saveState(ns, state);
      }
    }

    // 4 Sekunden Schlaftakt ist perfekt, um die Serverlast niedrig zu halten
    await ns.sleep(4000);
  }
}
