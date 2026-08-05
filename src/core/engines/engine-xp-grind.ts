import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { breakAndInfectNetwork, getAllServers } from "/lib/network.js";
import { patchBatcherState } from "/lib/state.js";
import { PATHS } from "/lib/paths.js";
import { HOME_RAM_RESERVE } from "/lib/constants.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "XPGrindEngine");

  let target = (ns.args[0] as string) || "joesguns";
  const weakenScript = PATHS.payloads.weaken;

  logger.info(`⚡ XP-Grind Engine gestartet auf Ziel: [${target}]`);

  let execCounter = 0;

  while (true) {
    await breakAndInfectNetwork(ns);

    if (!ns.serverExists(target) || !ns.hasRootAccess(target)) {
      target = "foodnstuff";
    }

    const allNetwork = getAllServers(ns);
    const workerNodes = allNetwork.filter(
      (s) => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0,
    );

    const weakenCost = ns.getScriptRam(weakenScript, "home");
    execCounter = (execCounter + 1) % 10000;

    for (const node of workerNodes) {
      if (node !== "home" && !ns.fileExists(weakenScript, node)) {
        ns.scp(weakenScript, node, "home");
      }

      const reservedRam = node === "home" ? HOME_RAM_RESERVE : 0;
      const maxRam = ns.getServerMaxRam(node);
      const usedRam = ns.getServerUsedRam(node);
      const freeRam = Math.max(0, maxRam - usedRam - reservedRam);

      const threads = Math.floor(freeRam / weakenCost);

      if (threads > 0) {
        ns.exec(
          weakenScript,
          node,
          threads,
          target,
          0,
          `${execCounter}_${Math.random()}`,
        );
      }
    }

    // Präzise Erfassung aller tatsächlich laufenden XP-Threads im Netz
    let totalActiveThreads = 0;
    const scriptBaseName = weakenScript.replace(/^.*[\\/]/, "");
    for (const node of workerNodes) {
      for (const proc of ns.ps(node)) {
        if (
          proc.filename.endsWith(scriptBaseName) &&
          proc.args[0] === target
        ) {
          totalActiveThreads += proc.threads;
        }
      }
    }

    const currentLevel = ns.getPlayer().skills.hacking;
    patchBatcherState(ns, {
      batcherTarget: target,
      batcherProgress: `XP-GRIND (Lvl ${currentLevel} | Active Threads: ${totalActiveThreads})`,
    });

    await ns.sleep(2000);
  }
}