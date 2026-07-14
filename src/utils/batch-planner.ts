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
  ns.disableLog("ALL");
  const bnMults = loadBnMults(ns);
  const currentState = loadState(ns);
  const shareBufferPercent =
    currentState?.fillerConfig?.shareMaxRamPercent || 0.0;

  // 1. Verfügbaren Netzwerk-RAM ermitteln
  const cachedServers = getAllServers(ns).sort(
    (a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a),
  );

  let totalUsableMaxRam = 0;
  for (const server of cachedServers) {
    if (!ns.hasRootAccess(server)) continue;
    let maxRam = ns.getServerMaxRam(server);
    if (server === "home") maxRam = Math.max(0, maxRam - HOME_RAM_RESERVE);
    if (server !== "home" && shareBufferPercent > 0) {
      maxRam = maxRam * (1 - shareBufferPercent);
    }
    totalUsableMaxRam += Math.floor(maxRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
  }

  // 2. Bestes Ziel ermitteln
  const target = findBestBatchTargetForNetwork(
    ns,
    cachedServers,
    totalUsableMaxRam,
    bnMults,
  );

  if (!target) {
    patchState(ns, {
      batcherTarget: undefined,
      batcherPlan: null,
    });
    return;
  }

  // 3. Perfekten Plan schmieden
  const serverMock = ns.getServer(target);
  serverMock.hackDifficulty = serverMock.minDifficulty;
  const weakenTime = ns.formulas!.hacking.weakenTime(
    serverMock,
    ns.getPlayer(),
  );

  const maxConcurrentBatches = Math.max(1, Math.floor(weakenTime / SPACER));
  const idealBatchRam = totalUsableMaxRam / maxConcurrentBatches;

  let largestSingleServerRam = 0;
  if (cachedServers.length > 0) {
    largestSingleServerRam = ns.getServerMaxRam(cachedServers[0]);
    if (cachedServers[0] === "home") {
      largestSingleServerRam = Math.max(
        0,
        largestSingleServerRam - HOME_RAM_RESERVE,
      );
    }
  }

  const maxAllowedBatchRam = Math.min(idealBatchRam, largestSingleServerRam);
  const dynamicMaxBatchesForTarget = Math.max(500, maxConcurrentBatches * 2);

  let currentGreedFactor = 0.9;
  let lockPlan = calculateBatch(
    ns,
    target,
    bnMults,
    currentGreedFactor,
    SPACER,
  ) as BatchPlan | null;

  // Iterative Gier-Reduktion
  while (
    (lockPlan === null || lockPlan.totalRam > maxAllowedBatchRam) &&
    currentGreedFactor > 0.005
  ) {
    currentGreedFactor -= 0.01;
    lockPlan = calculateBatch(
      ns,
      target,
      bnMults,
      currentGreedFactor,
      SPACER,
    ) as BatchPlan | null;
  }

  // Fallback auf den gesamten Pool
  if (!lockPlan || lockPlan.totalRam > totalUsableMaxRam) {
    currentGreedFactor = 0.4;
    lockPlan = calculateBatch(
      ns,
      target,
      bnMults,
      currentGreedFactor,
      SPACER,
    ) as BatchPlan | null;
    while (
      (lockPlan === null || lockPlan.totalRam > totalUsableMaxRam) &&
      currentGreedFactor > 0.005
    ) {
      currentGreedFactor -= 0.01;
      lockPlan = calculateBatch(
        ns,
        target,
        bnMults,
        currentGreedFactor,
        SPACER,
      ) as BatchPlan | null;
    }
  }

  // 4. Plan in State einfrieren
  if (lockPlan) {
    patchState(ns, {
      batcherTarget: target,
      batcherPlan: lockPlan,
      batcherDynamicMaxBatches: dynamicMaxBatchesForTarget,
    });
  } else {
    patchState(ns, {
      batcherTarget: undefined, // undefined matched 'string | undefined'
      batcherPlan: null, // Bleibt null, da batcherPlan?: any | null erlaubt
    });
  }
}

function findBestBatchTargetForNetwork(
  ns: NS,
  allServers: string[],
  totalNetworkRam: number,
  bnMults: any,
): string | null {
  const targets = allServers.filter(
    (s) => ns.hasRootAccess(s) && ns.getServerMaxMoney(s) > 0,
  );
  let bestTarget = null;
  let highestScore = 0;
  const playerHackLevel = ns.getHackingLevel();

  for (const s of targets) {
    if (ns.getServerRequiredHackingLevel(s) > playerHackLevel) continue;

    const testGreed = totalNetworkRam < 256 ? 0.01 : 0.1;
    let testPlan = calculateBatch(
      ns,
      s,
      bnMults,
      testGreed,
      SPACER,
    ) as BatchPlan | null;

    if (!testPlan || testPlan.totalRam > totalNetworkRam) continue;
    const idealExecutionTime = testPlan.executionTime;
    if (idealExecutionTime > DYNAMIC_MAX_WEAKEN_TIME) continue;

    const money = ns.getServerMaxMoney(s);
    const score = money / idealExecutionTime;
    if (score > highestScore) {
      highestScore = score;
      bestTarget = s;
    }
  }
  return bestTarget;
}
