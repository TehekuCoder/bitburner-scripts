import { NS, FactionName, CompanyName } from "@ns";
import { BotState } from "/shared/types/strategy.js";
import { renderProgressBar, hasSingularity } from "/lib/utils.js";
import { COLOR } from "../shared/constants/logger";
import { loadState, loadStrategyState } from "/infrastructure/state/state";

const BITNODE_PHASES = [
  "1. Bootstrapping",
  "2. Early Factions & Corps",
  "3. Karma Rush",
  "4. Gang Empire",
  "5. Non-Gang Augs",
  "6. Daedalus Prep",
  "7. World Daemon",
];

interface PhaseEvaluated {
  phaseIndex: number;
  phaseName: string;
  detail: string;
  progressPercent: number;
}

function evaluateBitNodePhase(ns: NS, state: BotState): PhaseEvaluated {
  const player = ns.getPlayer();
  const singularityAvailable = hasSingularity(ns);

  const ownedAugsInstalled = singularityAvailable
    ? ns.singularity.getOwnedAugmentations(false)
    : [];
  const ownedAugsAll = singularityAvailable
    ? ns.singularity.getOwnedAugmentations(true)
    : [];

  const ownedCount = ownedAugsInstalled.length;
  const remainingAugs = state.augRoadMap?.length ?? 0;
  const karma = ns.heart.break();

  const hasRedPillInstalled = ownedAugsInstalled.includes("The Red Pill");
  const hasRedPillPurchased = ownedAugsAll.includes("The Red Pill");
  const daemonExists = ns.serverExists("w0r1d_d43m0n");

  // Phase 7: World Daemon (Red Pill INSTALLIERT und Daemon existiert)
  if ((hasRedPillInstalled || daemonExists) && singularityAvailable) {
    let daemonReq = 3000;
    try {
      daemonReq = ns.getServerRequiredHackingLevel("w0r1d_d43m0n");
    } catch {
      // Fallback falls der Server-Level-Request in Edge-Cases fehlschlägt
    }

    const currentHack = player.skills.hacking;
    const progress = Math.min(100, (currentHack / daemonReq) * 100);
    return {
      phaseIndex: 7,
      phaseName: "World Daemon",
      detail: `Hack: ${currentHack} / ${daemonReq}`,
      progressPercent: progress,
    };
  }

  // Phase 6: Daedalus Prep (Roadmap abgearbeitet ODER Daedalus aktiv ODER Red Pill gekauft)
  const isDaedalusActive =
    state.targetFaction === "Daedalus" || player.factions.includes("Daedalus");
  const isRoadmapClear = remainingAugs === 0;

  if (
    hasRedPillPurchased ||
    isDaedalusActive ||
    (isRoadmapClear && (ownedCount >= 30 || player.money >= 100e9))
  ) {
    const hackProgress = (player.skills.hacking / 2500) * 100;
    const combatMin = Math.min(
      player.skills.strength,
      player.skills.defense,
      player.skills.dexterity,
      player.skills.agility,
    );
    const combatProgress = (combatMin / 1500) * 100;
    const bestProgress = Math.min(100, Math.max(hackProgress, combatProgress));

    const detailMsg = hasRedPillPurchased
      ? `⚠️ Red Pill gekauft! Ggf. Augs installieren (Reset)`
      : `Augs: ${ownedCount}/30 | Hack: ${player.skills.hacking}/2500 | Combat: ${combatMin}/1500`;

    return {
      phaseIndex: 6,
      phaseName: "Daedalus Prep",
      detail: detailMsg,
      progressPercent: hasRedPillPurchased ? 99 : bestProgress,
    };
  }

  // Phase 5: Non-Gang Augmentations (Gang existiert & Roadmap hat noch offene Augs)
  if (state.hasGang && remainingAugs > 0) {
    const progress = Math.min(99, Math.max(5, 100 - remainingAugs * 3));
    return {
      phaseIndex: 5,
      phaseName: "Non-Gang Augs",
      detail: `Roadmap Augs offen: ${remainingAugs} | Ziel: ${state.targetFaction || "Suchen..."}`,
      progressPercent: progress,
    };
  }

  // Phase 4: Gang Empire (Gang gegründet)
  if (state.hasGang) {
    return {
      phaseIndex: 4,
      phaseName: "Gang Empire",
      detail: `Gang aktiv (${state.gangFaction || "Unbekannt"})`,
      progressPercent: 100,
    };
  }

  // Phase 3: Karma Rush / Gang Unlock (Aktiv wenn Strategie KARMA oder CRIME ist)
  if (state.strategy === "KARMA" || state.strategy === "CRIME") {
    const karmaVal = Math.abs(karma);
    const progress = Math.min(100, (karmaVal / 54000) * 100);
    return {
      phaseIndex: 3,
      phaseName: "Karma Rush",
      detail: `Karma: ${karma.toFixed(0)} / -54,000`,
      progressPercent: progress,
    };
  }

  // Phase 2: Early Factions & Megacorps (Aktiv wenn Strategie REP oder COMPANY ist)
  if (state.strategy === "REP" || state.strategy === "COMPANY") {
    let detail = "";
    let progress = 50;

    if (state.strategy === "COMPANY") {
      const company = state.targetCompany || "N/A";
      detail = `Corp: ${company}`;

      if (state.targetCompany && singularityAvailable) {
        try {
          const currentRep = ns.singularity.getCompanyRep(
            state.targetCompany as CompanyName,
          );
          const targetRep =
            state.targetCompany === "Fulcrum Technologies" ? 250_000 : 400_000;
          progress = Math.min(100, (currentRep / targetRep) * 100);
          detail = `Corp: ${company} (${(currentRep / 1000).toFixed(0)}k / ${(targetRep / 1000).toFixed(0)}k Rep)`;
        } catch {
          progress = 0;
        }
      }
    } else {
      const faction = state.targetFaction || "N/A";
      detail = `Fraktion: ${faction}`;

      if (state.targetFaction && singularityAvailable) {
        try {
          const currentRep = ns.singularity.getFactionRep(
            state.targetFaction as FactionName,
          );
          const rawFactionTargets = (
            state as unknown as { factionTargets?: Record<string, number> }
          ).factionTargets;
          const targetRep =
            rawFactionTargets?.[state.targetFaction] ??
            (typeof state.targetStat === "number" ? state.targetStat : 0);

          if (targetRep > 0) {
            progress = Math.min(100, (currentRep / targetRep) * 100);
            detail = `Fraktion: ${faction} (${(currentRep / 1000).toFixed(0)}k / ${(targetRep / 1000).toFixed(0)}k Rep)`;
          }
        } catch {}
      }
    }

    return {
      phaseIndex: 2,
      phaseName: "Early Factions & Corps",
      detail,
      progressPercent: progress,
    };
  }

  // Phase 1: Bootstrapping / Fallback (MONEY, MANUAL, TRAIN, etc.)
  const hackTarget = 250;
  const hackProgress = Math.min(
    100,
    (player.skills.hacking / hackTarget) * 100,
  );
  const stratSuffix = state.strategy ? ` (${state.strategy})` : "";

  return {
    phaseIndex: 1,
    phaseName: "Bootstrapping",
    detail: `Hacking: ${player.skills.hacking} / ${hackTarget}${stratSuffix}`,
    progressPercent: hackProgress,
  };
}

