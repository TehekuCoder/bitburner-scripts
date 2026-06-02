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

export function calculateBatch(ns: NS, targetName: string, hackPercent = 0.04): BatchPlan | null {
  const player: Player = ns.getPlayer();
  // Wir klonen das Server-Objekt, um den "idealen" Zustand zu simulieren
  const server: Server = ns.getServer(targetName);
  
  if (!server.moneyMax || server.moneyMax <= 0) return null;

  // 1. Setze das simulierte Server-Objekt auf Idealbedingungen (Formulas braucht das)
  server.hackDifficulty = server.minDifficulty;
  server.moneyAvailable = server.moneyMax;

  // 2. Thread-Berechnungen
  const pctPerThread = ns.formulas.hacking.hackPercent(server, player);
  if (pctPerThread <= 0) return null;

  let hackThreads = Math.floor(hackPercent / pctPerThread);
  if (hackThreads < 1) hackThreads = 1;

  const hackSecIncrease = ns.hackAnalyzeSecurity(hackThreads, targetName);
  const weaken1Threads = Math.ceil(hackSecIncrease / 0.05);

  // Zustand nach dem Hack simulieren für korrekte Grow-Berechnung
  server.moneyAvailable = server.moneyMax * (1 - (hackThreads * pctPerThread));
  
  // Wie viele Grows braucht es, um von diesem reduzierten Stand wieder auf Max zu kommen?
  const growThreads = ns.formulas.hacking.growThreads(server, player, server.moneyMax);
  
  const growSecIncrease = ns.growthAnalyzeSecurity(growThreads, targetName);
  const weaken2Threads = Math.ceil(growSecIncrease / 0.05);

  // 3. Zeit- und Delay-Berechnungen (Spacer = 20ms)
  const spacer = 20;
  const tW = ns.formulas.hacking.weakenTime(server, player);
  const tG = ns.formulas.hacking.growTime(server, player);
  const tH = ns.formulas.hacking.hackTime(server, player);

  const hackDelay = tW - spacer - tH;
  const weaken1Delay = 0;
  const growDelay = tW + spacer - tG;
  const weaken2Delay = spacer * 2;

  // 4. RAM-Kosten prüfen (Dumb Worker RAM-Kosten)
  const ramHack = ns.getScriptRam("tasks/hack.js");
  const ramGrow = ns.getScriptRam("tasks/grow.js");
  const ramWeaken = ns.getScriptRam("tasks/weaken.js");

  const totalRam = (hackThreads * ramHack) +
                   (weaken1Threads * ramWeaken) +
                   (growThreads * ramGrow) +
                   (weaken2Threads * ramWeaken);

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
    executionTime: tW + (spacer * 2)
  };
}