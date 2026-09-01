import { NS, Server } from "@ns";
import { BatchStrategy } from "/shared/types/batcher";
import { loadBnMults } from "/lib/utils";

export interface TargetScore {
  hostname: string;
  score: number;
  maxMoney: number;
  minDifficulty: number;
  weakenTimeMs: number;
  requiredHackingLevel: number;
}

export function getAllServers(ns: NS): string[] {
  const visited = new Set<string>(["home"]);
  const queue = ["home"];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = ns.scan(current);

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return Array.from(visited);
}

export function evaluateTargets(
  ns: NS,
  strategy: BatchStrategy,
): TargetScore[] {
  const player = ns.getPlayer();
  const playerSkill = player.skills.hacking;
  const allServers = getAllServers(ns);
  const targets: TargetScore[] = [];

  // BitNode Multiplier mit sicheren Fallbacks laden
  let serverGrowthMult = 1.0;
  let scriptHackMoney = 1.0;
  let scriptHackMoneyGain = 1.0;

  try {
    const bnMults = loadBnMults(ns);
    serverGrowthMult = bnMults.ServerGrowthRate ?? 1.0;
    scriptHackMoney = bnMults.ScriptHackMoney ?? 1.0;
    scriptHackMoneyGain = bnMults.ScriptHackMoneyGain ?? 1.0;
  } catch {
    // Fallback auf Standardwerte (BitNode 1) bei Fehlern
  }

  for (const host of allServers) {
    if (
      host === "home" ||
      host.startsWith("cloud-") ||
      host.startsWith("hacknet-")
    )
      continue;
    if (!ns.hasRootAccess(host)) continue;

    const server = ns.getServer(host);
    const maxMoney = server.moneyMax ?? 0;
    const reqLevel = server.requiredHackingSkill ?? 1;

    if (maxMoney <= 0 || reqLevel > playerSkill) continue;

    const minDiff = server.minDifficulty ?? 1;
    const curDiff = server.hackDifficulty ?? 100;

    let weakenTime = 0;
    let chance = 0;

    if (ns.formulas?.hacking) {
      // 🟢 Exakte Berechnung via Formulas API
      const simulatedServer: Server = {
        ...server,
        hackDifficulty: minDiff,
        moneyAvailable: maxMoney,
      };
      weakenTime = ns.formulas.hacking.weakenTime(simulatedServer, player);
      chance = ns.formulas.hacking.hackChance(simulatedServer, player);
    } else {
      // 🟡 Fallback ohne Formulas.exe: Weaken-Zeit & Chance auf Min-Security umrechnen
      const currentWeakenTime = ns.getWeakenTime(host);
      weakenTime = currentWeakenTime * ((minDiff + 50) / (curDiff + 50));

      const reqHacking = Math.max(1, reqLevel);
      const skillMult = Math.max(
        0,
        (1.75 * playerSkill - reqHacking) / (1.75 * playerSkill),
      );
      const secMult = (100 - minDiff) / 100;
      chance = Math.min(1.0, Math.max(0.01, skillMult * secMult));
    }

    let score = 0;

    if (strategy === "WORKER") {
      const moneyFactor = maxMoney * scriptHackMoney * scriptHackMoneyGain;
      score = (moneyFactor * chance) / Math.max(1, weakenTime / 1000);
    } else {
      const effectiveGrowth = (server.serverGrowth ?? 1) * serverGrowthMult;
      score =
        ((maxMoney * (effectiveGrowth / 100) * scriptHackMoneyGain) /
          Math.max(1, weakenTime / 1000)) *
        Math.pow(chance, 2);
    }

    targets.push({
      hostname: host,
      score,
      maxMoney,
      minDifficulty: minDiff,
      weakenTimeMs: weakenTime,
      requiredHackingLevel: reqLevel,
    });
  }

  return targets.sort((a, b) => b.score - a.score);
}

export interface TargetSelectionOptions {
  /** Wie viel % besser der Score des neuen Ziels sein muss (z. B. 1.15 = 15% besser). Default: 1.15 */
  switchMargin?: number;
  /** Mindesthaltedauer in ms auf einem Ziel, bevor gewechselt werden darf. Default: 60000 (60s) */
  minHoldMs?: number;
}

