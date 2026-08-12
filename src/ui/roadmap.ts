import { NS, FactionName } from "@ns";
import { loadState } from "/lib/state.js";
import { BotState } from "/lib/types/strategy.js";

// ANSI-Farbcodes für konsistentes BitOS Dashboard Styling
const COLOR = {
  RESET: "\u001b[0m",
  RED: "\u001b[31m",
  GREEN: "\u001b[32m",
  YELLOW: "\u001b[33m",
  CYAN: "\u001b[36m",
  GRAY: "\u001b[90m",
  BOLD: "\u001b[1m",
};

const BITNODE_PHASES = [
  "1. Bootstrapping",
  "2. Early Factions",
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
  const ownedAugs = ns.singularity ? ns.singularity.getOwnedAugmentations(false).length : 0;
  const remainingAugs = state.augRoadMap?.length ?? 0;
  const karma = ns.heart.break();

  // Phase 7: World Daemon (Red Pill vorhanden)
  if (player.factions.includes("Daedalus" as FactionName) && ns.singularity) {
    const allAugs = ns.singularity.getOwnedAugmentations(true);
    if (allAugs.includes("The Red Pill")) {
      const daemonReq = ns.getServerRequiredHackingLevel("w0r1d_d43m0n");
      const currentHack = player.skills.hacking;
      const progress = Math.min(100, (currentHack / daemonReq) * 100);
      return {
        phaseIndex: 7,
        phaseName: "World Daemon",
        detail: `Hack: ${currentHack} / ${daemonReq}`,
        progressPercent: progress,
      };
    }
  }

  // Phase 6: Daedalus Prep (Roadmap abgearbeitet ODER Daedalus aktiv)
  const isDaedalusActive =
    state.targetFaction === "Daedalus" || player.factions.includes("Daedalus");
  const isRoadmapClear = remainingAugs === 0;

  if (
    isDaedalusActive ||
    (isRoadmapClear && (ownedAugs >= 30 || player.money >= 100e9))
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

    return {
      phaseIndex: 6,
      phaseName: "Daedalus Prep",
      detail: `Augs: ${ownedAugs}/30 | Hack: ${player.skills.hacking}/2500 | Combat: ${combatMin}/1500`,
      progressPercent: bestProgress,
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

  // Phase 3: Karma Rush / Gang Unlock (Sicherheits-Check via ns.heart.break)
  if (
    state.strategy === "KARMA" ||
    state.strategy === "CRIME" ||
    karma > -54000
  ) {
    const karmaVal = Math.abs(karma);
    const progress = Math.min(100, (karmaVal / 54000) * 100);
    return {
      phaseIndex: 3,
      phaseName: "Karma Rush",
      detail: `Karma: ${karma.toFixed(0)} / -54,000`,
      progressPercent: progress,
    };
  }

  // Phase 2: Early Factions
  if (state.strategy === "REP") {
    return {
      phaseIndex: 2,
      phaseName: "Early Factions",
      detail: `Fraktion: ${state.targetFaction || "N/A"}`,
      progressPercent: 50,
    };
  }

  // Phase 1: Bootstrapping / DOMINION
  const hackTarget = 30;
  const hackProgress = Math.min(100, (player.skills.hacking / hackTarget) * 100);
  const stratSuffix = state.strategy ? ` (${state.strategy})` : "";

  return {
    phaseIndex: 1,
    phaseName: "Bootstrapping",
    detail: `Hacking: ${player.skills.hacking} / ${hackTarget}${stratSuffix}`,
    progressPercent: hackProgress,
  };
}

/**
 * Erstellt einen visuellen Ladebalken mit Farbformatierung.
 */
function renderProgressBar(percent: number, width: number = 20): string {
  const safePercent = Math.max(0, Math.min(100, percent));
  const filled = Math.floor((safePercent / 100) * width);
  const empty = width - filled;
  const color = safePercent === 100 ? COLOR.GREEN : COLOR.CYAN;

  return `${color}[${"█".repeat(filled)}${"░".repeat(empty)}] ${safePercent.toFixed(1)}%${COLOR.RESET}`;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.resizeTail(600, 500);
  ns.ui.setTailTitle("BitOS - Roadmap Dashboard");

  const dividerHeader = `${COLOR.GRAY}=========================================================${COLOR.RESET}`;
  const dividerSub    = `${COLOR.GRAY}---------------------------------------------------------${COLOR.RESET}`;

  while (true) {
    ns.clearLog();

    const state = loadState(ns);

    if (!state) {
      ns.print(`${COLOR.YELLOW}⚠️  [ROADMAP] Warte auf State-Port Initialisierung...${COLOR.RESET}`);
      await ns.sleep(1000);
      continue;
    }

    const currentPhase = evaluateBitNodePhase(ns, state);

    // Header
    ns.print(dividerHeader);
    ns.print(`  ${COLOR.BOLD}${COLOR.CYAN}🗺️  BITOS ROADMAP DASHBOARD | BN ${state.currentBitNode}.${state.currentBitNodeLevel}${COLOR.RESET}`);
    ns.print(dividerHeader);

    // 1. Phasen-Übersicht
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

    // 2. Aktueller Fokus
    ns.print(dividerSub);
    ns.print(` ${COLOR.BOLD}AKTUELLE PHASEN-DETAILS${COLOR.RESET}`);
    ns.print(dividerSub);
    ns.print(` Strategie:    ${COLOR.YELLOW}${state.strategy || "N/A"}${COLOR.RESET}`);
    ns.print(` Ziel-Faction: ${COLOR.CYAN}${state.targetFaction || "Keine"}${COLOR.RESET}`);
    ns.print(` Status:       ${currentPhase.detail}`);
    ns.print(` Fortschritt:  ${renderProgressBar(currentPhase.progressPercent)}`);

    // 3. Subsystem Status
    ns.print(dividerSub);
    ns.print(` ${COLOR.BOLD}SUBSYSTEM STATUS${COLOR.RESET}`);
    ns.print(dividerSub);
    ns.print(` Batcher:      ${state.batchStrategy} (${state.batcherProgress || "Inaktiv"})`);
    ns.print(` Gang:         ${state.hasGang ? `${COLOR.GREEN}Aktiv (${state.gangPhase})${COLOR.RESET}` : `${COLOR.GRAY}Nicht gegründet${COLOR.RESET}`}`);
    ns.print(` Finanzen:     ${state.financeProgress || "N/A"}`);
    ns.print(` Sleeve:       ${state.sleeveProgress || "N/A"}`);

    ns.print(dividerHeader);

    await ns.sleep(1000);
  }
}