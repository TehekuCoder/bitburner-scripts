import { NS } from "@ns";
import { drawShotgunDashboard, ShotgunDashboardData } from "/ui/shotgun-ui.js";
import { HOME_RAM_RESERVE } from "/lib/constants.js";
import { getAllServers } from "/lib/network.js";
import { loadBatcherState } from "/lib/state.js";
import { PATHS } from "/lib/paths.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.setTailTitle("Shotgun Dashboard");
  ns.ui.resizeTail(580, 530);

  const eventLog: string[] = [];
  let lastProgressStr = "";

  const hackScript = PATHS.payloads.hack || "payloads/hack.js";
  const growScript = PATHS.payloads.grow || "payloads/grow.js";
  const weakenScript = PATHS.payloads.weaken || "payloads/weaken.js";

  while (true) {
    const state = loadBatcherState(ns);
    const servers = getAllServers(ns);

    let totalMaxRam = 0;
    let totalUsedRam = 0;

    let hackThreads = 0;
    let growThreads = 0;
    let weakenThreads = 0;
    let activeProcessesCount = 0;

    // 1. Netzwerk nach laufenden Payloads & RAM scannen
    for (const server of servers) {
      if (!ns.hasRootAccess(server)) continue;

      let maxRam = ns.getServerMaxRam(server);
      if (server === "home") maxRam = Math.max(0, maxRam - HOME_RAM_RESERVE);

      totalMaxRam += maxRam;
      totalUsedRam += ns.getServerUsedRam(server);

      const processes = ns.ps(server);
      for (const proc of processes) {
        if (proc.filename === hackScript) {
          hackThreads += proc.threads;
          activeProcessesCount++;
        } else if (proc.filename === growScript) {
          growThreads += proc.threads;
          activeProcessesCount++;
        } else if (proc.filename === weakenScript) {
          weakenThreads += proc.threads;
          activeProcessesCount++;
        }
      }
    }

    const totalThreads = hackThreads + growThreads + weakenThreads;
    const target = state?.batcherTarget ?? "Keines";

    // 2. Zielserver Status
    let curSec = 0,
      minSec = 0,
      curMoney = 0,
      maxMoney = 0;
    if (
      target !== "Keines" &&
      target !== "Suche..." &&
      ns.serverExists(target)
    ) {
      curSec = ns.getServerSecurityLevel(target);
      minSec = ns.getServerMinSecurityLevel(target);
      curMoney = ns.getServerMoneyAvailable(target);
      maxMoney = ns.getServerMaxMoney(target);
    }

    // 3. Event Logging aktualisieren
    const progressStr = state?.batcherProgress ?? "";
    if (
      progressStr &&
      progressStr !== lastProgressStr &&
      !progressStr.includes("Executing")
    ) {
      eventLog.push(`[${new Date().toLocaleTimeString()}] ${progressStr}`);
      lastProgressStr = progressStr;
      if (eventLog.length > 4) eventLog.shift();
    }

    // 4. UI Rendering
    const dashboardData: ShotgunDashboardData = {
      target: target,
      status: state?.batcherActive ? "🌊 SHOTGUN AKTIV" : "💤 STANDBY",
      ramUsed: totalUsedRam,
      ramTotal: totalMaxRam,
      activeWaves:
        state?.batcherActiveBatches ?? Math.ceil(activeProcessesCount / 3),
      activeThreads: {
        hack: hackThreads,
        grow: growThreads,
        weaken: weakenThreads,
        total: totalThreads,
      },
      targetStats: {
        curSec,
        minSec,
        curMoney,
        maxMoney,
      },
      eventLog: eventLog,
    };

    drawShotgunDashboard(ns, dashboardData);

    await ns.sleep(500);
  }
}