import { NS } from "@ns";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";

import { PATHS } from "../../infrastructure/runtime/paths.js";
import { HOME_RAM_RESERVE } from "../../infrastructure/runtime/batcher.js";
import { getAllServers } from "/infrastructure/network/network.js";
import { patchBatcherState } from "/infrastructure/state/state.js";

/**
 * Ermittelt das optimale XP-Grind-Ziel basierend auf XP/Sekunde.
 */
function findBestXpTarget(
  ns: NS,
  logger: Logger,
  currentTarget: string | null,
): string {
  const player = ns.getPlayer();
  const playerSkill = player.skills.hacking;
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  const candidates = getAllServers(ns)
    .filter(
      (s) =>
        s !== "home" &&
        !s.startsWith("cloud-") &&
        !s.startsWith("hacknet-") &&
        ns.hasRootAccess(s) &&
        (ns.getServerRequiredHackingLevel(s) ?? 0) <= playerSkill,
    )
    .map((s) => {
      const serverObj = ns.getServer(s);
      let xpPerSec = 0;

      if (hasFormulas) {
        // hackExp liefert die EP pro Thread für alle Hacking-Aktionen auf dem Zielserver
        const exp = ns.formulas.hacking.hackExp(serverObj, player);
        const weakenTimeMs = ns.formulas.hacking.weakenTime(serverObj, player);
        xpPerSec = weakenTimeMs > 0 ? (exp * 1000) / weakenTimeMs : 0;
      } else {
        // Fallback: XP skaliert mit baseDifficulty, Weaken-Dauer bestimmt die Frequenz
        const baseDiff = serverObj.baseDifficulty ?? 1;
        const weakenTimeMs = ns.getWeakenTime(s);
        xpPerSec = weakenTimeMs > 0 ? (baseDiff * 1000) / weakenTimeMs : 0;
      }

      return { server: s, xpPerSec };
    })
    .sort((a, b) => b.xpPerSec - a.xpPerSec);

  if (candidates.length === 0) return "n00dles";

  const topCandidate = candidates[0];

  // Hysterese: Ziel nur wechseln, wenn der neue Candidate mindestens 5% besser ist
  if (currentTarget && currentTarget !== topCandidate.server) {
    const currentObj = candidates.find((c) => c.server === currentTarget);
    if (currentObj && topCandidate.xpPerSec < currentObj.xpPerSec * 1.05) {
      return currentTarget;
    }
  }

  return topCandidate.server;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "XPGrindEngine");

  const weakenScript = PATHS.services.payloads.weaken;
  const weakenCost = ns.getScriptRam(weakenScript, "home");

  let target = (ns.args[0] as string) || null;
  let execCounter = 0;
  let lastTargetCheck = 0;

  logger.info(`⚡ XP-Grind Engine gestartet.`);

  while (true) {
    const now = Date.now();

    // Zielauswahl alle 15 Sekunden oder wenn manuell kein Ziel übergeben wurde
    if (!target || now - lastTargetCheck > 15_000) {
      const newTarget = findBestXpTarget(ns, logger, target);
      if (newTarget !== target) {
        target = newTarget;
        logger.info(`🎯 Neues optimales XP-Ziel gewählt: [${target}]`);
      }
      lastTargetCheck = now;
    }

    const workerNodes = getAllServers(ns).filter(
      (s) => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0,
    );

    execCounter = (execCounter + 1) % 10000;
    let newlyLaunchedThreads = 0;

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
        const pid = ns.exec(
          weakenScript,
          node,
          threads,
          target,
          0,
          `${execCounter}_${Math.random()}`,
        );

        if (pid > 0) {
          newlyLaunchedThreads += threads;
        }
      }
    }

    const currentLevel = ns.getPlayer().skills.hacking;
    patchBatcherState(ns, {
            batchStrategy: "XP_GRIND",
      batcherActive: true,
      batcherTarget: target,
      batcherProgress: `XP-GRIND (${target} | Lvl ${currentLevel} | Last Wave: +${ns.format.number(newlyLaunchedThreads)} Threads)`,
    });

    await ns.sleep(2000);
  }
}
