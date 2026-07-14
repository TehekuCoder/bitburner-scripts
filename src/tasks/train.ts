import { NS, GymType } from "@ns";
import { loadState, patchState } from "../core/state-manager.js"; // 🛠️ Relativen Pfad angepasst

type GymStat = "strength" | "defense" | "desktop" | "dexterity" | "agility";

const STAT_MAP: Record<string, GymType> = {
  strength: "str",
  defense: "def",
  dexterity: "dex",
  agility: "agi",
};

const DISPLAY_MAP: Record<string, string> = {
  strength: "Str",
  defense: "Def",
  dexterity: "Dex",
  agility: "Agi",
};

const COMBAT_STATS = ["strength", "defense", "dexterity", "agility"];

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🏋️ Training-Worker gestartet...");

  const sing = ns.singularity;
  const useFocus = !sing.getOwnedAugmentations(false).includes("Neuroreceptor Management Implant");

  while (true) {
    const state = loadState(ns);
    const mode = state?.strategy || "IDLE";
    const targetStat = (ns.args[0] as number) || state?.targetStat || 0;

    if (mode !== "TRAIN") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Training.`);
      return;
    }

    if (targetStat <= 0) {
      ns.print(`[WARN] Ungültiges Trainingsziel (${targetStat}). Warte...`);
      await ns.sleep(2000);
      continue;
    }

    const p = ns.getPlayer();
    const lowStat = COMBAT_STATS.find((s) => p.skills[s as keyof typeof p.skills] < targetStat);

    if (lowStat) {
      const shortStat = STAT_MAP[lowStat];

      // Reiseschutz (Sector-12 Powerhouse Gym)
      if (p.city !== ns.enums.CityName.Sector12) {
        if (p.money < 200000) {
          ns.print(`[WARN] Zu wenig Geld für die Reise nach Sector-12 ($200k benötigt).`);
          await ns.sleep(5000);
          continue;
        }
        sing.travelToCity(ns.enums.CityName.Sector12);
      }

      const currentWork = sing.getCurrentWork();
      const isAlreadyTraining = currentWork?.type === "CLASS" && 
                                (currentWork as any).classType === shortStat && 
                                (currentWork as any).className === "Powerhouse Gym";

      if (!isAlreadyTraining) {
        sing.gymWorkout("Powerhouse Gym", shortStat, useFocus);
      }

      // HUD & Heartbeat Update
      const currentLevel = Math.floor(p.skills[lowStat as keyof typeof p.skills] as number);
      patchState(ns, { 
        progressBar: `🏋️ ${DISPLAY_MAP[lowStat]}: ${currentLevel}/${targetStat}`,
      });

    } else {
      ns.print("[INFO] Alle Stats erreicht. Warte auf Dispatcher...");
      patchState(ns, { 
        progressBar: "🏋️ Combat Stats [DONE]",
      });
    }

    await ns.sleep(2000); // 🔥 Von 4000 auf 2000 verkürzt wegen des Dashboard-Takt-Schutzes!
  }
}