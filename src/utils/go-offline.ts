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
  // SCHRITT 3: WORKER-VERTEILUNG NACH LEISTUNGSKLASSE (REPAIRED)
  // ====================================================================
  const pServers = ns.cloud.getServerNames();
  const workerScript = "/tasks/work.js"; // Einheitlich mit führendem Slash
  const workerRam = ns.getScriptRam(workerScript);

  const hostServers = allServers.filter(
    s => s === "home" || pServers.includes(s) || (ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0)
  );

  let totalShareThreads = 0;
  const activeTargets = new Set<string>();

  for (const server of hostServers) {
    const activeProcesses = ns.ps(server);
    
    // Pfadunabhängiges Killen: Wir prüfen via .includes(), ob das Skript weg muss
    if (server !== "home") {
      for (const proc of activeProcesses) {
        if (proc.filename.includes("share")) {
          totalShareThreads += proc.threads;
        } else if (
          proc.filename.includes("hack.js") || 
          proc.filename.includes("grow.js") || 
          proc.filename.includes("weaken.js") || 
          proc.filename.includes("work.js") || 
          proc.filename.includes("xp-grind.js")
        ) {
          ns.scriptKill(proc.filename, server);
        }
      }
      // Kurze Atempause, damit die Engine das RAM im selben Frame freigibt
      await ns.sleep(20);
    }

    await provisionServer(ns, server);

    const reserve = server === "home" ? 32 : 0; 
    const maxRam = ns.getServerMaxRam(server) - reserve;
    
    // ✅ FIX: Nutze das echte, verbleibende physische RAM nach der Bereinigung
    const freeRam = maxRam - ns.getServerUsedRam(server);
    const threads = Math.floor(freeRam / workerRam);

    if (threads > 0) {
      let assignedTarget = targetTier3;

      if (server === "home") {
        assignedTarget = targetTier1;
      } else if (pServers.includes(server)) {
        const index = pServers.indexOf(server);
        assignedTarget = index % 2 === 0 ? targetTier1 : targetTier2;
      } else if (maxRam >= 64) {
        assignedTarget = targetTier2;
      }

      activeTargets.add(assignedTarget);
      
      // Skript kopieren falls nötig und ausführen
      if (server !== "home") ns.scp(workerScript, server, "home");
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
      // Wenn Einkommen 0 ist, warten wir einfach ruhig ab, ohne die Ticks zu bestrafen
      if (lastTotalIncome > 0) {
        stableTicks = 0; // Nur resetten, wenn wir schon mal Geld hatten und es eingebrochen ist
      }
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