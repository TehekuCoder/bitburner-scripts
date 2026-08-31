import { NS } from "@ns";
import { PATHS } from "/infrastructure/runtime/paths.js";
import {
  getExactBitNode,
  loadBnMults,
  formatMoney,
  formatRam,
  formatTime,
  hasSingularity,
  hasGang,
  hasSleeve,
  hasCorporation,
  hasBladeburner,
} from "/lib/utils.js";
import { loadStrategyState } from "/infrastructure/state/state.js";
import { StrategyState, BotStrategy } from "/shared/types/strategy.js";

const ANSI_REGEX = /\u001b\[[0-9;]*m/g;

const CLR = {
  RESET: "\u001b[0m",
  CYAN: "\u001b[36m",
  GREEN: "\u001b[32m",
  YELLOW: "\u001b[33m",
  RED: "\u001b[31m",
  GRAY: "\u001b[90m",
  WHITE_BOLD: "\u001b[1;37m",
  MAGENTA: "\u001b[35m",
};

function getVisibleLength(text: string): number {
  return text.replace(ANSI_REGEX, "").length;
}

function padANSI(
  text: string,
  visibleWidth: number,
  alignRight = false,
): string {
  const missing = Math.max(0, visibleWidth - getVisibleLength(text));
  const padding = " ".repeat(missing);
  return alignRight ? padding + text : text + padding;
}

function truncateANSI(text: string, maxWidth: number): string {
  if (getVisibleLength(text) <= maxWidth) return text;

  let visibleCount = 0;
  let result = "";
  let i = 0;

  while (i < text.length && visibleCount < maxWidth - 3) {
    if (text[i] === "\u001b") {
      const match = text.slice(i).match(/^(\u001b\[[0-9;]*m)/);
      if (match) {
        result += match[0];
        i += match[0].length;
        continue;
      }
    }
    result += text[i];
    visibleCount++;
    i++;
  }
  return result + "...\u001b[0m";
}

function makeProgressBar(value: number, max: number, width = 20): string {
  if (max <= 0) return "░".repeat(width);
  const ratio = Math.max(0, Math.min(value, max)) / max;
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

interface BitNodePhase {
  phaseNumber: number;
  name: string;
  description: string;
  targetProgress: number; // 0 bis 100
  isCompleted: boolean;
}

/**
 * Ermittelt die aktuelle globale Phase des BitNodes basierend auf dem Spielstatus.
 */
function evaluateBitNodePhase(
  ns: NS,
  playerHacking: number,
  karma: number,
  hasRedPill: boolean,
): BitNodePhase {
  if (hasRedPill || playerHacking >= 3000) {
    const daemonServer = ns.serverExists("w0r1d_d34th")
      ? ns.getServer("w0r1d_d34th")
      : null;
    const isHacked = daemonServer?.hasAdminRights ?? false;
    return {
      phaseNumber: 5,
      name: "WORLD DAEMON / ENDGAME",
      description: isHacked
        ? "W0r1d_d34th gehackt! BitNode zerstören."
        : "Hacken von w0r1d_d34th vorbereiten.",
      targetProgress: isHacked
        ? 100
        : Math.min(99, (playerHacking / 3000) * 100),
      isCompleted: isHacked,
    };
  }

  if (playerHacking >= 2500 || ns.singularity?.getFactionRep("Daedalus") > 0) {
    const daedalusRep = ns.singularity?.getFactionRep("Daedalus") ?? 0;
    const targetRep = 2.5e6;
    return {
      phaseNumber: 4,
      name: "DAEDALUS & RED PILL",
      description: "Reputation für Daedalus farmen & Red Pill kaufen.",
      targetProgress: Math.min(100, (daedalusRep / targetRep) * 100),
      isCompleted: daedalusRep >= targetRep,
    };
  }

  if (hasGang(ns) && ns.gang.inGang()) {
    return {
      phaseNumber: 3,
      name: "SYSTEM-EXPANSION (GANG / CORP)",
      description: "Fraktions-Augmentations & Systeme skalieren.",
      targetProgress: Math.min(100, (playerHacking / 2500) * 100),
      isCompleted: false,
    };
  }

  if (karma <= -54) {
    return {
      phaseNumber: 2,
      name: "FRAKTIONEN & GANG-START",
      description: "Gang gründen & erste Faction-Augmentations erwerben.",
      targetProgress: 100,
      isCompleted: true,
    };
  }

  return {
    phaseNumber: 1,
    name: "BOOTSTRAPPING & BOOTCAMP",
    description: "Geld & Karma aufbauen (-54 Karma für Gang).",
    targetProgress: Math.min(100, (Math.abs(karma) / 54) * 100),
    isCompleted: false,
  };
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.setTailTitle("🗺️ BIT-OS ROADMAP");
  ns.ui.resizeTail(640, 560);

  while (true) {
    ns.clearLog();
    const buffer: string[] = [];
    const W = 64;
    const H_LINE = `${CLR.GRAY}${"=".repeat(W)}${CLR.RESET}`;
    const D_LINE = `${CLR.GRAY}${"-".repeat(W)}${CLR.RESET}`;

    const player = ns.getPlayer();
    const exactBn = getExactBitNode(ns);
    const bnMults = loadBnMults(ns);
    const strategyState: StrategyState = loadStrategyState(ns) ?? {};

    // Heart Break / Karma
    const karma = (ns as any).heart?.break() ?? player.karma ?? 0;
    const kills = player.numPeopleKilled ?? 0;

    // Red Pill Status
    let hasRedPill = false;
    if (hasSingularity(ns)) {
      try {
        const ownedAugs = ns.singularity.getOwnedAugmentations(true);
        hasRedPill = ownedAugs.includes("The Red Pill");
      } catch {
        hasRedPill = false;
      }
    }

    const phase = evaluateBitNodePhase(
      ns,
      player.skills.hacking,
      karma,
      hasRedPill,
    );

    // ------------------------------------------------------------
    // 1. HEADER
    // ------------------------------------------------------------
    const bnStr = `BN ${exactBn.formatted}`;
    const headerTitle = `🗺️ BIT-OS ROADMAP & STRATEGY`;
    const headerContent = `${CLR.WHITE_BOLD}${padANSI(headerTitle, 40)}${CLR.RESET}| ${CLR.CYAN}${padANSI(bnStr, 20, true)}${CLR.RESET}`;

    buffer.push(H_LINE);
    buffer.push(headerContent);
    buffer.push(H_LINE);

    // ------------------------------------------------------------
    // 2. AKTUELLE STRATEGIE & FOKUS
    // ------------------------------------------------------------
    const activeMode: BotStrategy = strategyState.strategy ?? "MONEY";
    const modeStr = `${CLR.GREEN}${activeMode}${CLR.RESET}`;
    const manualStr = strategyState.manualMode
      ? `${CLR.YELLOW}[MANUELL]${CLR.RESET}`
      : `${CLR.CYAN}[AUTO]${CLR.RESET}`;

    buffer.push(`${CLR.WHITE_BOLD}AKTUELLE STRATEGIE:${CLR.RESET}`);
    buffer.push(
      `Modus:       ${padANSI(modeStr, 22)} | Steuerung: ${manualStr}`,
    );

    const targetFaction = strategyState.targetFaction ?? "Keine";
    const targetCompany = strategyState.targetCompany ?? "Keine";
    buffer.push(
      `Ziel-Faction:${padANSI(targetFaction, 22)} | Firma: ${targetCompany}`,
    );

    if (strategyState.isGrindingNFG) {
      buffer.push(
        `Sonder-Ziel: ${CLR.MAGENTA}NeuroFlux Governor Grinding aktiv!${CLR.RESET}`,
      );
    }

    buffer.push(D_LINE);

    // ------------------------------------------------------------
    // 3. BITNODE MEILENSTEIN & PHASEN-STATUS
    // ------------------------------------------------------------
    buffer.push(
      `${CLR.WHITE_BOLD}BITNODE-FORTSCHRITT (Phase ${phase.phaseNumber}/5):${CLR.RESET}`,
    );
    buffer.push(`Phase:       ${CLR.CYAN}${phase.name}${CLR.RESET}`);
    buffer.push(`Details:     ${phase.description}`);

    const progressBar = makeProgressBar(phase.targetProgress, 100, 24);
    const pctStr = `${phase.targetProgress.toFixed(1)}%`;
    buffer.push(
      `Fortschritt: [${CLR.GREEN}${progressBar}${CLR.RESET}] ${pctStr}`,
    );

    buffer.push(D_LINE);

    // ------------------------------------------------------------
    // 4. FREIGESCHALTETE SYSTEME & APIS
    // ------------------------------------------------------------
    buffer.push(`${CLR.WHITE_BOLD}SYSTEM- & API-STATUS:${CLR.RESET}`);

    const renderBadge = (label: string, active: boolean, detail?: string) => {
      const icon = active
        ? `${CLR.GREEN}[✓]${CLR.RESET}`
        : `${CLR.RED}[🔒]${CLR.RESET}`;
      const detailStr = detail ? `${CLR.GRAY}(${detail})${CLR.RESET}` : "";
      return `${icon} ${padANSI(label, 13)} ${detailStr}`;
    };

    const singBadge = renderBadge("Singularity", hasSingularity(ns));
    const gangBadge = renderBadge(
      "Gang",
      hasGang(ns) && ns.gang.inGang(),
      `Karma: ${karma.toFixed(1)}`,
    );
    buffer.push(`> ${singBadge} | ${gangBadge}`);

    const sleeveBadge = renderBadge(
      "Sleeves",
      hasSleeve(ns),
      hasSleeve(ns) ? `${ns.sleeve.getNumSleeves()} Stk.` : undefined,
    );
    const corpBadge = renderBadge(
      "Corporation",
      hasCorporation(ns) && ns.corporation.hasCorporation(),
    );
    buffer.push(`> ${sleeveBadge} | ${corpBadge}`);

    const bbBadge = renderBadge(
      "Bladeburner",
      hasBladeburner(ns) && ns.bladeburner.inBladeburner(),
    );
    const torBadge = renderBadge("Darkweb/TOR", ns.hasTorRouter());
    buffer.push(`> ${bbBadge} | ${torBadge}`);

    buffer.push(D_LINE);

    // ------------------------------------------------------------
    // 5. EMPFOHLENE NÄCHSTE SCHRITTE
    // ------------------------------------------------------------
    buffer.push(`${CLR.WHITE_BOLD}NÄCHSTE MEILENSTEINE:${CLR.RESET}`);

    const nextSteps: string[] = [];

    if (!ns.hasTorRouter()) {
      nextSteps.push("Kaufe TOR-Router für $200.0k");
    }
    if (karma > -54 && (!hasGang(ns) || !ns.gang.inGang())) {
      nextSteps.push(
        `Karma reduzieren für Gang-Gründung (Noch ${(54 + karma).toFixed(1)} Karma)`,
      );
    }
    if (kills < 30 && karma > -54) {
      nextSteps.push(`Homicide/Morde farmen (Aktuell: ${kills}/30 Kills)`);
    }
    if (hasSingularity(ns) && !hasRedPill) {
      nextSteps.push(
        "Daedalus-Einladung freischalten (30 Hacker-Level / $100m)",
      );
    }
    if (hasRedPill) {
      nextSteps.push(
        "World Daemon Server (w0r1d_d34th) hacken & BitNode beenden!",
      );
    }
    if (nextSteps.length === 0) {
      nextSteps.push("Fokus auf Reputations-Grind & Augmentation-Käufe.");
    }

    for (const step of nextSteps.slice(0, 3)) {
      buffer.push(`> ${CLR.YELLOW}${truncateANSI(step, 58)}${CLR.RESET}`);
    }

    buffer.push(H_LINE);

    ns.print(buffer.join("\n"));
    await ns.sleep(2000);
  }
}
