import { NS, FactionName } from "@ns";
import { loadState, patchState } from "../core/state-manager.js";

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

    const faction: FactionName = state.targetFaction;
    const sing = ns.singularity;
    const currentWork = sing.getCurrentWork();

    // 🟢 Type-Cast für strict TS
    let isWorkingCorrectly =
      currentWork &&
      currentWork.type === "FACTION" &&
      (currentWork as any).factionName === faction;

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

    const currentRep = sing.getFactionRep(faction);

    // 🟢 Korrektur: Wir speichern die aktuelle Rep in 'factionCurrentReps', nicht in 'factionTargets'!
    const updatedCurrentReps = { ...(state.factionCurrentReps ?? {}) } as Record<FactionName, number>;
    updatedCurrentReps[faction] = currentRep;

    patchState(ns, {
      progressBar: `🧬 ${faction}: ${ns.format.number(currentRep, 0)} Rep`,
      factionCurrentReps: updatedCurrentReps // Verhindert das Zerschießen deiner Kernel-Ziele
    });

    await ns.sleep(2000);
  }
}