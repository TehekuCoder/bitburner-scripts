import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { provisionServer } from "./provision.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.tprint("💤 [BitOS] Leite Schlafmodus ein. Initialisiere Multi-Target-Balancing...");

  // ====================================================================
  // SCHRITT 1: NUKLEARER SCHLAG GEGEN 'HOME'
  // ====================================================================
  ns.killall("home", true);
  await ns.sleep(500);

  // ====================================================================
  // SCHRITT 2: DYNAMISCHE ERMITTLUNG DER TOP-ZIELE (LOAD BALANCING)
  // ====================================================================
  const playerHacking = ns.getPlayer().skills.hacking;
  const allServers = getAllServers(ns);

  // Finde alle hackbaren Server mit Geld und sortiere sie nach maximalem Geld (höchstes zuerst)
  const validTargets = allServers
    .filter(s => ns.hasRootAccess(s) && ns.getServerMaxMoney(s) > 0 && ns.getServerRequiredHackingLevel(s) <= playerHacking)
    .sort((a, b) => ns.getServerMaxMoney(b) - ns.getServerMaxMoney(a));

  if (validTargets.length === 0) {
    ns.tprint("❌ ERROR: Keine gültigen Hack-Ziele gefunden!");
    return;
  }

  // Wir definieren unsere Top 3 Ziele für die Lastverteilung
  const targetTier1 = validTargets[0]; // Das absolute Top-Ziel (z.B. max-hardware)
  const targetTier2 = validTargets[1] || targetTier1; // Zweitbeste Wahl
  const targetTier3 = validTargets[2] || targetTier2; // Drittbeste Wahl

  ns.tprint(`🎯 [BitOS] Lastverteilung aktiv:`);
  ns.tprint(`   - Tier 1 (High RAM / Home) -> ${targetTier1} ($${ns.format.number(ns.getServerMaxMoney(targetTier1))})`);
  ns.tprint(`   - Tier 2 (Mid-Range/P-Serv) -> ${targetTier2} ($${ns.format.number(ns.getServerMaxMoney(targetTier2))})`);
  ns.tprint(`   - Tier 3 (Low-RAM Network)  -> ${targetTier3} ($${ns.format.number(ns.getServerMaxMoney(targetTier3))})`);

  // ====================================================================
  // SCHRITT 3: WORKER-VERTEILUNG NACH LEISTUNGSKLASSE
  // ====================================================================
  const pServers = ns.cloud.getServerNames();
  const workerScript = "tasks/work.js";
  const workerRam = ns.getScriptRam(workerScript);

  const hostServers = allServers.filter(
    s => s === "home" || pServers.includes(s) || (ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0)
  );

  const scriptsToKill = ["tasks/hack.js", "tasks/grow.js", "tasks/weaken.js", "tasks/work.js", "tasks/xp-grind.js"];
  let totalShareThreads = 0;
  const activeTargets = new Set<string>();

  for (const server of hostServers) {
    // 1. Bereinigen
    if (server !== "home") {
      for (const script of scriptsToKill) {
        if (ns.isRunning(script, server)) ns.scriptKill(script, server);
      }
    }

    await provisionServer(ns, server);

    const reserve = server === "home" ? 32 : 0; 
    const maxRam = ns.getServerMaxRam(server) - reserve;
    
    // Share-Threads sichern
    const activeProcesses = ns.ps(server);
    let shareRam = 0;
    for (const proc of activeProcesses) {
      if (proc.filename.includes("share")) {
        totalShareThreads += proc.threads;
        shareRam += ns.getScriptRam(proc.filename, server) * proc.threads;
      }
    }

    const freeRam = maxRam - shareRam;
    const threads = Math.floor(freeRam / workerRam);

    if (threads > 0) {
      // 🧠 INTELLIGENTE ZIELZUWEISUNG (Wer hackt was?)
      let assignedTarget = targetTier3; // Standard für kleine gekaperte Server

      if (server === "home") {
        assignedTarget = targetTier1; // Home bekommt immer den dicksten Brocken
      } else if (pServers.includes(server)) {
        // Deine gekauften Server teilen sich Tier 1 und Tier 2 auf
        const index = pServers.indexOf(server);
        assignedTarget = index % 2 === 0 ? targetTier1 : targetTier2;
      } else if (maxRam >= 64) {
        assignedTarget = targetTier2; // Größere gekaperte Server helfen bei Tier 2
      }

      activeTargets.add(assignedTarget);
      ns.exec(workerScript, server, threads, assignedTarget);
    }
  }

  // ====================================================================
  // 📊 MONITORING (DYNAMIC FOR ALL TARGETS)
  // ====================================================================
  ns.tprint("⏳ [BitOS] Multi-Zyklen gestartet. Kalibrierung läuft...");
  ns.ui.openTail();

  let stableTicks = 0;
  let lastTotalIncome = 0;
  const startTime = Date.now();
  
  // Failsafe basierend auf dem langsamsten der Top-Ziele
  const maxWaitTime = Math.max(
    ns.getWeakenTime(targetTier1),
    ns.getWeakenTime(targetTier2)
  ) + ns.getHackTime(targetTier1) + 10000;

  while (true) {
    let currentTotalIncome = 0;

    // Einkommen von ALLEN gesetzten Zielen zusammenrechnen
    for (const server of hostServers) {
      for (const target of activeTargets) {
        currentTotalIncome += ns.getScriptIncome(workerScript, server, target);
      }
    }

    const elapsedSecs = Math.floor((Date.now() - startTime) / 1000);

    ns.clearLog();
    ns.print(`============================================================`);
    ns.print(`🔥 BIT-OS CLUSTER-KALIBRIERUNG (MULTI-TARGET MODUS)`);
    ns.print(`============================================================`);
    ns.print(`AKTIVE CLUSTER-ZIELE: ${Array.from(activeTargets).join(", ")}`);
    ns.print(`LAUFZEIT:             ${elapsedSecs}s / Failsafe: ${Math.floor(maxWaitTime / 1000)}s`);
    
    if (currentTotalIncome < 0) {
      ns.print(`NETZWERK-PROD:        🚀 Hyper-Produktion (> $10q/s)`);
    } else {
      ns.print(`NETZWERK-PROD:        $${ns.format.number(currentTotalIncome)} / Sekunde`);
      ns.print(`Hochrechnung / Std:   $${ns.format.number(currentTotalIncome * 3600)} / Stunde`);
    }
    
    ns.print(`🛡️ UTILITY:            ${totalShareThreads} Share-Threads aktiv`);
    const bar = "█".repeat(stableTicks) + "░".repeat(8 - stableTicks);
    ns.print(`STABILITÄT:           [${bar}] (${stableTicks}/8 Ticks)`);
    ns.print(`============================================================`);

    if (currentTotalIncome < 0) {
      stableTicks++;
    } else if (currentTotalIncome > 0 && Math.abs(currentTotalIncome - lastTotalIncome) < (currentTotalIncome * 0.05)) {
      stableTicks++;
    } else if (currentTotalIncome > 0) {
      stableTicks = Math.max(1, stableTicks);
    } else {
      stableTicks = 0;
    }

    if (stableTicks >= 8 || (Date.now() - startTime) > maxWaitTime) {
      break;
    }

    lastTotalIncome = currentTotalIncome;
    await ns.sleep(3000);
  }

  // Output bereitstellen
  ns.tprint(`🚀 [BitOS] NETZWERK STABILISIERT. Bereit für Offline-Phase.`);
}