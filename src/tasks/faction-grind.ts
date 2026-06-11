import { NS } from "@ns";
import { loadState } from "../core/state-manager.js"; // Pfad ggf. an deine Ordnerstruktur anpassen

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🧬 Faction-Grinder Subsystem initialisiert.");

  while (true) {
    // 1. Aktuellen globalen Systemzustand laden
    const state = loadState(ns);
    
    if (!state || !state.targetFaction) {
      ns.print("⏳ Warte auf Zielvorgabe durch den Dispatcher...");
      await ns.sleep(2000);
      continue;
    }

    const faction = state.targetFaction;
    const currentWork = ns.singularity.getCurrentWork();

    // 2. Prüfen, ob wir bereits korrekt arbeiten
    let isWorkingCorrectly = false;
    if (currentWork && currentWork.type === "FACTION" && currentWork.factionName === faction) {
      isWorkingCorrectly = true;
    }

    // 3. Falls nicht, die beste Job-Art für diese Fraktion triggern
    if (!isWorkingCorrectly) {
      ns.print(`🚀 Wechsle Arbeit auf Fraktion: ${faction}`);
      
      // Prioritätsschleife für Arbeitsarten (Hacking -> Field -> Security)
      let success = ns.singularity.workForFaction(faction, ns.enums.FactionWorkType.hacking, false);
      if (!success) {
        success = ns.singularity.workForFaction(faction, ns.enums.FactionWorkType.field, false);
      }
      if (!success) {
        ns.singularity.workForFaction(faction, ns.enums.FactionWorkType.security, false);
      }
    }

    // 🔥 WICHTIG: KEIN saveState() mehr hier drinnen! 
    // Der Worker arbeitet still im Hintergrund. Die UI-Hoheit liegt allein beim Dispatcher.

    await ns.sleep(2000);
  }
}