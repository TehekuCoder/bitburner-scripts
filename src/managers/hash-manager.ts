import { NS } from "@ns";
import { loadBatcherState } from "/lib/state.js";
import { TargetSummary } from "/lib/types/batcher.js";

const CONFIG = {
  capacityThreshold: 0.85,
  maxMoneyCap: 1e13, // $10T
};

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("[Hash-Manager] Manager gestartet...");

  while (true) {
    const currentHashes = ns.hacknet.numHashes();
    const capacity = ns.hacknet.hashCapacity();

    if (
      currentHashes >= capacity * CONFIG.capacityThreshold ||
      currentHashes >= capacity - 20
    ) {
      processHashSpendsLoop(ns);
    }

    await ns.sleep(500);
  }
}

function processHashSpendsLoop(ns: NS): void {
  while (ns.hacknet.numHashes() >= 4) {
    const spent = spendSingleHashPriority(ns);
    if (!spent) break;
  }
}

function spendSingleHashPriority(ns: NS): boolean {
  const hashes = ns.hacknet.numHashes();

  // 1. CORPORATION RESEARCH ("Corporation" ausschreiben)
  if (ns.corporation?.hasCorporation() && hashes >= 200) {
    if (ns.hacknet.spendHashes("Exchange for Corporation Research")) {
      ns.print("🧪 Hashes in Corp Research investiert.");
      return true;
    }
  }

  // 2. BLADEBURNER
  if (ns.bladeburner?.inBladeburner() && hashes >= 250) {
    if (ns.hacknet.spendHashes("Exchange for Bladeburner SP")) {
      ns.print("⚔️ Hashes in Bladeburner SP investiert.");
      return true;
    }
    if (ns.hacknet.spendHashes("Exchange for Bladeburner Rank")) {
      ns.print("🎖️ Hashes in Bladeburner Rank investiert.");
      return true;
    }
  }

  // 3. AKTIVE BATCHER-ZIELE BUFFEN
  const activeTargets = getActiveBatcherTargets(ns);

  for (const target of activeTargets) {
    const minSec = ns.getServerMinSecurityLevel(target);
    if (minSec > 1 && hashes >= 50) {
      if (ns.hacknet.spendHashes("Reduce Minimum Security", target)) {
        ns.print(`📉 Min-Sec für ${target} gesenkt.`);
        return true;
      }
    }

    const maxMoney = ns.getServerMaxMoney(target);
    if (maxMoney < CONFIG.maxMoneyCap && hashes >= 50) {
      if (ns.hacknet.spendHashes("Increase Maximum Money", target)) {
        ns.print(`💰 Max-Money für ${target} erhöht.`);
        return true;
      }
    }
  }

  // 4. FALLBACK: Bargeld
  if (hashes >= 4) {
    const amountToSpend = Math.floor(hashes / 4);
    if (ns.hacknet.spendHashes("Sell for Money", "", amountToSpend)) {
      return true;
    }
  }

  return false;
}

function getActiveBatcherTargets(ns: NS): string[] {
  // loadBatcherState nutzen & Parameter 't' explizit typisieren
  const batcherState = loadBatcherState(ns);
  
  if (batcherState?.batcherTargetsSummary && batcherState.batcherTargetsSummary.length > 0) {
    return batcherState.batcherTargetsSummary.map((t: TargetSummary) => t.target);
  }

  const fallback = getHighestValueServer(ns);
  return fallback ? [fallback] : [];
}

function getHighestValueServer(ns: NS): string | null {
  const playerHack = ns.getHackingLevel();
  let bestServer: string | null = null;
  let maxMoney = 0;

  const scanList = (host = "home", visited = new Set<string>()): void => {
    visited.add(host);
    for (const neighbor of ns.scan(host)) {
      if (visited.has(neighbor)) continue;
      
      if (
        ns.hasRootAccess(neighbor) &&
        !neighbor.startsWith("hacknet-") &&
        neighbor !== "darkweb" &&
        !neighbor.startsWith("pserv-")
      ) {
        const reqLevel = ns.getServerRequiredHackingLevel(neighbor);
        const serverMoney = ns.getServerMaxMoney(neighbor);
        
        if (reqLevel <= playerHack && serverMoney > maxMoney) {
          maxMoney = serverMoney;
          bestServer = neighbor;
        }
      }
      scanList(neighbor, visited);
    }
  };

  scanList();
  return bestServer;
}