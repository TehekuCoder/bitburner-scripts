import { NS, FactionName } from "@ns";
import { CITY_FACTIONS } from "/lib/constants.js";
import { loadFactionState, loadGangState, patchFactionState } from "/lib/state.js";

export async function main(ns: NS): Promise<void> {
  ns.print("🧬 Faction-Grinder Subsystem initialisiert.");

  while (true) {
    const state = loadFactionState(ns);

    if (!state || !state.targetFaction) {
      ns.print("⏳ Warte auf Zielvorgabe durch den Dispatcher...");
      await ns.sleep(2000);
      continue;
    }

    const faction: FactionName = state.targetFaction as FactionName;
    const player = ns.getPlayer();
    const sing = ns.singularity;

    // ------------------------------------------------------------------
    // 🛡️ GANG FACTION LOCKOUT CHECK (Direkt-API + State Fallback)
    // ------------------------------------------------------------------
    let isGangFaction = false;
    try {
      if (ns.gang.inGang()) {
        const gangInfo = ns.gang.getGangInformation();
        if (gangInfo.faction === faction) {
          isGangFaction = true;
        }
      }
    } catch {
      // Gang-API (noch) nicht verfügbar oder kein Zugriff
    }

    const gangState = loadGangState(ns);
    if (isGangFaction || (gangState?.hasGang && gangState.gangFaction === faction)) {
      ns.print(
        `🛑 [GANG LOCKOUT] Manuelle Arbeit für [${faction}] unmöglich (Gang-Fraktion!). Setze Ziel zurück...`
      );
      // Ziel im State leeren, damit der Dispatcher ein neues Ziel wählt:
      patchFactionState(ns, { targetFaction: undefined });
      await ns.sleep(3000);
      continue;
    }

    // ------------------------------------------------------------------
    // 🛡️ CITY FACTION LOCKOUT CHECK
    // ------------------------------------------------------------------
    const isTargetCity = CITY_FACTIONS.includes(faction);
    const currentCity = CITY_FACTIONS.find((c) => player.factions.includes(c));

    if (isTargetCity && currentCity && currentCity !== faction) {
      ns.print(
        `🛑 [CITY LOCKOUT] Arbeit für [${faction}] unmöglich! Bereits bei [${currentCity}]. Setze Ziel zurück...`
      );
      patchFactionState(ns, { targetFaction: undefined });
      await ns.sleep(3000);
      continue;
    }

    // ------------------------------------------------------------------
    // 🛡️ MITGLIEDSCHAFT & AUTO-JOIN
    // ------------------------------------------------------------------
    const isMember = player.factions.includes(faction);

    if (!isMember) {
      const invites = sing.checkFactionInvitations();

      if (invites.includes(faction)) {
        if (!isTargetCity || currentCity === null) {
          if (sing.joinFaction(faction)) {
            ns.print(`🎉 Einladung zu [${faction}] angenommen!`);
          }
        }
      } else {
        ns.print(`⏳ Keine Einladung für [${faction}] vorhanden. Warte...`);
        await ns.sleep(5000);
        continue;
      }
    }

    // ------------------------------------------------------------------
    // 🚀 ARBEIT STARTEN / PRÜFEN
    // ------------------------------------------------------------------
    const currentWork = sing.getCurrentWork();

    const isWorkingCorrectly =
      currentWork &&
      currentWork.type === "FACTION" &&
      (currentWork as any).factionName === faction;

    if (!isWorkingCorrectly) {
      ns.print("🚀 Wechsle Arbeit auf Fraktion: " + faction);

      const success =
        sing.workForFaction(faction, ns.enums.FactionWorkType.hacking, false) ||
        sing.workForFaction(faction, ns.enums.FactionWorkType.field, false) ||
        sing.workForFaction(faction, ns.enums.FactionWorkType.security, false);

      if (!success) {
        ns.print(`❌ Konnte keine gültige Arbeitsart für [${faction}] starten.`);
      }
    }

    // ------------------------------------------------------------------
    // 📊 STATE UPDATE
    // ------------------------------------------------------------------
    const currentRep = sing.getFactionRep(faction);
    const updatedCurrentReps = {
      ...(state.factionCurrentReps ?? {}),
    } as Record<FactionName, number>;
    
    updatedCurrentReps[faction] = currentRep;

    patchFactionState(ns, {
      factionCurrentReps: updatedCurrentReps,
    });

    await ns.sleep(2000);
  }
}