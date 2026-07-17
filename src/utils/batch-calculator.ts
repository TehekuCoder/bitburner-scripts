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
  // 🟢 NEU FÜR JIT: Puren Laufzeiten für die absolute Terminplanung
  hackTime: number;
  growTime: number;
  weakenTime: number;
  totalRam: number;
  executionTime: number;
}

const PATH_HACK = "/tasks/hack.js";
const PATH_GROW = "/tasks/grow.js";
const PATH_WEAKEN = "/tasks/weaken.js";

/**
 * Berechnet einen mathematisch präzisen HWGW-Batch-Plan unter Idealbedingungen.
 */
export function calculateBatch(
  ns: NS,
  targetName: string,
  bnMults: any = DEFAULT_MULTIPLIERS,
  hackPercent = 0.04,
  spacer = 80 
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

  // 📊 Dynamische Weaken-Effektivität
  const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);

  // 3. Weaken 1 Phase berechnen
  const hackSecIncrease = ns.hackAnalyzeSecurity(hackThreads);
  const weaken1Threads = Math.ceil(hackSecIncrease / weakenPotency);

  // 4. Server-Zustand für Grow-Simulation modifizieren
  server.moneyAvailable = Math.max(1, server.moneyMax * (1 - hackThreads * pctPerThread));

  // 5. Grow-Phase & Weaken 2 Phase berechnen
  const growThreads = Math.ceil(ns.formulas.hacking.growThreads(server, player, server.moneyMax));
  const growSecIncrease = ns.growthAnalyzeSecurity(growThreads, targetName);
  const weaken2Threads = Math.ceil(growSecIncrease / weakenPotency);

  // 6. Basislaufzeiten über das Formelsystem ermitteln
  const tW = ns.formulas.hacking.weakenTime(server, player);
  const tG = ns.formulas.hacking.growTime(server, player);
  const tH = ns.formulas.hacking.hackTime(server, player);

  // 7. Präzise Delays (Bleiben für Legacy-Zwecke oder relative Berechnungen erhalten)
  const hackDelay = tW - spacer - tH;
  const weaken1Delay = 0;
  const growDelay = tW + spacer - tG;
  const weaken2Delay = spacer * 2;

  // 🔴 JIT-ANPASSUNG: growDelay < 0 bleibt ein Failsafe, aber ein negatives hackDelay 
  // ist für den JIT-Scheduler kein Problem mehr, da wir echte Timestamps nutzen!
  if (growDelay < 0 || tW <= 0) return null;

  // 8. Atomare RAM-Kosten exakt ermitteln
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
    // 🟢 NEU FÜR JIT: Werte direkt in den Plan schreiben
    hackTime: tH,
    growTime: tG,
    weakenTime: tW,
    totalRam,
    executionTime: tW + spacer * 2,
  };
}