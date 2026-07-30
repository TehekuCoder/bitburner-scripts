import { NS, FactionName } from "@ns";
import { CITY_FACTIONS } from "/lib/constants.js";
import { loadState, patchState, loadGangState } from "/lib/state.js";

export async function main(ns: NS): Promise<void> {
  ns.print("🧬 Faction-Grinder Subsystem initialisiert.");

  while (true) {
    const state = loadState(ns);

    if (!state || !state.targetFaction) {
      ns.print("⏳ Warte auf Zielvorgabe durch den Dispatcher...");
      await ns.sleep(2000);
      continue;
    }

    const faction: FactionName = state.targetFaction as FactionName;
    const player = ns.getPlayer();
    const sing = ns.singularity;

    // ------------------------------------------------------------------
    // 🛡️ LOCKOUT CHECKS
    // ------------------------------------------------------------------
    const gangState = loadGangState(ns);
    const isGangFaction =
      (ns.gang.inGang() && ns.gang.getGangInformation().faction === faction) ||
      (gangState?.hasGang && gangState.gangFaction === faction);

    const isTargetCity = CITY_FACTIONS.includes(faction);
    const currentCity = CITY_FACTIONS.find((c) => player.factions.includes(c));
    const isCityLocked = isTargetCity && currentCity && currentCity !== faction;

    if (isGangFaction || isCityLocked) {
      ns.print(`🛑 [LOCKOUT] [${faction}] blockiert. Setze Ziel zurück...`);
      patchState(ns, { targetFaction: undefined });
      await ns.sleep(2000);
      continue;
    }

    // ------------------------------------------------------------------
    // 🚀 ARBEIT STARTEN & MELDEN
    // ------------------------------------------------------------------
    if (player.factions.includes(faction)) {
      const currentWork = sing.getCurrentWork();
      const isWorkingCorrectly =
        currentWork &&
        currentWork.type === "FACTION" &&
        (currentWork as any).factionName === faction;

      if (!isWorkingCorrectly) {
        ns.print("🚀 Wechsle Arbeit auf Fraktion: " + faction);

        sing.workForFaction(faction, ns.enums.FactionWorkType.hacking, false) ||
        sing.workForFaction(faction, ns.enums.FactionWorkType.field, false) ||
        sing.workForFaction(faction, ns.enums.FactionWorkType.security, false);
      }

      // State Aktualisierung
      const currentRep = sing.getFactionRep(faction);
      patchState(ns, {
        factionCurrentReps: {
          ...(state.factionCurrentReps ?? {}),
          [faction]: currentRep,
        },
      });
    } else {
      ns.print(`⏳ Warte auf Beitritt/Einladung für [${faction}]...`);
    }

    await ns.sleep(2000);
  }
}