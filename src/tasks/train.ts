import { NS } from "@ns";
import { loadState, patchState } from "../core/state-manager.js"; 
import { COMBAT_STATS, STAT_MAP, DISPLAY_MAP, CombatStat } from "../lib/constants.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🏋️ Training-Worker gestartet...");

  const sing = ns.singularity;
  // Augmentations ändern sich im laufenden BitNode-Reset selten spontan. 
  // Das hier einmalig beim Start zu prüfen, ist vollkommen in Ordnung.
  const useFocus = !sing.getOwnedAugmentations(false).includes("Neuroreceptor Management Implant");

  // Cache, um unnötige Datei-Schreibzugriffe (I/O) über patchState zu verhindern
  let lastProgressBar = "";

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
    
    // Dank "as const" in den Constants weiß TS hier automatisch, dass 's' ein CombatStat ist.
    // Einziger Kniff: find() liefert string | undefined, wir casten das Ergebnis sauber.
    const lowStat = COMBAT_STATS.find((s) => p.skills[s] < targetStat) as CombatStat | undefined;

    if (lowStat) {
      const shortStat = STAT_MAP[lowStat];

      // Reise-Logik nach Sector-12
      if (p.city !== ns.enums.CityName.Sector12) {
        if (p.money < 200000) {
          ns.print(`[WARN] Zu wenig Geld für die Reise nach Sector-12 ($200k benötigt).`);
          await ns.sleep(5000);
          continue;
        }
        sing.travelToCity(ns.enums.CityName.Sector12);
      }

      // Prüfen, ob wir bereits im richtigen Gym festsitzen
      const currentWork = sing.getCurrentWork();
      const isAlreadyTraining =
        currentWork?.type === "CLASS" && 
        (currentWork as any).classType === shortStat && 
        (currentWork as any).className === "Powerhouse Gym";

      if (!isAlreadyTraining) {
        sing.gymWorkout("Powerhouse Gym", shortStat, useFocus);
      }

      // UI Update vorbereiten
      const currentLevel = Math.floor(p.skills[lowStat]);
      const nextProgressBar = `🏋️ ${DISPLAY_MAP[lowStat]}: ${currentLevel}/${targetStat}`;
      
      // Nur patchen, wenn sich die Anzeige wirklich verändert hat (z.B. Level-Up)
      if (nextProgressBar !== lastProgressBar) {
        patchState(ns, { progressBar: nextProgressBar });
        lastProgressBar = nextProgressBar;
      }

    } else {
      ns.print("[INFO] Alle Stats erreicht. Warte auf Dispatcher...");
      if (lastProgressBar !== "🏋️ Combat Stats [DONE]") {
        patchState(ns, { progressBar: "🏋️ Combat Stats [DONE]" });
        lastProgressBar = "🏋️ Combat Stats [DONE]";
      }
    }

    await ns.sleep(2000); 
  }
}