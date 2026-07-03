import { NS, Server, Player } from "@ns";

export interface BatchPlan {
  target: string;
  hackThreads: number;
  weaken1Threads: number;
  growThreads: number;
  weaken2Threads: number;
  hackDelay: number;
  weaken1Delay: number;
  growDelay: number;
  weaken2Delay: number;
  totalRam: number;
  executionTime: number;
}

export function calculateBatch(
  ns: NS,
  targetName: string,
  hackPercent = 0.04,
  spacer = 40
): BatchPlan | null {
  if (!ns.formulas || !ns.formulas.hacking) return null;

  const player: Player = ns.getPlayer();
  const server: Server = ns.getServer(targetName);

  if (!server.moneyMax || server.moneyMax <= 0) return null;

  // 1. Setze das simulierte Server-Objekt auf Idealbedingungen
  server.hackDifficulty = server.minDifficulty;
  server.moneyAvailable = server.moneyMax;

  const pctPerThread = ns.formulas.hacking.hackPercent(server, player);
  if (pctPerThread <= 0) return null;

  let hackThreads = Math.floor(hackPercent / pctPerThread);
  if (hackThreads < 1) return null; 

  // KORREKTUR: Veraltete Signatur entfernt. hackAnalyzeSecurity nutzt nur noch Threads.
  const hackSecIncrease = ns.hackAnalyzeSecurity(hackThreads);
  const weaken1Threads = Math.ceil(hackSecIncrease / 0.05);

  server.moneyAvailable = server.moneyMax * (1 - hackThreads * pctPerThread);

  const growThreads = ns.formulas.hacking.growThreads(server, player, server.moneyMax);
  const growSecIncrease = ns.growthAnalyzeSecurity(growThreads, targetName);
  const weaken2Threads = Math.ceil(growSecIncrease / 0.05);

  const tW = ns.formulas.hacking.weakenTime(server, player);
  const tG = ns.formulas.hacking.growTime(server, player);
  const tH = ns.formulas.hacking.hackTime(server, player);

  const hackDelay = tW - spacer - tH;
  const weaken1Delay = 0;
  const growDelay = tW + spacer - tG;
  const weaken2Delay = spacer * 2;

  if (hackDelay < 0 || growDelay < 0) return null;

  const ramHack = ns.getScriptRam("/tasks/hack.js");
  const ramGrow = ns.getScriptRam("/tasks/grow.js");
  const ramWeaken = ns.getScriptRam("/tasks/weaken.js");

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
    totalRam,
    executionTime: tW + spacer * 2,
  };
}