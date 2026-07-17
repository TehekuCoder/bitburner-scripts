// utils/batch-planner.ts

import { NS } from "@ns";
import { calculateBatch, BatchPlan } from "./batch-calculator.js";
import { getAllServers } from "../lib/network.js";
import { patchState, loadState } from "../core/state-manager.js";
import { loadBnMults } from "../lib/state.js";

const HOME_RAM_RESERVE = 64;
const SCRIPT_RAM_BASE = 1.75;
const SPACER = 80;
const DYNAMIC_MAX_WEAKEN_TIME = 60 * 60 * 1000; // 60 Minuten

export async function main(ns: NS): Promise<void> {
  ns.disableLog("getServerMaxRam");
  ns.disableLog("getServerUsedRam");

  const bnMults = loadBnMults(ns);
  const currentState = loadState(ns);
  const shareBufferPercent = currentState?.fillerConfig?.shareMaxRamPercent || 0.0;

  // 1. Verfügbaren Netzwerk-RAM ermitteln
  const cachedServers = getAllServers(ns).sort(
    (a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a),
  );

  let totalUsableMaxRam = 0;
  let currentFreeRamPool = 0;

  for (const server of cachedServers) {
    if (!ns.hasRootAccess(server)) continue;
    
    let maxRam = ns.getServerMaxRam(server);
    let usedRam = ns.getServerUsedRam(server);

    if (server === "home") {
      maxRam = Math.max(0, maxRam - HOME_RAM_RESERVE);
      usedRam = Math.min(maxRam, usedRam);
    }

    let freeRam = Math.max(0, maxRam - usedRam);

    if (server !== "home" && shareBufferPercent > 0) {
      maxRam = maxRam * (1 - shareBufferPercent);
      freeRam = freeRam * (1 - shareBufferPercent);
    }

    totalUsableMaxRam += Math.floor(maxRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
    currentFreeRamPool += Math.floor(freeRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
  }

  // 2. Bestes Ziel ermitteln (Erzwinge Prüfung gegen AKTUELL FREIEN RAM)
  const target = findBestBatchTargetForNetwork(
    ns,
    cachedServers,
    totalUsableMaxRam,
    currentFreeRamPool,
    bnMults,
  );

  if (!target) {
    ns.print("🚨 KRITISCH: Kein Ziel passt in den aktuell freien RAM-Pool!");
    patchState(ns, {
      batcherTarget: undefined,
      batcherPlan: null,
    });
    return;
  }

  // 3. Perfekten Plan schmieden
  const serverMock = ns.getServer(target);
  serverMock.hackDifficulty = serverMock.minDifficulty;
  const weakenTime = ns.formulas!.hacking.weakenTime(serverMock, ns.getPlayer());

  const maxConcurrentBatches = Math.max(1, Math.floor(weakenTime / SPACER));
  const idealBatchRam = totalUsableMaxRam / maxConcurrentBatches;

  let largestSingleServerRam = 0;
  if (cachedServers.length > 0) {
    largestSingleServerRam = ns.getServerMaxRam(cachedServers[0]);
    if (cachedServers[0] === "home") {
      largestSingleServerRam = Math.max(0, largestSingleServerRam - HOME_RAM_RESERVE);
    }
  }

  // 🛑 HARD-CAP: Eine Welle darf NIEMALS größer sein als der freie RAM-Pool
  const maxAllowedBatchRam = Math.min(idealBatchRam, largestSingleServerRam, currentFreeRamPool);
  const dynamicMaxBatchesForTarget = Math.max(500, maxConcurrentBatches * 2);

  let currentGreedFactor = 0.9;
  let lockPlan = calculateBatch(ns, target, bnMults, currentGreedFactor, SPACER) as BatchPlan | null;

  let lastValidPlan = lockPlan;
  while (currentGreedFactor > 0.005) {
    currentGreedFactor -= 0.01;
    const nextPlan = calculateBatch(ns, target, bnMults, currentGreedFactor, SPACER) as BatchPlan | null;

    if (nextPlan === null) break;

    lockPlan = nextPlan;
    lastValidPlan = nextPlan;

    if (lockPlan.totalRam <= maxAllowedBatchRam) {
      break; // Plan passt perfekt in den Slot und den freien RAM!
    }
  }
  
  if (lockPlan && lockPlan.totalRam > maxAllowedBatchRam && lastValidPlan) {
    lockPlan = lastValidPlan;
  }

  // Fallback-Schleife ebenfalls gegen den freien Pool absichern
  if (!lockPlan || lockPlan.totalRam > currentFreeRamPool) {
    currentGreedFactor = 0.4;
    lockPlan = calculateBatch(ns, target, bnMults, currentGreedFactor, SPACER) as BatchPlan | null;
    lastValidPlan = lockPlan;

    while (currentGreedFactor > 0.005) {
      currentGreedFactor -= 0.01;
      const nextPlan = calculateBatch(ns, target, bnMults, currentGreedFactor, SPACER) as BatchPlan | null;

      if (nextPlan === null) break;

      lockPlan = nextPlan;
      lastValidPlan = nextPlan;

      if (lockPlan.totalRam <= currentFreeRamPool) {
        break; 
      }
    }

    if (lockPlan && lockPlan.totalRam > currentFreeRamPool && lastValidPlan) {
      lockPlan = lastValidPlan;
    }
  }

  // 4. Plan in State einfrieren
  if (lockPlan && lockPlan.totalRam <= currentFreeRamPool) {
    ns.print(`🎯 Erfolg! Ziel gewählt: ${target} (${ns.format.ram(lockPlan.totalRam)} RAM pro Welle)`);
    patchState(ns, {
      batcherTarget: target,
      batcherPlan: lockPlan,
      batcherDynamicMaxBatches: dynamicMaxBatchesForTarget,
    });
  } else {
    ns.print(`🛑 FEHLER: Finaler Plan überschreitet den freien RAM-Pool immer noch.`);
    patchState(ns, {
      batcherTarget: undefined,
      batcherPlan: null,
    });
  }
}

function findBestBatchTargetForNetwork(
  ns: NS,
  allServers: string[],
  totalNetworkRam: number,
  currentFreeRamPool: number,
  bnMults: any,
): string | null {
  const targets = allServers.filter(
    (s) => ns.hasRootAccess(s) && ns.getServerMaxMoney(s) > 0,
  );
  let bestTarget = null;
  let highestScore = 0;
  const playerHackLevel = ns.getHackingLevel();

  ns.print(`=== NETZWERK-DIAGNOSE ===`);
  ns.print(`Maximaler Pool-RAM: ${ns.format.ram(totalNetworkRam)}`);
  ns.print(`Aktuell freier RAM: ${ns.format.ram(currentFreeRamPool)}`);

  if (currentFreeRamPool <= 0) return null;

  for (const s of targets) {
    if (ns.getServerRequiredHackingLevel(s) > playerHackLevel) continue;

    // Defensiver Start-Gierfaktor im Early Game
    const startGreed = currentFreeRamPool < 256 ? 0.01 : 0.1;
    let testPlan: BatchPlan | null = null;

    for (let greed = startGreed; greed <= 0.95; greed += 0.05) {
      testPlan = calculateBatch(ns, s, bnMults, greed, SPACER) as BatchPlan | null;
      if (testPlan !== null) break; 
    }

    if (!testPlan) continue;

    // 🛑 DER REAL-TIME FILTER:
    // Wenn die absolute Minimalwelle (1 Hack-Thread) größer ist als das, was JETZT gerade frei ist,
    // überspringen wir den Server rigoros.
    if (testPlan.totalRam > currentFreeRamPool) {
      ns.print(`[${s}] ❌ RAM-Mangel: Mindestwelle benötigt ${ns.format.ram(testPlan.totalRam)} (Frei: ${ns.format.ram(currentFreeRamPool)})`);
      continue;
    }

    const idealExecutionTime = testPlan.executionTime;
    if (idealExecutionTime > DYNAMIC_MAX_WEAKEN_TIME) continue;

    const money = ns.getServerMaxMoney(s);
    const score = money / idealExecutionTime;
    
    ns.print(`[${s}] ✅ Validiert! Score: ${ns.format.number(score)} (RAM: ${ns.format.ram(testPlan.totalRam)})`);

    if (score > highestScore) {
      highestScore = score;
      bestTarget = s;
    }
  }
  
  ns.print(`👑 Gewähltes Ziel: ${bestTarget || "KEINES"}`);
  return bestTarget;
}