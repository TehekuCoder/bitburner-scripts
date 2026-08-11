import { NS, FactionName } from "@ns";
import { loadState } from "/lib/state.js";
import { BotState } from "/lib/types/strategy.js";

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
  const ownedAugs = ns.singularity.getOwnedAugmentations(false).length;
  const remainingAugs = state.augRoadMap?.length ?? 0;

  // Phase 7: World Daemon (Red Pill vorhanden)
  if (player.factions.includes("Daedalus" as FactionName)) {
    const allAugs = ns.singularity.getOwnedAugmentations(true);
    if (allAugs.includes("The Red Pill")) {
      // Fix: Korrekter Servername w0r1d_d43m0n
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

  // Phase 6: Daedalus Prep (Erst wenn Roadmap abgearbeitet ODER Daedalus explizit Ansprechpartner ist)
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
    // Dynamischer Fortschritt basierend auf verbleibenden Roadmap-Einträgen
    const progress = Math.min(99, Math.max(5, 100 - remainingAugs * 3));
    return {
      phaseIndex: 5,
      phaseName: "Non-Gang Augs",
      detail: `Roadmap Augs offen: ${remainingAugs} | Ziel: ${state.targetFaction || "Suchen..."}`,
      progressPercent: progress,
    };
  }

  // Phase 4: Gang Empire (Gang gegründet, Vorbereitung auf Non-Gang Augs läuft)
  if (state.hasGang) {
    return {
      phaseIndex: 4,
      phaseName: "Gang Empire",
      detail: `Gang aktiv (${state.gangFaction || "Unbekannt"})`,
      progressPercent: 100,
    };
  }

  // Phase 3: Karma Rush / Gang Unlock
  if (
    state.strategy === "KARMA" ||
    state.strategy === "CRIME" ||
    player.karma > -54000
  ) {
    const karmaVal = Math.abs(player.karma);
    const progress = Math.min(100, (karmaVal / 54000) * 100);
    return {
      phaseIndex: 3,
      phaseName: "Karma Rush",
      detail: `Karma: ${player.karma.toFixed(0)} / -54,000`,
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

  // Phase 1: Bootstrapping
  return {
    phaseIndex: 1,
    phaseName: "Bootstrapping",
    detail: `Hacking: ${player.skills.hacking} / 30`,
    progressPercent: Math.min(100, (player.skills.hacking / 30) * 100),
  };
}

/**
 * Erstellt einen visuellen Ladebalken
 */
function renderProgressBar(percent: number, width: number = 20): string {
  const safePercent = Math.max(0, Math.min(100, percent));
  const filled = Math.floor((safePercent / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${safePercent.toFixed(1)}%`;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.resizeTail(580, 480);
  ns.ui.setTailTitle("Roadmap");

  while (true) {
    ns.clearLog();

    const state = loadState(ns);

    if (!state) {
      ns.print("⚠️  [ROADMAP] Warte auf State-Port Initialisierung...");
      await ns.sleep(1000);
      continue;
    }

    const currentPhase = evaluateBitNodePhase(ns, state);

    // Header
    ns.print("=================================================");
    ns.print(
      `       🗺️  ROADMAP DASHBOARD | BN ${state.currentBitNode}.${state.currentBitNodeLevel}`,
    );
    ns.print("=================================================");

    // 1. Phasen-Übersicht
    ns.print("\n--- BITNODE PHASEN-FORTSCHRITT ---");
    BITNODE_PHASES.forEach((pName, idx) => {
      const pNum = idx + 1;
      let statusSymbol = "  "; // Ausstehend
      if (pNum < currentPhase.phaseIndex) {
        statusSymbol = "✓ "; // Abgeschlossen
      } else if (pNum === currentPhase.phaseIndex) {
        statusSymbol = "► "; // Aktiv
      }

      const activeTag = pNum === currentPhase.phaseIndex ? ` <= AKTIV` : "";
      ns.print(` ${statusSymbol}${pName}${activeTag}`);
    });

    // 2. Aktueller Fokus
    ns.print("\n--- AKTUELLE PHASEN-DETAILS ---");
    ns.print(`Strategie:    ${state.strategy}`);
    ns.print(`Ziel-Faction: ${state.targetFaction || "Keine"}`);
    ns.print(`Status:       ${currentPhase.detail}`);
    ns.print(
      `Fortschritt:  ${renderProgressBar(currentPhase.progressPercent)}`,
    );

    // 3. Subsystem Status
    ns.print("\n--- SUBSYSTEM STATUS ---");
    ns.print(
      `Batcher:      ${state.batchStrategy} (${state.batcherProgress || "Inaktiv"})`,
    );
    ns.print(
      `Gang:         ${state.hasGang ? `Aktiv (${state.gangPhase})` : "Nicht gegründet"}`,
    );
    ns.print(`Finanzen:     ${state.financeProgress || "N/A"}`);
    ns.print(`Sleeve:       ${state.sleeveProgress || "N/A"}`);

    ns.print("=================================================");

    await ns.sleep(1000);
  }
}
