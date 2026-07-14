import { NS, FactionName } from "@ns";
import { loadState, patchState } from "../core/state-manager.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🧬 Faction-Grinder Subsystem initialisiert.");

  while (true) {
    const state = loadState(ns);
    
    // Sicherstellen, dass der State und das Ziel existieren
    if (!state || !state.targetFaction) {
      ns.print("⏳ Warte auf Zielvorgabe durch den Dispatcher...");
      await ns.sleep(2000);
      continue;
    }

    // Durch den 'continue'-Check oben weiß TS jetzt sicher: targetFaction ist ein FactionName!
    const faction: FactionName = state.targetFaction;
    const sing = ns.singularity;
    const currentWork = sing.getCurrentWork();

    let isWorkingCorrectly = currentWork && currentWork.type === "FACTION" && currentWork.factionName === faction;

    if (!isWorkingCorrectly) {
      ns.print("🚀 Wechsle Arbeit auf Fraktion: " + faction);
      
      let success = sing.workForFaction(faction, ns.enums.FactionWorkType.hacking, false);
      if (!success) {
        success = sing.workForFaction(faction, ns.enums.FactionWorkType.field, false);
      }
      if (!success) {
        sing.workForFaction(faction, ns.enums.FactionWorkType.security, false);
      }
    }

    // Aktuelle Reputation ermitteln
    const currentRep = sing.getFactionRep(faction);

    // 🛠️ NEU & ULTRA-WICHTIG FÜR DEN DISPATCHER:
    // Wir updaten nicht nur die Progressbar, sondern halten auch das globale factionTargets-Objekt aktuell!
    const updatedTargets = { ...(state.factionTargets ?? {}) } as Record<FactionName, number>;
    updatedTargets[faction] = currentRep;

    patchState(ns, {
      progressBar: `🧬 ${faction}: ${ns.format.number(currentRep, 0)} Rep`,
      factionTargets: updatedTargets
    });

    await ns.sleep(2000);
  }
}