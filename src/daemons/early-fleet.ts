import { NS } from "@ns";
import { breakAndInfectNetwork, getAllServers } from "/lib/network.js";
import { patchState, loadState } from "/lib/state.js";
import { PATHS } from "/lib/paths.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  let lastRootCount = -1;
  let allNodes: string[] = [];
  let lastNetworkScan = 0;
  const NETWORK_SCAN_INTERVAL = 30000;

  // Pfad aus deiner PATHS-Konfiguration (Fallback auf "payloads/work.ts")
  const payloadScript = PATHS?.payloads?.work ?? "payloads/work.ts";

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

    // --- 🎯 2. ZIEL BESTIMMEN ---
    const currentState = loadState(ns) as Record<string, any> | null;
    // Liest das vom Kernel festgelegte Ziel aus (oder Fallback)
    const target = currentState?.kernelTarget || "joesguns";

    const payloadRam = ns.getScriptRam(payloadScript);

    // --- 🚀 3. WORKER DEPLOYMENT ---
    for (const node of allNodes) {
      if (!ns.hasRootAccess(node)) continue;

      // Datei auf den Zielserver kopieren (falls noch nicht vorhanden & nicht home)
      if (node !== "home" && !ns.fileExists(payloadScript, node)) {
        ns.scp(payloadScript, node, "home");
      }

      // Freien RAM & maximale Threads berechnen
      const maxRam = ns.getServerMaxRam(node);
      const usedRam = ns.getServerUsedRam(node);
      const freeRam = maxRam - usedRam;
      const threads = Math.floor(freeRam / payloadRam);

      // Wenn Threads verfügbar sind und der Worker auf dieser Node noch nicht läuft
      if (threads > 0 && !ns.isRunning(payloadScript, node, target)) {
        // Falls bereits ein Worker mit altem Ziel läuft -> killen für Zielwechsel
        if (ns.scriptRunning(payloadScript, node)) {
          ns.scriptKill(payloadScript, node);
        }

        ns.exec(payloadScript, node, threads, target);
      }
    }

    // --- 📊 4. STATE UPDATE ---
    const currentRootCount = allNodes.filter((n) => ns.hasRootAccess(n)).length;

    if (currentRootCount !== lastRootCount) {
      patchState(ns, {
        rootCount: currentRootCount,
        allServers: allNodes,
        progressBar: `💻 Early-Fleet aktiv: ${currentRootCount}/${allNodes.length} Server gecrackt & beackert.`,
      });
      lastRootCount = currentRootCount;
    }

    await ns.sleep(5000);
  }
}