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

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const shareScript = PATHS.services.payloads.share;
  const cleanShareName = shareScript.replace(/\\/g, "/").split("/").pop()!;

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

      if (targetThreads === currentThreads) continue;

      for (const process of shareProcesses) {
        ns.kill(process.pid);
      }

      if (targetThreads > 0) {
        const pid = ns.exec(shareScript, host, targetThreads);
        if (pid <= 0) {
          ns.print(
            `[SHARE] Share-Worker-Start fehlgeschlagen auf ${host} (${targetThreads} Threads).`,
          );
        }
      }
    }

    await ns.sleep(1000);
  }
}
