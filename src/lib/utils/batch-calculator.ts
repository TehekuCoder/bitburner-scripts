import { NS, Server, Player } from "@ns";
import { BatchPlan } from "/shared/types/batcher.js";
import { SPACER, PATH_HACK, PATH_GROW, PATH_WEAKEN } from "../../infrastructure/runtime/batcher";
import { DEFAULT_MULTIPLIERS } from "/shared/constants/game-defaults";

export function calculateBatch(
  ns: NS,
  targetName: string,
  bnMults: any = DEFAULT_MULTIPLIERS,
  hackPercent = 0.04,
  spacer = SPACER,
): BatchPlan | null {
  if (!ns.formulas || !ns.formulas.hacking) return null;

  const player: Player = ns.getPlayer();
  const server: Server = ns.getServer(targetName);

  if (!server.moneyMax || server.moneyMax <= 0) return null;

  // 1. Virtuellen Server auf Idealbedingungen setzen
  server.hackDifficulty = server.minDifficulty;
  server.moneyAvailable = server.moneyMax;

  // 2. Hack-Phase berechnen
  const pctPerThread = ns.formulas.hacking.hackPercent(server, player);
  if (pctPerThread <= 0) return null;

  let hackThreads = Math.floor(hackPercent / pctPerThread);
  if (hackThreads < 1) return null;

  // Weaken-Rate benötigt das BitNode-Multiplier-Verhältnis (Standard 0.05 pro Thread)
  const weakenRate = bnMults?.ServerWeakenRate ?? 1.0;
  const weakenPotency = 0.05 * weakenRate;

  // 3. Weaken 1 Phase
  const hackSecIncrease = hackThreads * 0.002;
  const weaken1Threads = Math.ceil((hackSecIncrease - 1e-9) / weakenPotency) + 1;

  // 4. Server-Zustand für Grow-Simulation modifizieren
  const actualStolenPct = Math.min(0.99, hackThreads * pctPerThread);
  server.moneyAvailable = Math.max(1, server.moneyMax * (1 - actualStolenPct));

  // 5. Grow-Phase (ns.formulas beachtet ServerGrowthRate bereits intern!)
  const rawGrowThreads = ns.formulas.hacking.growThreads(
    server,
    player,
    server.moneyMax,
  );
  if (rawGrowThreads === Infinity || isNaN(rawGrowThreads) || rawGrowThreads <= 0) return null;

  const growThreads = Math.ceil(rawGrowThreads) + 2;
  const growSecIncrease = growThreads * 0.004;
  const weaken2Threads = Math.ceil((growSecIncrease - 1e-9) / weakenPotency) + 1;

  // 6. Laufzeiten ermitteln
  server.hackDifficulty = server.minDifficulty;
  const tW = Math.round(ns.formulas.hacking.weakenTime(server, player));
  const tG = Math.round(ns.formulas.hacking.growTime(server, player));
  const tH = Math.round(ns.formulas.hacking.hackTime(server, player));

  // 7. Relativer Versatz
  const hackDelay = tW - spacer - tH;
  const weaken1Delay = 0;
  const growDelay = tW + spacer - tG;
  const weaken2Delay = spacer * 2;

  if (hackDelay < 0 || growDelay < 0 || tW <= 0) return null;

  // 8. RAM-Kosten
  const ramHack = ns.getScriptRam(PATH_HACK);
  const ramGrow = ns.getScriptRam(PATH_GROW);
  const ramWeaken = ns.getScriptRam(PATH_WEAKEN);

  const totalRam =
    hackThreads * ramHack +
    weaken1Threads * ramWeaken +
    growThreads * ramGrow +
    weaken2Threads * ramWeaken;

  return {
    target: targetName,
    hackThreads,
    weaken1Threads,
    growThreads,
    weaken2Threads,
    hackDelay,
    weaken1Delay,
    growDelay,
    weaken2Delay,
    hackTime: tH,
    growTime: tG,
    weakenTime: tW,
    totalRam,
    batchRam: totalRam,
    executionTime: tW + spacer * 2,
  };
}