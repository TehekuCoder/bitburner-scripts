import { NS } from "@ns";

const CONFIG = {
  capacityThreshold: 0.8,
  maxMoneyCap: 1e13,
};

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("[Hash-Manager] Dynamischer Manager gestartet...");

  while (true) {
    const currentHashes = ns.hacknet.numHashes();
    const capacity = ns.hacknet.hashCapacity();

    if (
      currentHashes >= capacity * CONFIG.capacityThreshold ||
      currentHashes >= capacity - 15
    ) {
      processHashSpends(ns);
    }

    await ns.sleep(1000);
  }
}

function processHashSpends(ns: NS): void {
  const target = getBestTarget(ns);

  // 1. Min Security auf 1 drücken (50 Hashes pro Stufe)
  if (target) {
    const minSec = ns.getServerMinSecurityLevel(target);
    if (minSec > 1 && ns.hacknet.numHashes() >= 50) {
      if (ns.hacknet.spendHashes("Reduce Minimum Security", target)) {
        ns.print(
          `[Hash-Manager] Min-Security für ${target} gesenkt (neu: ${minSec - 2})`,
        );
        return;
      }
    }
  }

  // 2. Bladeburner Rank / SP pushen (falls aktiv)
  try {
    if (ns.bladeburner?.inBladeburner() && ns.hacknet.numHashes() >= 250) {
      if (ns.hacknet.spendHashes("Exchange for Bladeburner Rank")) {
        ns.print("[Hash-Manager] Hashes in Bladeburner Rank investiert.");
        return;
      }
    }
  } catch (_) {}

  // 3. Max Money auf dem besten Ziel-Server erhöhen (50 Hashes pro Stufe)
  if (target && ns.hacknet.numHashes() >= 50) {
    const currentMaxMoney = ns.getServerMaxMoney(target);
    if (currentMaxMoney < CONFIG.maxMoneyCap) {
      if (ns.hacknet.spendHashes("Increase Maximum Money", target)) {
        ns.print(
          `[Hash-Manager] Max-Money für ${target} erhöht ($${ns.format.number(currentMaxMoney)})`,
        );
        return;
      }
    }
  }

  // 4. Fallback: Verbleibende Hashes komplett in Bargeld umwandeln
  const currentHashes = ns.hacknet.numHashes();
  if (currentHashes >= 4) {
    const amountToSpend = Math.floor(currentHashes / 4);
    if (ns.hacknet.spendHashes("Sell for Money", "", amountToSpend)) {
      ns.print(
        `[Hash-Manager] ${amountToSpend * 4} Hashes für $${ns.format.number(
          amountToSpend * 250000,
        )} verkauft.`,
      );
    }
  }
}

function getBestTarget(ns: NS): string | null {
  const playerHackLevel = ns.getHackingLevel();
  const visited = new Set<string>();
  const queue: string[] = ["home"];
  visited.add("home");

  const purchasedServers = new Set(
    ns.cloud?.getServerNames() ?? ns.cloud.getServerNames(),
  );
  let bestTarget: string | null = null;
  let maxMoney = 0;

  while (queue.length > 0) {
    const host = queue.shift()!;
    const neighbors = ns.scan(host);

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;

      visited.add(neighbor);
      queue.push(neighbor);

      // Ausschluss-Filter: Darkweb, Hacknet-Server/Nodes, eigene Server & un-gehackte Server
      if (
        neighbor === "darkweb" ||
        neighbor.startsWith("hacknet-") ||
        purchasedServers.has(neighbor) ||
        !ns.hasRootAccess(neighbor)
      ) {
        continue;
      }

      const reqHack = ns.getServerRequiredHackingLevel(neighbor);
      const serverMaxMoney = ns.getServerMaxMoney(neighbor);

      if (reqHack <= playerHackLevel && serverMaxMoney > maxMoney) {
        maxMoney = serverMaxMoney;
        bestTarget = neighbor;
      }
    }
  }

  return bestTarget;
}