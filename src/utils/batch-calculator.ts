import { NS, Server, Player } from "@ns";
import { DEFAULT_MULTIPLIERS } from "../lib/state.js";

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
  bnMults: any = DEFAULT_MULTIPLIERS, // 🔄 Multiplikatoren als optionaler Parameter hinzugefügt
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

  // 📊 Dynamische Weaken-Effektivität berechnen
  const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);

  // Weaken 1 Threads berechnen (für den Hack-Anteil)
  const hackSecIncrease = ns.hackAnalyzeSecurity(hackThreads);
  const weaken1Threads = Math.ceil(hackSecIncrease / weakenPotency); // 🔄 Nutzt jetzt weakenPotency

  // Server-Zustand nach Hack für die Grow-Berechnung simulieren
  server.moneyAvailable = server.moneyMax * (1 - hackThreads * pctPerThread);

  // Weaken 2 Threads berechnen (für den Grow-Anteil)
  const growThreads = ns.formulas.hacking.growThreads(server, player, server.moneyMax);
  const growSecIncrease = ns.growthAnalyzeSecurity(growThreads, targetName);
  const weaken2Threads = Math.ceil(growSecIncrease / weakenPotency); // 🔄 Nutzt jetzt weakenPotency

  // Laufzeiten ermitteln
  const tW = ns.formulas.hacking.weakenTime(server, player);
  const tG = ns.formulas.hacking.growTime(server, player);
  const tH = ns.formulas.hacking.hackTime(server, player);

  // Delays für das präzise H-W-G-W Timing berechnen
  const hackDelay = tW - spacer - tH;
  const weaken1Delay = 0;
  const growDelay = tW + spacer - tG;
  const weaken2Delay = spacer * 2;

  if (hackDelay < 0 || growDelay < 0) return null;

  // RAM-Kosten ermitteln (Pfade angepasst an deine standardmäßige Ordnerstruktur)
  const ramHack = ns.getScriptRam("tasks/hack.js");
  const ramGrow = ns.getScriptRam("tasks/grow.js");
  const ramWeaken = ns.getScriptRam("tasks/weaken.js");

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