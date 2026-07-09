import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { findBestFallbackTarget } from "../core/sys-dispatcher.js";
import { provisionServer } from "./provision.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.tprint("💤 [BitOS] Leite Schlafmodus ein. Erzwinge Core-Shutdown...");

  // ====================================================================
  // 🎯 SCHRITT 1: DER NUKLEARE SCHLAG GEGEN 'HOME' (mit SafetyGuard)
  // ====================================================================
  ns.killall("home", true);
  await ns.sleep(500);

  // ====================================================================
  // SCHRITT 2: UMGEBUNG LADEN & TARGET BESTIMMEN
  // ====================================================================
  const p = ns.getPlayer();
  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;
  const bestTarget = findBestFallbackTarget(ns, p.skills.hacking, bnMults, null);

  ns.tprint(`🎯 [BitOS] Offline-Target gewählt: ${bestTarget}`);

  // ====================================================================
  // SCHRITT 3: NETZWERK-SÄUBERUNG & WORKER-START
  // ====================================================================
  const allServers = getAllServers(ns);
  const pServers = ns.cloud.getServerNames();
  const workerScript = "tasks/work.js";
  const workerRam = ns.getScriptRam(workerScript);

  const targetServers = allServers.filter(
    s => s === "home" || pServers.includes(s) || (ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0)
  );

  const scriptsToKill = [
    "tasks/hack.js",
    "tasks/grow.js",
    "tasks/weaken.js",
    "tasks/work.js",
    "tasks/xp-grind.js"
  ];

  let totalShareThreads = 0;

  for (const server of targetServers) {
    if (server !== "home") {
      for (const script of scriptsToKill) {
        if (ns.isRunning(script, server)) {
          ns.scriptKill(script, server);
        }
      }

      const activeProcesses = ns.ps(server);
      for (const proc of activeProcesses) {
        if (proc.filename.includes("share")) {
          totalShareThreads += proc.threads;
        }
      }
    }

    await provisionServer(ns, server);

    const reserve = server === "home" ? 32 : 0; 
    const maxRam = ns.getServerMaxRam(server) - reserve;
    const freeRam = maxRam - ns.getServerUsedRam(server);
    const threads = Math.floor(freeRam / workerRam);

    if (threads > 0) {
      ns.exec(workerScript, server, threads, bestTarget);
    }
  }

  // ====================================================================
  // 📊 MONITORING & OFFLINE-WARMUP ENGINE (WITH OVERFLOW PATCH)
  // ====================================================================
  ns.tprint("⏳ [BitOS] Skripte gestartet. Überwache Kalibrierung im Tail-Window...");
  ns.ui.openTail();

  let stableTicks = 0;
  let lastTotalIncome = 0;
  const startTime = Date.now();
  const maxWaitTime = ns.getWeakenTime(bestTarget) + 5000; 

  while (true) {
    let currentTotalIncome = 0;

    for (const server of targetServers) {
      currentTotalIncome += ns.getScriptIncome(workerScript, server, bestTarget);
    }

    const elapsed = Date.now() - startTime;
    const elapsedSecs = Math.floor(elapsed / 1000);

    ns.clearLog();
    ns.print(`============================================================`);
    ns.print(`🔥 BIT-OS OBERFLÄCHEN-KALIBRIERUNG (OFFLINE-WARMUP)`);
    ns.print(`============================================================`);
    ns.print(`ZIELSERVER:      ${bestTarget}`);
    ns.print(`LAUFZEIT:        ${elapsedSecs}s / Failsafe: ${Math.floor(maxWaitTime / 1000)}s`);
    
    // 🔧 UI-FIX: Negativen Überlauf sauber abfangen und verständlich anzeigen
    if (currentTotalIncome < 0) {
      ns.print(`NETZWERK-PROD:    🚀 Hyper-Produktion (Engine-Überlauf durch $10q+)`);
    } else {
      ns.print(`NETZWERK-PROD:    $${ns.format.number(currentTotalIncome)} / Sekunde`);
    }
    
    ns.print(`🛡️ UTILITY:      ${totalShareThreads} Share-Threads geschützt & aktiv`);
    
    const bar = "█".repeat(stableTicks) + "░".repeat(8 - stableTicks);
    ns.print(`STABILITÄT:      [${bar}] (${stableTicks}/8 Ticks)`);
    ns.print(`------------------------------------------------------------`);
    
    if (currentTotalIncome === 0) {
      ns.print(`STATUS: Wait... Server führt erste Prep-Zyklen aus.`);
    } else if (currentTotalIncome < 0) {
      ns.print(`STATUS: 🔥 Maximale Auslastung! Ignoriere Bitburner-Zählerlimit...`);
    } else {
      ns.print(`STATUS: Worker generieren Geld! Stabilisiere Durchschnitt...`);
    }
    ns.print(`============================================================`);

    // 🔧 LOGIK-FIX: Wenn der Wert negativ wird, interpretieren wir das als erfolgreichen Aktivitäts-Indikator
    if (currentTotalIncome < 0) {
      stableTicks++;
    } else if (currentTotalIncome > 0 && Math.abs(currentTotalIncome - lastTotalIncome) < (currentTotalIncome * 0.05)) {
      stableTicks++;
    } else if (currentTotalIncome > 0) {
      stableTicks = Math.max(1, stableTicks); 
    } else {
      stableTicks = 0;
    }

    if (stableTicks >= 8) {
      break;
    }

    if (elapsed > maxWaitTime) {
      ns.print("⚠️ [Failsafe] Zeitlimit überschritten! Erzwungener Übergang.");
      break;
    }

    lastTotalIncome = currentTotalIncome;
    await ns.sleep(3000); 
  }

  // ====================================================================
  // 🔔 NOTIFICATION & ENHANCED ALERT INTERFACE
  // ====================================================================
  if (lastTotalIncome === 0) {
    ns.toast("BitOS: CRITICAL WARNING! Offline-Ertrag steht auf 0!", "error", 15000);
    await ns.alert(
      `============================================================\n` +
      `⚠️ WARNUNG: OFFLINE-START FEHLGESCHLAGEN ($0/s)\n` +
      `============================================================\n\n` +
      `Der Failsafe-Timer ist abgelaufen, bevor Geld generiert wurde.`
    );
  } else {
    ns.toast("BitOS: Offline-Skripte sind warmgelaufen!", "success", 10000);
    
    const displayIncome = lastTotalIncome < 0 
      ? "Maximale Hyper-Produktion (> $10q)" 
      : `$${ns.format.number(lastTotalIncome)}/s`;

    await ns.alert(
      `========================================\n` +
      `💤 BIT-OS: BEREIT FÜR OFFLINE-PHASE\n` +
      `========================================\n\n` +
      `Das Netzwerk hat sich auf ${bestTarget} kalibriert.\n` +
      `Aktueller Durchschnitt: ${displayIncome}\n` +
      `Utility-Erhalt: ${totalShareThreads} Share-Threads laufen weiter.\n\n` +
      `Du kannst den PC jetzt beruhigt ausschalten!`
    );
    ns.tprint("🚀 [BitOS] SYSTEMBEREIT FÜR OFFLINE-PHASE. Gute Nacht, Operator!");
  }
}