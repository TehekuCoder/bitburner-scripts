import { NS, GymType, CityName } from "@ns";
import { loadState, saveState } from "core/state-manager.js";

type GymStat = "strength" | "defense" | "dexterity" | "agility";

const STAT_MAP: Record<GymStat, GymType> = {
  strength: "str",
  defense: "def",
  dexterity: "dex",
  agility: "agi",
};

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

    if (mode !== "TRAIN") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Training.`);
      return;
    }

    const p = ns.getPlayer();
    const lowStat = COMBAT_STATS.find((s) => p.skills[s] < targetStat);

    if (lowStat) {
      const shortStat = STAT_MAP[lowStat];

      // Reiseschutz: Nur reisen, wenn wir nicht schon da sind
      if (p.city !== ns.enums.CityName.Sector12) {
        ns.print(`[TRAVEL] Versuche Reise nach Sector-12 für Powerhouse Gym.`);
        const travelSuccess = sing.travelToCity(ns.enums.CityName.Sector12);

        if (!travelSuccess) {
          ns.print(
            `[WARN] Reise fehlgeschlagen. Zu wenig Geld (\$200k benötigt)?`,
          );
          await ns.sleep(4000);
          continue; // Nächster Versuch im nächsten Tick
        }
      }

      // Fokus-Check via Neuroreceptor-Implantat
      const useFocus = !sing
        .getOwnedAugmentations(false)
        .includes("Neuroreceptor Management Implant");

      const currentWork = sing.getCurrentWork();

      // REPARIERT: Bitburner listet Gym-Training intern unter dem Typ "CLASS"
      const isAlreadyTraining =
        currentWork?.type === "CLASS" &&
        (currentWork as any).classType === shortStat &&
        (currentWork as any).className === "Powerhouse Gym";

      if (!isAlreadyTraining) {
        ns.print(
          `[GYM] Starte Training: ${lowStat} bis Level ${targetStat}...`,
        );

        const success = sing.gymWorkout("Powerhouse Gym", shortStat, useFocus);

        if (!success) {
          ns.print(`[WARN] Konnte Training nicht starten. Eventuell pleite?`);
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
        "[INFO] Alle Stats haben den Meilenstein erreicht. Warte auf Dispatcher...",
      );
      if (state) {
        state.progressBar = "🏋️ Combat Stats [DONE]";
        saveState(ns, state);
      }
    }

    await ns.sleep(4000);
  }
}
