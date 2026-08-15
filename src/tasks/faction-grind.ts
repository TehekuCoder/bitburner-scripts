import { NS, FactionName } from "@ns";
import {
  loadFactionState,
  patchFactionState,
  loadGangState,
} from "/lib/state.js";
import { getNFGFallbackFaction } from "/lib/utils/faction-helpers.js";
import { CITY_FACTIONS } from "/lib/constants/factions";

const TIAN_DI_HUI_CITIES = ["Chongqing", "New Tokyo", "Ishima"] as const;

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

    // Nur umleiten, wenn das Ziel WIRKLICH die Gang-Fraktion ist
    if (
      isGangFaction ||
      (factionState.isGrindingNFG && faction === "CyberSec")
    ) {
      const fallbackFaction = getNFGFallbackFaction(ns, gangState);

      if (faction !== fallbackFaction) {
        ns.print(
          `🔄 [NFG-REDIRECT] Gang/NFG-Ziel [${faction}] -> Nutze NFG-Provider [${fallbackFaction}]`,
        );
        faction = fallbackFaction;
        patchFactionState(ns, { targetFaction: fallbackFaction });
      }
    }

    // ------------------------------------------------------------------
    // 🛡️ LOCKOUT CHECKS
    // ------------------------------------------------------------------
    const isTargetCity = CITY_FACTIONS.includes(faction);
    const currentCityFaction = CITY_FACTIONS.find((c) =>
      player.factions.includes(c),
    );
    const isCityLocked =
      isTargetCity && currentCityFaction && currentCityFaction !== faction;

    if (isCityLocked) {
      ns.print(
        `🛑 [LOCKOUT] Stadt-Fraktion [${faction}] kollidiert mit [${currentCityFaction}]. Setze Ziel zurück...`,
      );
      patchFactionState(ns, { targetFaction: undefined });
      await ns.sleep(2000);
      continue;
    }

    // ------------------------------------------------------------------
    // 🤝 AUTO-REISE & EINLADUNGEN ANNEHMEN
    // ------------------------------------------------------------------
    if (!player.factions.includes(faction)) {
      // Spezielle Trigger-Logik für Tian Di Hui Beitrittsvoraussetzungen
      if (faction === "Tian Di Hui") {
        const inValidCity = TIAN_DI_HUI_CITIES.includes(player.city as any);
        if (!inValidCity && player.money >= 200_000) {
          ns.print(`✈️ Reise nach Chongqing für Tian Di Hui Einladung...`);
          sing.travelToCity("Chongqing");
        }
      }

      const invites = sing.checkFactionInvitations();
      if (invites.includes(faction)) {
        ns.print(`📩 Nehme Einladung für [${faction}] an...`);
        sing.joinFaction(faction);
      } else {
        ns.print(`⏳ Warte auf Beitritt/Einladung für [${faction}]...`);
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
