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

// 📌 Globale Skriptpfade (Verhindert fatale RAM-Fehlkalkulationen durch Pfadmismatch)
const PATH_HACK = "/tasks/hack.js";
const PATH_GROW = "/tasks/grow.js";
const PATH_WEAKEN = "/tasks/weaken.js";

/**
 * Berechnet einen mathematisch präzisen HWGW-Batch-Plan unter Idealbedingungen.
 * 
 * @param ns Die Netscript-Umgebung
 * @param targetName Name des Zielservers
 * @param bnMults Aktuelle BitNode-Multiplikatoren für die Skalierung der Weaken-Potenz
 * @param hackPercent Prozentualer Anteil des Geldes, der entzogen werden soll (Gier-Faktor)
 * @param spacer Zeitlicher Sicherheitsabstand zwischen den Wellen-Einschlägen in ms
 */
export function calculateBatch(
  ns: NS,
  targetName: string,
  bnMults: any = DEFAULT_MULTIPLIERS,
  hackPercent = 0.04,
  spacer = 80 // Synchronisiert auf das Standardraster des Kernels
): BatchPlan | null {
  if (!ns.formulas || !ns.formulas.hacking) return null;

  const player: Player = ns.getPlayer();
  const server: Server = ns.getServer(targetName);

  if (!server.moneyMax || server.moneyMax <= 0) return null;

  // 1. Virtuellen Server auf Idealbedingungen setzen (Fundament des zyklischen Batchings)
  server.hackDifficulty = server.minDifficulty;
  server.moneyAvailable = server.moneyMax;

  // 2. Hack-Phase berechnen
  const pctPerThread = ns.formulas.hacking.hackPercent(server, player);
  if (pctPerThread <= 0) return null;

  let hackThreads = Math.floor(hackPercent / pctPerThread);
  if (hackThreads < 1) return null; 

  // 📊 Dynamische Weaken-Effektivität (BitNode-Skalierung einrechnen)
  const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);

  // 3. Weaken 1 Phase berechnen (Kompensation des Hack-Sicherheitsanstiegs)
  const hackSecIncrease = ns.hackAnalyzeSecurity(hackThreads);
  const weaken1Threads = Math.ceil(hackSecIncrease / weakenPotency);

  // 4. Server-Zustand für die anschließende Grow-Simulation modifizieren
  // Verhindert rechnerischen Absturz auf 0 Dollar bei aggressiven Gier-Faktoren
  server.moneyAvailable = Math.max(1, server.moneyMax * (1 - hackThreads * pctPerThread));

  // 5. Grow-Phase & Weaken 2 Phase berechnen (Kompensation des Grow-Sicherheitsanstiegs)
  const growThreads = Math.ceil(ns.formulas.hacking.growThreads(server, player, server.moneyMax));
  const growSecIncrease = ns.growthAnalyzeSecurity(growThreads, targetName);
  const weaken2Threads = Math.ceil(growSecIncrease / weakenPotency);

  // 6. Basislaufzeiten über das Formelsystem ermitteln
  const tW = ns.formulas.hacking.weakenTime(server, player);
  const tG = ns.formulas.hacking.growTime(server, player);
  const tH = ns.formulas.hacking.hackTime(server, player);

  // 7. Präzise Delays für das HWGW-Timing ermitteln (Desync-Präventionsraster)
  const hackDelay = tW - spacer - tH;
  const weaken1Delay = 0;
  const growDelay = tW + spacer - tG;
  const weaken2Delay = spacer * 2;

  // Failsafe: Falls die Serverlaufzeiten zu kurz für das Spacing-Raster sind
  if (hackDelay < 0 || growDelay < 0) return null;

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
    totalRam,
    executionTime: tW + spacer * 2,
  };
}