export interface TargetSelectionResult {
  target: string | null;
  hasChanged: boolean;
  reason: string;
}

/**
 * Wählt das optimale Ziel aus der Liste der TargetScores aus und verhindert Target-Flapping
 * durch Hysterese (Score-Puffer) und eine Mindesthaltedauer.
 */
export function selectBestTarget(
  ns: NS,
  targets: TargetScore[],
  currentTarget: string | null,
  lastTargetChangeTime: number,
  options: TargetSelectionOptions = {},
): TargetSelectionResult {
  const switchMargin = options.switchMargin ?? 1.15;
  const minHoldMs = options.minHoldMs ?? 60_000;
  const now = Date.now();

  // Keine Ziele vorhanden
  if (targets.length === 0) {
    return {
      target: null,
      hasChanged: currentTarget !== null,
      reason: "Keine gültigen Ziele verfügbar.",
    };
  }

  const topTarget = targets[0]; // Höchster absoluter Score

  // 1. Erststart: Noch kein Ziel gewählt
  if (!currentTarget) {
    return {
      target: topTarget.hostname,
      hasChanged: true,
      reason: `Initiales Ziel gewählt: ${topTarget.hostname} (Score: ${topTarget.score.toFixed(2)})`,
    };
  }

  // 2. Das beste Ziel ist bereits aktiv
  if (topTarget.hostname === currentTarget) {
    return {
      target: currentTarget,
      hasChanged: false,
      reason: "Aktuelles Ziel ist weiterhin auf Platz 1.",
    };
  }

  // 3. Notfall: Hat das aktuelle Ziel Root-Rechte verloren?
  if (!ns.hasRootAccess(currentTarget)) {
    return {
      target: topTarget.hostname,
      hasChanged: true,
      reason: `Root-Zugriff auf ${currentTarget} verloren! Notfall-Wechsel zu ${topTarget.hostname}`,
    };
  }

  // 4. Mindesthaltedauer prüfen
  const timeOnCurrentTarget = now - lastTargetChangeTime;
  if (timeOnCurrentTarget < minHoldMs) {
    const remainingSec = ((minHoldMs - timeOnCurrentTarget) / 1000).toFixed(1);
    return {
      target: currentTarget,
      hasChanged: false,
      reason: `Sperrfrist aktiv (${remainingSec}s verbleibend). Behalte ${currentTarget}.`,
    };
  }

  // 5. Hysterese-Score-Vergleich
  const currentTargetEntry = targets.find((t) => t.hostname === currentTarget);
  const currentScore = currentTargetEntry?.score ?? 0;

  // Wenn das aktuelle Ziel gar nicht mehr in den qualifizierten Targets ist (z. B. Hacking-Req zu hoch), sofort wechseln
  if (!currentTargetEntry) {
    return {
      target: topTarget.hostname,
      hasChanged: true,
      reason: `Aktuelles Ziel ${currentTarget} qualifiziert sich nicht mehr. Wechsel zu ${topTarget.hostname}`,
    };
  }

  // Besser als der Score * Margin?
  if (topTarget.score > currentScore * switchMargin) {
    const gainPercent = (
      ((topTarget.score - currentScore) / currentScore) *
      100
    ).toFixed(1);
    return {
      target: topTarget.hostname,
      hasChanged: true,
      reason: `Ziel ${topTarget.hostname} ist ${gainPercent}% lukrativer als ${currentTarget} (übersteigt Margin von ${((switchMargin - 1) * 100).toFixed(0)}%).`,
    };
  }

  // Wenn die Abweichung zu gering ist, beim aktuellen Ziel bleiben
  return {
    target: currentTarget,
    hasChanged: false,
    reason: `Ziel ${topTarget.hostname} zwar besser als ${currentTarget}, aber unter der Wechsel-Schwelle von ${((switchMargin - 1) * 100).toFixed(0)}%.`,
  };
}
