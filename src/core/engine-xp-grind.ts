import { NS } from "@ns";
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";
import { patchState } from "./state-manager.js";
import { Logger } from "./logger.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "XPGrindEngine", "INFO");

  // Standard-Ziel für maximalen XP-Gain im Early/Mid-Game
  let target = (ns.args[0] as string) || "joesguns";
  const weakenScript = "tasks/weaken.js";

  logger.info(`⚡ XP-Grind Engine gestartet auf Ziel: [${target}]`);

  while (true) {
    breakAndInfectNetwork(ns);

    // Fallback auf foodnstuff, falls joesguns noch nicht geknackt werden kann
    if (!ns.serverExists(target) || !ns.hasRootAccess(target)) {
      target = "foodnstuff";
    }

    const allNetwork = getAllServers(ns);
    const workerNodes = allNetwork.filter(
      (s) => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0,
    );

    const weakenCost = ns.getScriptRam(weakenScript, "home");
    let totalThreadsDeployed = 0;

    for (const node of workerNodes) {
      if (node !== "home" && !ns.fileExists(weakenScript, node)) {
        ns.scp(weakenScript, node, "home");
      }

      // Reservierter RAM auf Home für Basissysteme
      const reservedRam = node === "home" ? 20 : 0;
      const maxRam = ns.getServerMaxRam(node);
      const usedRam = ns.getServerUsedRam(node);
      const freeRam = Math.max(0, maxRam - usedRam - reservedRam);

      const threads = Math.floor(freeRam / weakenCost);

      if (threads > 0) {
        // Weaken mit zufälliger ID starten, um PID-Kollisionen zu vermeiden
        ns.exec(weakenScript, node, threads, target, 0, Math.random());
        totalThreadsDeployed += threads;
      }
    }

    const currentLevel = ns.getPlayer().skills.hacking;
    patchState(ns, {
      batcherTarget: target,
      batcherProgress: `XP-GRIND (Lvl ${currentLevel} | Threads: ${totalThreadsDeployed})`,
    });

    await ns.sleep(2000);
  }
}