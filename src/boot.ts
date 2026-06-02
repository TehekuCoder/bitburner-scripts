import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.clearLog();
  ns.ui.openTail(); // Öffnet das Boot-Logfenster auf dem Desktop

  ns.print("====================================");
  ns.print("     BitOS v2.0 - BOOT SEQUENCE     ");
  ns.print("====================================");
  await ns.sleep(250);

  // --- 1. HARDWARE-EBENE INITIALISIEREN (sys-kernel) ---
  ns.print("[...] Initializing Hardware Layer...");
  await ns.sleep(100);

  if (ns.fileExists("core/sys-kernel.js", "home")) {
    if (!ns.isRunning("core/sys-kernel.js", "home")) {
      ns.run("core/sys-kernel.js", 1);
      ns.print("[ OK ] core/sys-kernel.js successfully launched.");
    } else {
      ns.print("[INFO] core/sys-kernel.js is already running.");
    }
  } else {
    ns.alert("CRITICAL ERROR: core/sys-kernel.js not found!");
    return;
  }
  await ns.sleep(250);

  // --- 2. API-FEATURE-DETECTION (Singularity Check) ---
  ns.print("[...] Checking API Capabilities...");
  await ns.sleep(250);

  if (ns.singularity === undefined) {
    ns.print("[WARN] Singularity API (Source-File 4) missing!");
    ns.print("[ OK ] System running in standalone KERNEL mode.");
    ns.print("       (Hacking automation active. Manual faction work required.)");
  } else {
    ns.print("[ OK ] Singularity API detected.");
    ns.print("[...] Initializing Strategy Layer...");
    await ns.sleep(100);
    
    if (ns.fileExists("core/sys-dispatcher.js", "home")) {
      if (!ns.isRunning("core/sys-dispatcher.js", "home")) {
        ns.run("core/sys-dispatcher.js", 1);
        ns.print("[ OK ] core/sys-dispatcher.js successfully launched.");
      } else {
        ns.print("[INFO] core/sys-dispatcher.js is already running.");
      }
    } else {
      ns.print("[WARN] core/sys-dispatcher.js missing! Strategy Layer skipped.");
    }
  }

  ns.print("====================================");
  ns.print("     BITOS BOOT SEQUENCE COMPLETE   ");
  ns.print("====================================");
}