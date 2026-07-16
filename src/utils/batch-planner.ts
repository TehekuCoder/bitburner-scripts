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
  // Wir aktivieren Log-Ausgaben für die manuelle Diagnose im Terminal
  ns.disableLog("getServerMaxRam");
  ns.disableLog("getServerUsedRam");

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
    ns.print("🚨 KRITISCH: Kein einziges Ziel im Netzwerk konnte validiert werden!");
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

  // 🟢 SAFED: Iterative Gier-Reduktion mit Schutz vor dem 0-Thread-Knick
  let lastValidPlan = lockPlan;
  while (currentGreedFactor > 0.005) {
    currentGreedFactor -= 0.01;
    const nextPlan = calculateBatch(
      ns,
      target,
      bnMults,
      currentGreedFactor,
      SPACER,
    ) as BatchPlan | null;

    if (nextPlan === null) {
      // Wenn das Verringern der Gier zu 0 Threads führt, brechen wir ab und behalten das letzte funktionierende Minimum
      break;
    }

    lockPlan = nextPlan;
    lastValidPlan = nextPlan;

    if (lockPlan.totalRam <= maxAllowedBatchRam) {
      break; // Plan passt in den Single-Server-Slot!
    }
  }
  
  if (lockPlan && lockPlan.totalRam > maxAllowedBatchRam && lastValidPlan) {
    lockPlan = lastValidPlan;
  }

  // 🟢 SAFED: Fallback auf den gesamten Pool (mit Schutz vor 0 Threads)
  if (!lockPlan || lockPlan.totalRam > totalUsableMaxRam) {
    currentGreedFactor = 0.4;
    lockPlan = calculateBatch(
      ns,
      target,
      bnMults,
      currentGreedFactor,
      SPACER,
    ) as BatchPlan | null;
    
    lastValidPlan = lockPlan;

    while (currentGreedFactor > 0.005) {
      currentGreedFactor -= 0.01;
      const nextPlan = calculateBatch(
        ns,
        target,
        bnMults,
        currentGreedFactor,
        SPACER,
      ) as BatchPlan | null;

      if (nextPlan === null) {
        break;
      }

      lockPlan = nextPlan;
      lastValidPlan = nextPlan;

      if (lockPlan.totalRam <= totalUsableMaxRam) {
        break; // Passt in den Gesamtpool!
      }
    }

    if (lockPlan && lockPlan.totalRam > totalUsableMaxRam && lastValidPlan) {
      lockPlan = lastValidPlan;
    }
  }

  // 4. Plan in State einfrieren
  if (lockPlan && lockPlan.totalRam <= totalUsableMaxRam) {
    ns.print(`🎯 Erfolg! Ziel gewählt: ${target} (${ns.format.ram(lockPlan.totalRam)} RAM pro Welle)`);
    patchState(ns, {
      batcherTarget: target,
      batcherPlan: lockPlan,
      batcherDynamicMaxBatches: dynamicMaxBatchesForTarget,
    });
  } else {
    ns.print(`🛑 FEHLER: Finaler Plan überschreitet immer noch das Gesamtnetzwerk-RAM.`);
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
  bnMults: any,
): string | null {
  const targets = allServers.filter(
    (s) => ns.hasRootAccess(s) && ns.getServerMaxMoney(s) > 0,
  );
  let bestTarget = null;
  let highestScore = 0;
  const playerHackLevel = ns.getHackingLevel();

  ns.print(`=== NETZWERK-DIAGNOSE ===`);
  ns.print(`Verfügbares Pool-RAM: ${ns.format.ram(totalNetworkRam)}`);

  if (totalNetworkRam <= 0) {
    ns.print("⚠️ WARNUNG: Usable Network-RAM ist 0 GB! Reserven oder Share-Percent prüfen!");
    return null;
  }

  for (const s of targets) {
    if (ns.getServerRequiredHackingLevel(s) > playerHackLevel) continue;

    const startGreed = totalNetworkRam < 256 ? 0.01 : 0.1;
    let testPlan: BatchPlan | null = null;

    // 🟢 DYNAMISCHE GIER-ANPASSUNG NACH OBEN
    // Falls die Gier so klein ist, dass 0 Threads entstehen, tasten wir uns hoch,
    // bis wir die mathematische Untergrenze für genau 1 Hack-Thread erreichen.
    for (let greed = startGreed; greed <= 0.95; greed += 0.05) {
      testPlan = calculateBatch(
        ns,
        s,
        bnMults,
        greed,
        SPACER,
      ) as BatchPlan | null;
      if (testPlan !== null) {
        break; // Mindestens 1 Hack-Thread gefunden!
      }
    }

    if (!testPlan) {
      ns.print(`[${s}] ❌ Übersprungen: Selbst bei 95% Gier kein gültiger Plan.`);
      continue;
    }

    if (testPlan.totalRam > totalNetworkRam) {
      ns.print(`[${s}] ❌ RAM-Limit: Benötigt ${ns.format.ram(testPlan.totalRam)} (Pool hat nur ${ns.format.ram(totalNetworkRam)})`);
      continue;
    }

    const idealExecutionTime = testPlan.executionTime;
    if (idealExecutionTime > DYNAMIC_MAX_WEAKEN_TIME) {
      ns.print(`[${s}] ❌ Zeitlimit: Laufzeit ${(idealExecutionTime / 1000 / 60).toFixed(1)} Min zu lang.`);
      continue;
    }

    const money = ns.getServerMaxMoney(s);
    const score = money / idealExecutionTime;
    
    ns.print(`[${s}]  Validiert! Score: ${ns.format.number(score)} (RAM: ${ns.format.ram(testPlan.totalRam)})`);

    if (score > highestScore) {
      highestScore = score;
      bestTarget = s;
    }
  }
  
  ns.print(`👑 Gewähltes Ziel: ${bestTarget || "KEINES"}`);
  return bestTarget;
}