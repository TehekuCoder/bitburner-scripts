import { NS } from "@ns";

const CONFIG = {
  // Schwellenwert in % der Hash-Kapazität (0.8 = 80%)
  capacityThreshold: 0.8,
  // Limit für Max Money Upgrades pro Ziel-Server (10 Trillionen $)
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
          `[Hash-Manager] Min-Security für ${target} gesenkt (neu: ${minSec - 2})`
        );
        return;
      }
    }
  }

  // 2. Bladeburner Rank / SP pushen (falls aktiv)
  if (ns.bladeburner?.inBladeburner() && ns.hacknet.numHashes() >= 250) {
    if (ns.hacknet.spendHashes("Exchange for Bladeburner Rank")) {
      ns.print("[Hash-Manager] Hashes in Bladeburner Rank investiert.");
      return;
    }
  }

  // 3. Max Money auf dem besten Ziel-Server erhöhen (50 Hashes pro Stufe)
  if (target && ns.hacknet.numHashes() >= 50) {
    const currentMaxMoney = ns.getServerMaxMoney(target);
    if (currentMaxMoney < CONFIG.maxMoneyCap) {
      if (ns.hacknet.spendHashes("Increase Maximum Money", target)) {
        ns.print(
          `[Hash-Manager] Max-Money für ${target} erhöht ($${currentMaxMoney.toLocaleString()})`
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
        `[Hash-Manager] ${amountToSpend * 4} Hashes für $${(
          amountToSpend * 250000
        ).toLocaleString()} verkauft.`
      );
    }
  }
}

/**
 * Ermittelt das wertvollste Ziel im Netzwerk:
 * - Benötigt Root-Zugriff
 * - Hacking-Level reicht aus (requiredHackingSkill <= playerHackingLevel)
 * - Ignoriert Home, Darkweb und eigene Server
 * - Sortiert nach dem höchsten Max-Geld
 */
function getBestTarget(ns: NS): string | null {
  const playerHackLevel = ns.getHackingLevel();
  const visited = new Set<string>();
  const queue: string[] = ["home"];
  visited.add("home");

  const purchasedServers = new Set(ns.cloud.getServerNames());
  let bestTarget: string | null = null;
  let maxMoney = 0;

  while (queue.length > 0) {
    const host = queue.shift()!;
    const neighbors = ns.scan(host);

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;

      visited.add(neighbor);
      queue.push(neighbor);

      // Ausschluss-Filter
      if (
        neighbor === "darkweb" ||
        purchasedServers.has(neighbor) ||
        !ns.hasRootAccess(neighbor)
      ) {
        continue;
      }

      const reqHack = ns.getServerRequiredHackingLevel(neighbor);
      const serverMaxMoney = ns.getServerMaxMoney(neighbor);

      // Nur Server wählen, die hackbar sind und Basis-Geld besitzen
      if (reqHack <= playerHackLevel && serverMaxMoney > maxMoney) {
        maxMoney = serverMaxMoney;
        bestTarget = neighbor;
      }
    }
  }

  return bestTarget;
}