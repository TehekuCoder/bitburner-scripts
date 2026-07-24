import { NS } from "@ns";
import { breakAndInfectNetwork, getAllServers } from "/lib/network";
import { patchState } from "/lib/state";


export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  let lastRootCount = -1;
  let allNodes: string[] = [];
  let lastNetworkScan = 0;
  const NETWORK_SCAN_INTERVAL = 30000;

  while (true) {
    const now = Date.now();

    // --- 📡 1. NETZWERK SCAN & INFEKTION ---
    if (
      now - lastNetworkScan > NETWORK_SCAN_INTERVAL ||
      allNodes.length === 0
    ) {
      breakAndInfectNetwork(ns);
      allNodes = getAllServers(ns);
      lastNetworkScan = now;
    }

    const currentRootCount = allNodes.filter((n) => ns.hasRootAccess(n)).length;

    // Nur bei Änderungen den State patchen (schont I/O)
    if (currentRootCount !== lastRootCount) {
      patchState(ns, {
        rootCount: currentRootCount,
        allServers: allNodes,
        progressBar: `💻 Netz-Infektor aktiv: ${currentRootCount}/${allNodes.length} Server gecrackt.`,
      });
      lastRootCount = currentRootCount;
    }

    await ns.sleep(5000);
  }
}
