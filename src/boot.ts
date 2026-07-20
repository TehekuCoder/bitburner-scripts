import { NS } from "@ns";
import { getAllServers } from "lib/network.js"; // Jetzt aktiv für den Clean Sweep genutzt!

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

  // 🟢 Optimierung: Das GESAMTE infizierte Netzwerk leeren
  try {
    const allServers = getAllServers(ns);
    let clearedHostsCount = 0;

    for (const server of allServers) {
      if (server !== "home") {
        // ns.killall gibt true zurück, wenn mindestens ein Skript beendet wurde
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
      "[WARN] Full network sweep failed. Falling back to cloud-only clear.",
    );
    try {
      const pServers = ns.cloud.getServerNames();
      for (const server of pServers) {
        ns.killall(server);
      }
      ns.print("[ OK ] Cloud server fleet cleared.");
    } catch {
      ns.print("[WARN] Could not clear cloud servers during early boot stage.");
    }
  }

  await ns.sleep(250);

  // --- 2. ENVIRONMENT LAYER ---
  ns.print("[...] Initializing Environment Layer (Failsafe Check)...");
  if (ns.fileExists("core/sys-initializer.js", "home")) {
    const initPid = ns.run("core/sys-initializer.js", 1);
    if (initPid > 0) {
      // Synchron warten, bis die Initialisierung (und State-Generierung) fertig ist
      while (ns.isRunning(initPid)) {
        await ns.sleep(50);
      }
      ns.print("[ OK ] BitNode environment successfully indexed.");
    } else {
      ns.print("[WARN] Initializer failed to launch. RAM shortage?");
    }
  } else {
    ns.print("[WARN] core/sys-initializer.js not found. Skipping init stage.");
  }
  await ns.sleep(250);

  // --- 3. HARDWARE-EBENE (sys-kernel) ---
  ns.print("[...] Launching Core Kernel...");
  if (ns.fileExists("core/sys-kernel.js", "home")) {
    // 🟢 Da wir oben alles beendet haben, läuft der Kernel garantiert nicht.
    // Wir können ihn direkt starten und die PID für die Erfolgsmeldung prüfen.
    const kernelPid = ns.run("core/sys-kernel.js", 1);
    if (kernelPid > 0) {
      ns.print("[ OK ] core/sys-kernel.js successfully launched.");
    } else {
      ns.print("[FAIL] CRITICAL ERROR: Could not launch core/sys-kernel.js!");
    }
  } else {
    ns.alert("CRITICAL ERROR: core/sys-kernel.js not found!");
    return;
  }
  await ns.sleep(250);

  ns.print("====================================");
  ns.print("     BOOT COMPLETELY DELEGATED      ");
  ns.print("====================================");
}
