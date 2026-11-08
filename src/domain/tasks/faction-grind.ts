import { NS, FactionName } from "@ns";

import {
  getJoinedCityFaction,
  getNFGFallbackFaction,
} from "../faction/faction-helpers.js";
import {
  loadFactionState,
  loadGangState,
  patchFactionState,
} from "/infrastructure/state/state";
import {
  CITY_FACTIONS,
  GANG_CANDIDATE_FACTIONS,
} from "/shared/constants/factions";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";

const TIAN_DI_HUI_CITIES = ["Chongqing", "New Tokyo", "Ishima"] as const;

export async function main(ns: NS): Promise<void> {
  const logger = new LoggerClient(ns, "FACTION-GRINDER", undefined, "INFO");
  let lastReportedTarget: FactionName | null = null;
  let lastReportedState: string | null = null;

  const reportState = (
    state: string,
    level: "INFO" | "WARN",
    message: string,
    context: Record<string, string | number | boolean | null | undefined> = {},
  ): void => {
    if (state === lastReportedState) return;
    lastReportedState = state;
    if (level === "WARN") {
      logger.warn(message, undefined, { context });
    } else {
      logger.info(message, undefined, { context });
    }
  };

  logger.info("Faction-Grinder gestartet.");
  ns.print("🧬 Faction-Grinder Subsystem initialisiert.");

  while (true) {
    const factionState = loadFactionState(ns);

    if (!factionState || !factionState.targetFaction) {
      reportState(
        "awaiting-target",
        "INFO",
        "Warte auf Zielvorgabe durch den Dispatcher.",
      );
      lastReportedTarget = null;
      ns.print("⏳ Warte auf Zielvorgabe durch den Dispatcher...");
      await ns.sleep(2000);
      continue;
    }

    let faction: FactionName = factionState.targetFaction as FactionName;
    const player = ns.getPlayer();
    const sing = ns.singularity;
    const gangState = loadGangState(ns);

    // 🛑 BLADEBURNER IGNORE CHECK
    if ((faction as string) === "Bladeburners") {
      ns.print(
        `🛑 [INVALID-TARGET] 'Bladeburners' nutzt eigenes Subsystem. Setze Ziel zurück...`,
      );
      reportState(
        `invalid-target:${faction}`,
        "WARN",
        "Bladeburners ist kein gültiges Fraktionsziel; Ziel wird zurückgesetzt.",
        { faction },
      );
      await patchFactionState(ns, { targetFaction: undefined });
      await ns.sleep(2000);
      continue;
    }

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
        logger.info(
          `NFG-Ziel wird von ${faction} auf ${fallbackFaction} umgeleitet.`,
          undefined,
          { context: { fromFaction: faction, toFaction: fallbackFaction } },
        );
        ns.print(
          `🔄 [NFG-REDIRECT] Gang/NFG-Ziel [${faction}] -> Nutze NFG-Provider [${fallbackFaction}]`,
        );
        faction = fallbackFaction;
        lastReportedTarget = fallbackFaction;
        await patchFactionState(ns, { targetFaction: fallbackFaction });
      }
    }

    if (lastReportedTarget !== faction) {
      logger.info(`Fraktionsziel gesetzt: ${faction}.`, undefined, {
        context: { faction },
      });
      lastReportedTarget = faction;
    }

    // ------------------------------------------------------------------
    // 🛑 PENDING GANG UNLOCK CHECK
    // ------------------------------------------------------------------
    const isPendingGangUnlock = !ns.gang.inGang() && player.karma <= -54000;
    if (isPendingGangUnlock && GANG_CANDIDATE_FACTIONS.includes(faction)) {
      reportState(
        `gang-unlock:${faction}`,
        "INFO",
        `Ruf-Grind für ${faction} pausiert, bis die Gang gegründet ist.`,
        { faction, karma: Math.round(player.karma) },
      );
      ns.print(
        `🛑 [GANG-WAIT] Fraktion [${faction}] ist ein Gang-Kandidat und Gang-Gründung steht aus (Karma: ${Math.round(player.karma)}). Stoppe Ruf-Grind!`,
      );
      await patchFactionState(ns, { targetFaction: undefined });
      await ns.sleep(2000);
      continue;
    }

    // ------------------------------------------------------------------
    // 🛡️ LOCKOUT CHECKS
    // ------------------------------------------------------------------
    const isTargetCity = CITY_FACTIONS.includes(faction);
    const currentCityFaction = getJoinedCityFaction(ns);
    const isCityLocked =
      isTargetCity && currentCityFaction && currentCityFaction !== faction;

    if (isCityLocked) {
      reportState(
        `city-lock:${faction}:${currentCityFaction}`,
        "WARN",
        `Stadt-Fraktion ${faction} ist durch ${currentCityFaction} gesperrt; Ziel wird zurückgesetzt.`,
        { faction, currentCityFaction },
      );
      ns.print(
        `🛑 [LOCKOUT] Stadt-Fraktion [${faction}] kollidiert mit [${currentCityFaction}]. Setze Ziel zurück...`,
      );
      await patchFactionState(ns, { targetFaction: undefined });
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
        reportState(
          `invitation:${faction}`,
          "INFO",
          `Warte auf Beitritt oder Einladung für ${faction}.`,
          { faction },
        );
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
        reportState(
          `work-failed:${faction}`,
          "WARN",
          `Fraktionsarbeit für ${faction} konnte nicht gestartet werden.`,
          { faction },
        );
        ns.print(`⚠️ Konnte Arbeit für [${faction}] nicht starten.`);
      } else {
        reportState(
          `working:${faction}`,
          "INFO",
          `Fraktionsarbeit für ${faction} gestartet.`,
          { faction },
        );
      }
    } else {
      reportState(
        `working:${faction}`,
        "INFO",
        `Fraktionsarbeit für ${faction} läuft.`,
        { faction },
      );
    }

    const currentRep = sing.getFactionRep(faction);
    await patchFactionState(ns, {
      factionCurrentReps: {
        ...(factionState.factionCurrentReps ?? {}),
        [faction]: currentRep,
      },
    });

    await ns.sleep(2000);
  }
}
