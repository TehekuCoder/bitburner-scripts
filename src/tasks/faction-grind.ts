import { NS } from "@ns";
import { loadState } from "../core/state-manager.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🧬 Faction-Grinder Subsystem initialisiert.");

  while (true) {
    const state = loadState(ns);
    
    if (!state || !state.targetFaction) {
      ns.print("⏳ Warte auf Zielvorgabe durch den Dispatcher...");
      await ns.sleep(2000);
      continue;
    }

    const faction = state.targetFaction;
    const currentWork = ns.singularity.getCurrentWork();

    let isWorkingCorrectly = false;
    if (currentWork && currentWork.type === "FACTION" && currentWork.factionName === faction) {
      isWorkingCorrectly = true;
    }

    if (!isWorkingCorrectly) {
      ns.print("🚀 Wechsle Arbeit auf Fraktion: " + faction);
      
      // FIX: PascalCase für die Bitburner 3.0 Enums genutzt
      let success = ns.singularity.workForFaction(faction, ns.enums.FactionWorkType.hacking);
      if (!success) {
        success = ns.singularity.workForFaction(faction, ns.enums.FactionWorkType.field);
      }
      if (!success) {
        ns.singularity.workForFaction(faction, ns.enums.FactionWorkType.security);
      }
    }

    await ns.sleep(2000);
  }
}