import { NS, Server } from "@ns";

interface TargetAnalysis {
  server: string;
  reqHack: number;
  maxMoney: number;
  curMoney: number;
  moneyRatio: number;
  minSec: number;
  curSec: number;
  secDelta: number;
  chance: number;
  weakenTimeMs: number;
  prepTimeMs: number;
  score: number;
  isPrepped: boolean;
}

export async function main(ns: NS): Promise<void> {
  const topCount = typeof ns.args[0] === "number" ? ns.args[0] : 10;
  const player = ns.getPlayer();
  const playerSkill = player.skills.hacking;
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  const servers = getAllServers(ns);
  const candidates: TargetAnalysis[] = [];

  for (const s of servers) {
    // Ausschlüsse: gekaufte Server, Hacknet, Home, ungerootete oder ohne Geld
    if (
      s.startsWith("hacknet-") ||
      s.startsWith("cloud-") ||
      s === "home" ||
      !ns.hasRootAccess(s)
    ) {
      continue;
    }

    const maxMoney = ns.getServerMaxMoney(s);
    const reqHack = ns.getServerRequiredHackingLevel(s);

    if (maxMoney <= 0 || reqHack > playerSkill) {
      continue;
    }

    const sObj = ns.getServer(s);
    const curMoney = sObj.moneyAvailable ?? 0;
    const curSec = sObj.hackDifficulty ?? 100;
    const minSec = sObj.minDifficulty ?? 10;
    const moneyRatio = maxMoney > 0 ? curMoney / maxMoney : 0;
    const secDelta = Math.max(0, curSec - minSec);

    let chance = 0;
    let minSecWeakenTime = 0;
    let prepTimeMs = 0;

    if (hasFormulas) {
      // 🟢 Exakte Berechnung via Formulas API
      const mockMinServer: Server = {
        ...sObj,
        hackDifficulty: minSec,
        moneyAvailable: maxMoney,
      };

      chance = ns.formulas.hacking.hackChance(mockMinServer, player);
      minSecWeakenTime = ns.formulas.hacking.weakenTime(mockMinServer, player);

      if (secDelta > 0.05 || moneyRatio < 0.98) {
        const currentWeakenTime = ns.formulas.hacking.weakenTime(sObj, player);
        const secCycles = secDelta > 0.05 ? Math.ceil(secDelta / 5) : 0;
        const growCycles =
          moneyRatio < 0.98 ? Math.ceil(Math.log2(1 / Math.max(0.001, moneyRatio))) : 0;
        prepTimeMs = (secCycles + growCycles) * currentWeakenTime;
      }
    } else {
      // 🟡 Näherung ohne Formulas.exe
      const reqHacking = Math.max(1, reqHack);
      const currentWeakenTime = ns.getWeakenTime(s);
      minSecWeakenTime = currentWeakenTime * ((minSec + 50) / (curSec + 50));

      const skillMult = Math.max(
        0,
        (1.75 * playerSkill - reqHacking) / (1.75 * playerSkill)
      );
      const secMult = (100 - minSec) / 100;
      chance = Math.min(1.0, Math.max(0.01, skillMult * secMult));

      if (secDelta > 0.05 || moneyRatio < 0.98) {
        const secCycles = secDelta > 0.05 ? Math.ceil(secDelta / 5) : 0;
        const growCycles =
          moneyRatio < 0.98 ? Math.ceil(Math.log2(1 / Math.max(0.001, moneyRatio))) : 0;
        prepTimeMs = (secCycles + growCycles) * currentWeakenTime;
      }
    }

    // Amortisation der Prep-Zeit über 50 Zyklen für fairen Score
    const AMORTIZATION_CYCLES = 50;
    const effectiveCycleTimeMs = minSecWeakenTime + prepTimeMs / AMORTIZATION_CYCLES;
    const score = (maxMoney * chance) / Math.max(1, effectiveCycleTimeMs / 1000);

    const isPrepped = secDelta <= 0.05 && moneyRatio >= 0.98;

    candidates.push({
      server: s,
      reqHack,
      maxMoney,
      curMoney,
      moneyRatio,
      minSec,
      curSec,
      secDelta,
      chance,
      weakenTimeMs: minSecWeakenTime,
      prepTimeMs,
      score,
      isPrepped,
    });
  }

  // Nach Score absteigend sortieren
  candidates.sort((a, b) => b.score - a.score);

  // Output
  const calcMode = hasFormulas ? "Formulas.exe" : "Estimation (kein Formulas)";
  ns.tprint(`\n========================================================================================`);
  ns.tprint(`🎯 ZIEL-ANALYSE RANGLISTE (Top ${Math.min(topCount, candidates.length)} von ${candidates.length} Servern)`);
  ns.tprint(`   Berechnungsmethode: ${calcMode} | Dein Hacking-Level: ${playerSkill}`);
  ns.tprint(`========================================================================================\n`);

  if (candidates.length === 0) {
    ns.tprint("❌ Keine geeigneten Ziele gefunden (alle außerhalb deiner Reichweite oder ohne Geld).");
    return;
  }

  for (let i = 0; i < Math.min(topCount, candidates.length); i++) {
    const c = candidates[i];
    const rank = `#${i + 1}`.padEnd(4);
    const name = c.server.padEnd(18);
    const scoreStr = `$${ns.format.number(c.score, 2)}/s`.padEnd(12);
    const maxMoneyStr = `$${ns.format.number(c.maxMoney, 2)}`.padEnd(10);
    const reqHackStr = `Lvl ${c.reqHack}`.padEnd(8);
    const chanceStr = `${(c.chance * 100).toFixed(0)}%`.padEnd(5);
    const weakenTimeStr = `${(c.weakenTimeMs / 1000).toFixed(1)}s`.padEnd(7);

    const statusStr = c.isPrepped
      ? "🟢 PREPPED"
      : `🟡 PREP BENÖTIGT (~${formatTime(c.prepTimeMs)}, Sec: +${c.secDelta.toFixed(1)}, Cash: ${(c.moneyRatio * 100).toFixed(0)}%)`;

    ns.tprint(`${rank} ${name} | Score: ${scoreStr} | Max$: ${maxMoneyStr} | Req: ${reqHackStr} | Chance: ${chanceStr} | Cycle: ${weakenTimeStr}`);
    ns.tprint(`     └ Status: ${statusStr}\n`);
  }

  const best = candidates[0];
  ns.tprint(`----------------------------------------------------------------------------------------`);
  ns.tprint(`🏆 EMPFEHLUNG: '${best.server}' hat aktuell den höchsten Ertrags-Score ($${ns.format.number(best.score, 2)}/s).`);
  ns.tprint(`----------------------------------------------------------------------------------------\n`);
}

function getAllServers(ns: NS): string[] {
  const visited = new Set<string>(["home"]);
  const queue: string[] = ["home"];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of ns.scan(current)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return Array.from(visited);
}

function formatTime(ms: number): string {
  if (ms <= 0) return "0s";
  const sec = Math.floor(ms / 1000) % 60;
  const min = Math.floor(ms / (1000 * 60));
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}