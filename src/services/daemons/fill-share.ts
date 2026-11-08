import { NS } from "@ns";
import { PATHS } from "/infrastructure/runtime/paths.js";
import { loadState } from "/infrastructure/state/state.js";
import {
  getAllRootedServersIncludingPurchased,
  getShareRamPercent,
  getWorkerFreeRam,
  getWorkerMaxUsableRam,
} from "/infrastructure/network/network.js";
import { ensureScriptsOnServer } from "/domain/hacking/provision.js";
import { RAM_ALLOCATION } from "/shared/constants/ram-allocation.js";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new LoggerClient(ns, "SHARE-FILLER", undefined, "INFO");
  const warnedHosts = new Set<string>();
  const shareScript = PATHS.services.payloads.share;
  const cleanShareName = shareScript.replace(/\\/g, "/").split("/").pop()!;

  logger.info("Share-Filler gestartet.");

  while (true) {
    const state = loadState(ns);
    const hosts = getAllRootedServersIncludingPurchased(ns);
    let configuredPercent: number = RAM_ALLOCATION.shareMaxPercent;
    if (state?.fillerConfig?.shareMaxRamPercent !== undefined) {
      configuredPercent = state.fillerConfig.shareMaxRamPercent;
    } else if (state?.strategy === "REP") {
      configuredPercent = 0.4;
    }
    configuredPercent = getShareRamPercent(ns, configuredPercent);

    for (const host of hosts) {
      if (!ns.hasRootAccess(host)) continue;
      if (!(await ensureScriptsOnServer(ns, host, [shareScript]))) continue;

      const scriptRam = ns.getScriptRam(shareScript, host);
      if (!Number.isFinite(scriptRam) || scriptRam <= 0) continue;

      const shareProcesses = ns
        .ps(host)
        .filter((process) => process.filename.endsWith(cleanShareName));
      const currentThreads = shareProcesses.reduce(
        (sum, process) => sum + process.threads,
        0,
      );
      const currentShareRam = currentThreads * scriptRam;
      const nonShareUsedRam = Math.max(
        0,
        ns.getServerUsedRam(host) - currentShareRam,
      );
      const hostMaxRam = ns.getServerMaxRam(host);
      const physicalCapacity = Math.max(
        0,
        getWorkerMaxUsableRam(ns, host) - nonShareUsedRam,
      );
      const policyCapacity = Math.min(
        getWorkerMaxUsableRam(ns, host, "share"),
        hostMaxRam * configuredPercent,
      );
      const desiredThreads = Math.floor(
        Math.min(physicalCapacity, policyCapacity) / scriptRam,
      );
      const availableThreads = Math.floor(
        getWorkerFreeRam(ns, host, "share") / scriptRam,
      );
      const targetThreads = Math.min(
        desiredThreads,
        currentThreads + availableThreads,
      );

      if (targetThreads === currentThreads) {
        warnedHosts.delete(host);
        continue;
      }

      for (const process of shareProcesses) {
        ns.kill(process.pid);
      }

      if (targetThreads > 0) {
        const pid = ns.exec(shareScript, host, targetThreads);
        if (pid <= 0) {
          if (!warnedHosts.has(host)) {
            warnedHosts.add(host);
            logger.forTarget(host).warn(
              `Share-Worker konnte nicht gestartet werden (${targetThreads} Threads).`,
              undefined,
              {
                context: {
                  targetThreads,
                  availableThreads,
                  desiredThreads,
                },
              },
            );
            ns.print(
              `[SHARE] Share-Worker-Start fehlgeschlagen auf ${host} (${targetThreads} Threads).`,
            );
          }
        } else {
          warnedHosts.delete(host);
        }
      } else {
        warnedHosts.delete(host);
      }
    }

    await ns.sleep(1000);
  }
}
