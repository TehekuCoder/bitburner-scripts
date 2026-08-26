import { NS } from "@ns";
import { getAllServers } from "/infrastructure/network/network";
import { PATHS } from "/infrastructure/runtime/paths";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.clearLog();
  ns.ui.openTail();

  ns.ui.setTailTitle("Bootsequenz eingeleitet");
  ns.ui.resizeTail(349, 440);

  ns.print("====================================");
  ns.print("    BitOS v3.0 - BOOT SEQUENCE      ");
  ns.print("====================================");
  await ns.sleep(250);

  // --- 1. PRE-BOOT CLEAN SWEEP ---
  ns.print("[...] Performing Pre-Boot Clean Sweep...");

  // Alle anderen Prozesse auf 'home' beenden (außer diesem Boot-Skript)
  const currentPid = ns.pid;
  const homeProcs = ns.ps("home");
  let killedHomeCount = 0;

  for (const proc of homeProcs) {
    if (proc.pid !== currentPid) {
      ns.kill(proc.pid);
      killedHomeCount++;
    }
  }
  if (killedHomeCount > 0) {
    ns.print(
      `[ OK ] Terminated ${killedHomeCount} active processes on 'home'.`,
    );
  }

  // Das GESAMTE infizierte Netzwerk leeren
  try {
    const allServers = getAllServers(ns);
    let clearedHostsCount = 0;

    for (const server of allServers) {
      if (server !== "home") {
        if (ns.killall(server)) {
          clearedHostsCount++;
        }
      }
    }
    ns.print(
      `[ OK ] Network swept clean (${clearedHostsCount} active servers stopped).`,
    );
  } catch (error) {
    ns.print(
      "[WARN] Full network sweep failed. Falling back to purchased servers clear.",
    );
    try {
      const purchasedServers = ns.cloud.getServerNames();
      for (const server of purchasedServers) {
        ns.killall(server);
      }
      ns.print("[ OK ] Purchased server fleet cleared.");
    } catch {
      ns.print(
        "[WARN] Could not clear purchased servers during early boot stage.",
      );
    }
  }

  await ns.sleep(250);

  // --- 2. ENVIRONMENT LAYER ---
  ns.print("[...] Initializing Environment Layer...");
  if (ns.fileExists(PATHS.app.orchestration.boot, "home")) {
    const initPid = ns.run(PATHS.app.orchestration.boot, 1);
    if (initPid > 0) {
      // Synchron warten, bis die Initialisierung fertig ist
      while (ns.isRunning(initPid)) {
        await ns.sleep(50);
      }
      ns.print("[ OK ] BitNode environment successfully indexed.");
    } else {
      ns.print("[WARN] Initializer failed to launch. RAM shortage?");
    }
  } else {
    ns.print(
      `[WARN] ${PATHS.app.orchestration.boot} not found. Skipping init stage.`,
    );
  }
  await ns.sleep(250);

  // --- 3. HARDWARE-EBENE (sys-kernel) ---
  ns.print("[...] Launching Core Kernel...");
  if (ns.fileExists(PATHS.app.orchestration.kernel, "home")) {
    const kernelPid = ns.run(PATHS.app.orchestration.kernel, 1);
    if (kernelPid > 0) {
      ns.print(
        `[ OK ] ${PATHS.app.orchestration.kernel} successfully launched.`,
      );
    } else {
      ns.print(
        `[FAIL] CRITICAL ERROR: Could not launch ${PATHS.app.orchestration.kernel}!`,
      );
    }
  } else {
    ns.alert(`CRITICAL ERROR: ${PATHS.app.orchestration.kernel} not found!`);
    return;
  }
  await ns.sleep(250);

  ns.print("====================================");
  ns.print("     BOOT COMPLETELY DELEGATED      ");
  ns.print("====================================");
}
