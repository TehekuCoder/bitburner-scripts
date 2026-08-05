import { NS } from "@ns";
import { loadState } from "/lib/state.js";
import { PATHS } from "/lib/paths.js";

export async function main(ns: NS): Promise<void> {
  const target = ns.getHostname();
  ns.disableLog("ALL");

  const SHARE_SCRIPT = PATHS.payloads.share;
  const GLOBAL_SHARE_POWER_CAP = 1.42;

  const maxRam = ns.getServerMaxRam(target);
  const scriptRam = ns.getScriptRam(SHARE_SCRIPT, target);

  if (maxRam < scriptRam || scriptRam === 0) return;

  // Pfad-Säuberung für verlässlichen Filter-Vergleich
  const cleanSharePath = SHARE_SCRIPT.replace(/^\//, "");

  while (true) {
    const state = loadState(ns);

    // 🛡️ 1. DYNAMISCHES RESERVE-RAM
    let systemReserve = 0;
    if (target === "home") {
      // Mindestreserve auf 4 GB gesenkt, damit Early-Game (16/32 GB Home) nicht blockiert wird
      systemReserve = Math.min(128, Math.max(4, maxRam * 0.05));
    } else {
      systemReserve = Math.min(4, maxRam * 0.02);
    }

    // 📊 2. PROZENTUALES CAP ERMITTELN
    const currentSharePower = ns.getSharePower();
    let maxAllowedPercent = 0.95;

    if (state?.fillerConfig?.shareMaxRamPercent !== undefined) {
      maxAllowedPercent = state.fillerConfig.shareMaxRamPercent;
    } else if (state?.strategy === "REP") {
      maxAllowedPercent = 0.98;
    } else if (currentSharePower >= GLOBAL_SHARE_POWER_CAP) {
      maxAllowedPercent = 0.20;
    }

    // 💡 3. ECHTES FREIES RAM BERECHNEN
    const totalUsedRam = ns.getServerUsedRam(target);

    const currentShareThreads = ns
      .ps(target)
      .filter((proc) => proc.filename.replace(/^\//, "") === cleanSharePath)
      .reduce((acc, proc) => acc + proc.threads, 0);

    const currentShareRam = currentShareThreads * scriptRam;
    const nonShareUsedRam = totalUsedRam - currentShareRam;

    const realFreeRamForShare = maxRam - nonShareUsedRam - systemReserve;
    const maxShareRamByCap = maxRam * maxAllowedPercent;
    const targetShareRam = Math.max(0, Math.min(realFreeRamForShare, maxShareRamByCap));

    const targetThreads = Math.floor(targetShareRam / scriptRam);

    // 🚀 4. PROZESS-ANPASSUNG
    const threadDiff = Math.abs(targetThreads - currentShareThreads);
    const shouldUpdate =
      targetThreads !== currentShareThreads &&
      (threadDiff > currentShareThreads * 0.05 || currentShareThreads === 0 || targetThreads === 0);

    if (shouldUpdate) {
      if (currentShareThreads > 0) {
        ns.scriptKill(SHARE_SCRIPT, target);
      }
      if (targetThreads > 0) {
        ns.exec(SHARE_SCRIPT, target, targetThreads);
      }
    }

    await ns.sleep(1000);
  }
}