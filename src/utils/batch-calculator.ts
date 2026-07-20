import { NS, Server, Player } from "@ns";
import { DEFAULT_MULTIPLIERS, PATH_GROW, PATH_HACK, PATH_WEAKEN, SPACER } from "../lib/constants.js";
import { BatchPlan } from "../core/types";

/**
 * Berechnet einen mathematisch präzisen HWGW-Batch-Plan über Bitburner Formulas.
 */
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

  const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);

  // 3. Weaken 1 Phase (Hack-Security ausgleichen)
  const hackSecIncrease = hackThreads * 0.002;
  // +1 Thread Puffer gegen Rundungsfehler
  const weaken1Threads = Math.ceil(hackSecIncrease / weakenPotency) + 1;

  // 4. Server-Zustand für Grow-Simulation modifizieren
  const moneyAfterHack = Math.max(1, server.moneyMax * (1 - hackThreads * pctPerThread));
  server.moneyAvailable = moneyAfterHack;

  // 5. Grow- & Weaken 2 Phase
  const rawGrowThreads = ns.formulas.hacking.growThreads(server, player, server.moneyMax);
  if (rawGrowThreads === Infinity || isNaN(rawGrowThreads)) return null;

  // 🛡️ PUFFER: +2 Extra-Threads garantieren, dass der Server WIRKLICH wieder bei 100% landet
  const growThreads = Math.ceil(rawGrowThreads) + 2;

  const growSecIncrease = growThreads * 0.004;
  // +1 Thread Puffer gegen Rundungsfehler
  const weaken2Threads = Math.ceil(growSecIncrease / weakenPotency) + 1;

  // 6. Basislaufzeiten ermitteln (bei minSec!)
  server.hackDifficulty = server.minDifficulty;
  const tW = ns.formulas.hacking.weakenTime(server, player);
  const tG = ns.formulas.hacking.growTime(server, player);
  const tH = ns.formulas.hacking.hackTime(server, player);

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
    executionTime: tW + spacer * 2,
  };
}