function getNextManualStep(ns: NS, state: BotState): string {
  const player = ns.getPlayer();
  const karma = ns.heart.break();
  const singularityAvailable = hasSingularity(ns);

  const ownedAugsInstalled = singularityAvailable
    ? ns.singularity.getOwnedAugmentations(false)
    : [];
  const ownedAugsAll = singularityAvailable
    ? ns.singularity.getOwnedAugmentations(true)
    : [];

  const hasRedPillInstalled = ownedAugsInstalled.includes("The Red Pill");
  const hasRedPillPurchased = ownedAugsAll.includes("The Red Pill");

  if (hasRedPillInstalled || ns.serverExists("w0r1d_d43m0n")) {
    return "🚨 Hacke 'w0r1d_d43m0n' im Terminal zum Beenden des BitNodes!";
  }

  if (hasRedPillPurchased) {
    return "⚡ 'The Red Pill' ist gekauft! Installiere Augmentations (Reset), um 'w0r1d_d43m0n' freizuschalten.";
  }

  if (player.factions.includes("Daedalus")) {
    return "🎯 Kaufe 'The Red Pill' von Daedalus (Rep/Geld farmen falls nötig)!";
  }

  if (!state.hasGang) {
    if (karma <= -54000) {
      return "🚨 Gründe jetzt eine Gang im Faction-Tab!";
    }
    return `🔪 Treibe Karma via Slumgullion/Crime auf -54.000 (Aktuell: ${karma.toFixed(0)})`;
  }

  if (player.factions.length === 0) {
    if (player.skills.hacking >= 30) {
      return "📜 Nimm Einladung von CyberSec / CSEC an!";
    }
    return "💻 Hacking Level steigern für erste Faction-Invites.";
  }

  if (
    player.money >= 100e9 &&
    player.skills.hacking >= 2500 &&
    !player.factions.includes("Daedalus")
  ) {
    return "🏆 Warten auf Daedalus-Einladung (30 Augs ODER $100b + Hack 2500)!";
  }

  return "🔄 Rep bei Factions farmen & Augmentations manuell kaufen.";
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const flags = ns.flags([
    ["manual", false],
    ["m", false],
    ["auto", false],
    ["a", false],
  ]);

  ns.ui.openTail();
  ns.ui.resizeTail(600, 620);
  ns.ui.setTailTitle("BitOS - Roadmap Dashboard");

  const dividerHeader = `${COLOR.GRAY}=========================================================${COLOR.RESET}`;
  const dividerSub = `${COLOR.GRAY}---------------------------------------------------------${COLOR.RESET}`;

  while (true) {
    ns.clearLog();

    const state = loadState(ns);
    const roadState = loadStrategyState(ns);
    
    if (!state) {
      ns.print(
        `${COLOR.YELLOW}⚠️  [ROADMAP] Warte auf State-Port Initialisierung...${COLOR.RESET}`,
      );
      await ns.sleep(1000);
      continue;
    }

    const singularityAvailable = hasSingularity(ns);
    let isManual = false;
    let autoErrorMsg: string | null = null;

    if (flags.auto || flags.a) {
      if (!singularityAvailable) {
        isManual = true;
        autoErrorMsg =
          "❌ [--auto abgelehnt]: Singularity (SF4) nicht vorhanden!";
      } else {
        isManual = false;
      }
    } else if (flags.manual || flags.m) {
      isManual = true;
    } else {
      isManual =
        !singularityAvailable ||
        Boolean(state.manualMode || state.strategy === "MANUAL");
    }

    const currentPhase = evaluateBitNodePhase(ns, state);

    const modeBadge = isManual
      ? `${COLOR.YELLOW}[MANUELL]${COLOR.RESET}`
      : `${COLOR.GREEN}[AUTO-PILOT]${COLOR.RESET}`;

    ns.print(dividerHeader);
    ns.print(
      `  ${COLOR.BOLD}${COLOR.CYAN}🗺️  BITOS ROADMAP DASHBOARD | BN ${state.currentBitNode}.${state.currentBitNodeLevel}${COLOR.RESET} ${modeBadge}`,
    );
    ns.print(dividerHeader);

    if (autoErrorMsg) {
      ns.print(` ${COLOR.RED}${COLOR.BOLD}${autoErrorMsg}${COLOR.RESET}`);
      ns.print(
        ` ${COLOR.YELLOW}-> System schaltet erzwungen auf MANUELL um.${COLOR.RESET}`,
      );
      ns.print(dividerSub);
    }

    ns.print(` ${COLOR.BOLD}BITNODE PHASEN-FORTSCHRITT${COLOR.RESET}`);
    ns.print(dividerSub);

    BITNODE_PHASES.forEach((pName, idx) => {
      const pNum = idx + 1;
      let statusStr = `${COLOR.GRAY}  ${pName}${COLOR.RESET}`;

      if (pNum < currentPhase.phaseIndex) {
        statusStr = `${COLOR.GREEN}✓ ${pName}${COLOR.RESET}`;
      } else if (pNum === currentPhase.phaseIndex) {
        statusStr = `${COLOR.CYAN}${COLOR.BOLD}► ${pName} <= AKTIV${COLOR.RESET}`;
      }

      ns.print(` ${statusStr}`);
    });

    ns.print(dividerSub);
    ns.print(` ${COLOR.BOLD}AKTUELLE PHASEN-DETAILS${COLOR.RESET}`);
    ns.print(dividerSub);
    ns.print(
      ` Strategie:    ${COLOR.YELLOW}${state.strategy || "N/A"}${COLOR.RESET}`,
    );

    const targetLabel =
      state.strategy === "COMPANY" ? "Ziel-Corp:   " : "Ziel-Faction:";
    const targetValue =
      state.strategy === "COMPANY"
        ? state.targetCompany || "Keine"
        : state.targetFaction || "Keine";

    ns.print(` ${targetLabel} ${COLOR.CYAN}${targetValue}${COLOR.RESET}`);
    ns.print(` Status:       ${currentPhase.detail}`);
    ns.print(
      ` Fortschritt:  ${renderProgressBar(currentPhase.progressPercent)}`,
    );

    if (isManual) {
      ns.print(dividerSub);
      ns.print(
        ` ${COLOR.BOLD}${COLOR.YELLOW}💡 MANUELLE HANDLUNGSEMPFEHLUNG${COLOR.RESET}`,
      );
      ns.print(dividerSub);
      ns.print(` ${COLOR.BOLD}${getNextManualStep(ns, state)}${COLOR.RESET}`);
    }

    ns.print(dividerSub);
    ns.print(` ${COLOR.BOLD}SUBSYSTEM STATUS${COLOR.RESET}`);
    ns.print(dividerSub);
    ns.print(
      ` Batcher:      ${state.batchStrategy} (${state.batcherProgress || "Inaktiv"})`,
    );
    ns.print(
      ` Gang:         ${state.hasGang ? `${COLOR.GREEN}Aktiv (${state.gangPhase})${COLOR.RESET}` : `${COLOR.GRAY}Nicht gegründet${COLOR.RESET}`}`,
    );
    ns.print(` Finanzen:     ${state.financeProgress || "N/A"}`);
    ns.print(` Sleeve:       ${state.sleeveProgress || "N/A"}`);

    ns.print(dividerHeader);

    await ns.sleep(1000);
  }
}