import { NS } from "@ns";
import { getAllServers } from "lib/network.js"; // Angenommen, dein Network-Helper liegt hier

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.clearLog();
  ns.ui.openTail();

  ns.print("====================================");
  ns.print("    BitOS v3.0 - BOOT SEQUENCE      ");
  ns.print("====================================");
  await ns.sleep(250);

  // --- NEW: PRE-BOOT CLEAN SWEEP ---
  ns.print("[...] Performing Pre-Boot Clean Sweep (Clearing Offline Workers)...");
  
  // 1. Alle anderen Skripte auf 'home' beenden (außer dem Boot-Skript selbst)
  const currentPid = ns.pid;
  const homeProcs = ns.ps("home");
  for (const proc of homeProcs) {
    if (proc.pid !== currentPid) {
      ns.kill(proc.pid);
    }
  }

  // 2. Worker auf allen anderen Servern im Netzwerk löschen
  // Falls getAllServers hier nicht importiert werden kann, liest der Kernel das später ein,
  // aber p-servs und infizierte Server direkt zu leeren sorgt für einen reibungslosen Start.
  try {
    const pServers = ns.cloud.getServerNames();
    for (const server of pServers) {
      ns.killall(server);
    }
    ns.print("[ OK ] Cloud server fleet cleared.");
  } catch {
    ns.print("[WARN] Could not clear cloud servers during early boot stage.");
  }

  await ns.sleep(250);

  // --- 0. ENVIRONMENT LAYER ---
  ns.print("[...] Initializing Environment Layer (Failsafe Check)...");
  if (ns.fileExists("core/sys-initializer.js", "home")) {
    const initPid = ns.run("core/sys-initializer.js", 1);
    if (initPid > 0) {
      while (ns.isRunning(initPid)) {
        await ns.sleep(50);
      }
      ns.print("[ OK ] BitNode environment successfully indexed.");
    } else {
      ns.print("[WARN] Initializer failed to launch. RAM shortage?");
    }
  }
  await ns.sleep(250);

  // --- 1. HARDWARE-EBENE (sys-kernel) ---
  ns.print("[...] Launching Core Kernel...");
  if (ns.fileExists("core/sys-kernel.js", "home")) {
    if (!ns.isRunning("core/sys-kernel.js", "home")) {
      // Kernel starten - dieser übernimmt ab hier ALLES (Dispatcher, Infra, etc.)
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

  ns.print("====================================");
  ns.print("     BOOT COMPLETELY DELEGATED      ");
  ns.print("====================================");
}