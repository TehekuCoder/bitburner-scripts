import { NS, FactionName } from "@ns";
import { CITY_FACTIONS } from "/lib/constants.js";
import { 
  loadFactionState, 
  patchFactionState, 
  loadGangState 
} from "/lib/state.js";
import { getNFGFallbackFaction } from "/lib/utils/faction-helpers.js";

export async function main(ns: NS): Promise<void> {
  ns.print("🧬 Faction-Grinder Subsystem initialisiert.");

  while (true) {
    const factionState = loadFactionState(ns);

    if (!factionState || !factionState.targetFaction) {
      ns.print("⏳ Warte auf Zielvorgabe durch den Dispatcher...");
      await ns.sleep(2000);
      continue;
    }

    let faction: FactionName = factionState.targetFaction as FactionName;
    const player = ns.getPlayer();
    const sing = ns.singularity;
    const gangState = loadGangState(ns);

    // ------------------------------------------------------------------
    // 🔀 NFG / GANG REDIRECT LOGIK
    // ------------------------------------------------------------------
    const isGangFaction =
      (ns.gang.inGang() && ns.gang.getGangInformation().faction === faction) ||
      (gangState?.hasGang && gangState.gangFaction === faction);

    // Wenn das Ziel die eigene Gang-Fraktion ist ODER explizit NFG gefarmt wird:
    if (isGangFaction || factionState.isGrindingNFG) {
      const fallbackFaction = getNFGFallbackFaction(ns, gangState);

      if (faction !== fallbackFaction) {
        ns.print(`🔄 [NFG-REDIRECT] Gang/NFG-Ziel [${faction}] -> Nutze NFG-Provider [${fallbackFaction}]`);
        faction = fallbackFaction;
        patchFactionState(ns, { targetFaction: fallbackFaction });
      }
    }

    // ------------------------------------------------------------------
    // 🛡️ LOCKOUT CHECKS
    // ------------------------------------------------------------------
    const isTargetCity = CITY_FACTIONS.includes(faction);
    const currentCity = CITY_FACTIONS.find((c) => player.factions.includes(c));
    const isCityLocked = isTargetCity && currentCity && currentCity !== faction;

    if (isCityLocked) {
      ns.print(`🛑 [LOCKOUT] Stadt-Fraktion [${faction}] kollidiert mit [${currentCity}]. Setze Ziel zurück...`);
      patchFactionState(ns, { targetFaction: undefined });
      await ns.sleep(2000);
      continue;
    }

    // ------------------------------------------------------------------
    // 🤝 EINLADUNGEN AUTOMATISCH ANNEHMEN
    // ------------------------------------------------------------------
    if (!player.factions.includes(faction)) {
      const invites = sing.checkFactionInvitations();
      if (invites.includes(faction)) {
        ns.print(`📩 Nehme Einladung für NFG-Spender [${faction}] an...`);
        sing.joinFaction(faction);
      } else {
        ns.print(`⏳ Warte auf Beitritt/Einladung für NFG-Spender [${faction}]...`);
        await ns.sleep(2000);
        continue;
      }
    }

    // ------------------------------------------------------------------
    // 🚀 ARBEIT STARTEN & MELDEN
    // ------------------------------------------------------------------
    const currentWork = sing.getCurrentWork();
    const isWorkingCorrectly =
      currentWork &&
      currentWork.type === "FACTION" &&
      (currentWork as any).factionName === faction;

    if (!isWorkingCorrectly) {
      ns.print("🚀 Wechsle Arbeit auf Fraktion: " + faction);

      const started =
        sing.workForFaction(faction, ns.enums.FactionWorkType.hacking, false) ||
        sing.workForFaction(faction, ns.enums.FactionWorkType.field, false) ||
        sing.workForFaction(faction, ns.enums.FactionWorkType.security, false);

      if (!started) {
        ns.print(`⚠️ Konnte Arbeit für [${faction}] nicht starten.`);
      }
    }

    // State Aktualisierung über spezifischen Patcher
    const currentRep = sing.getFactionRep(faction);
    patchFactionState(ns, {
      factionCurrentReps: {
        ...(factionState.factionCurrentReps ?? {}),
        [faction]: currentRep,
      },
    });

    await ns.sleep(2000);
  }
}