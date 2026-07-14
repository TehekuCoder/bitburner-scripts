import { NS, GymType } from "@ns";
import { loadState, patchState } from "core/state-manager.js"; // 🛠️ Nutzt nun patchState

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

  // Einmalig beim Start prüfen.
  const useFocus = !sing
    .getOwnedAugmentations(false)
    .includes("Neuroreceptor Management Implant");

  let lastSavedProgress = "";

  while (true) {
    const state = loadState(ns);
    const mode = state?.strategy || "IDLE";
    
    // 🛠️ Wert aus Argumenten lesen, falls nicht vorhanden aus dem State
    const targetStat = (ns.args[0] as number) || state?.targetStat || 0;

    // Falls der Dispatcher den Modus gewechselt hat, beenden wir uns selbst sauber
    if (mode !== "TRAIN") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Training.`);
      return;
    }

    if (targetStat <= 0) {
      ns.print(`[WARN] Ungültiges Trainingsziel (${targetStat}). Warte...`);
      await ns.sleep(4000);
      continue;
    }

    const p = ns.getPlayer();
    const lowStat = COMBAT_STATS.find((s) => p.skills[s] < targetStat);

    if (lowStat) {
      const shortStat = STAT_MAP[lowStat];

      // Reiseschutz
      if (p.city !== ns.enums.CityName.Sector12) {
        if (p.money < 200000) {
          ns.print(`[WARN] Zu wenig Geld für die Reise nach Sector-12 (\$200k benötigt).`);
          await ns.sleep(15000);
          continue;
        }

        ns.print(`[TRAVEL] Versuche Reise nach Sector-12 für Powerhouse Gym.`);
        const travelSuccess = sing.travelToCity(ns.enums.CityName.Sector12);

        if (!travelSuccess) {
          ns.print(`[WARN] Reise fehlgeschlagen.`);
          await ns.sleep(4000);
          continue;
        }
      }

      const currentWork = sing.getCurrentWork();
      
      const isAlreadyTraining =
        currentWork?.type === "CLASS" &&
        (currentWork as any).classType === shortStat &&
        (currentWork as any).className === "Powerhouse Gym";

      if (!isAlreadyTraining) {
        ns.print(`[GYM] Starte Training: ${lowStat} bis Level ${targetStat}...`);

        if (p.money < 1000) {
          ns.print(`[WARN] Sehr wenig Geld. Training könnte fehlschlagen.`);
        }

        const success = sing.gymWorkout("Powerhouse Gym", shortStat, useFocus);

        if (!success) {
          ns.print(`[WARN] Konnte Training nicht starten.`);
          await ns.sleep(10000);
          continue;
        }
      }

      // --- 🛠️ OPTIMIERUNG: Nur die ProgressBar patchen, nicht den ganzen State überschreiben ---
      const currentLevel = Math.floor(p.skills[lowStat]);
      const progressStr = `🏋️ ${DISPLAY_MAP[lowStat]}: ${currentLevel}/${targetStat}`;
      
      if (progressStr !== lastSavedProgress) {
        patchState(ns, { progressBar: progressStr });
        lastSavedProgress = progressStr;
      }
    } else {
      ns.print("[INFO] Alle Stats haben den Meilenstein erreicht. Warte auf Dispatcher...");
      if (lastSavedProgress !== "DONE") {
        patchState(ns, { progressBar: "🏋️ Combat Stats [DONE]" });
        lastSavedProgress = "DONE";
      }
    }

    await ns.sleep(4000);
  }
}