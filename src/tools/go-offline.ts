import { NS } from "@ns";
import { getAllServers } from "/lib/network.js";
import { provisionServer } from "/lib/utils/provision";

interface TargetScore {
  name: string;
  score: number;
  maxMoney: number;
  weakenTime: number;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.tprint("💤 [BitOS] Leite Schlafmodus-Analyse ein...");

  // ====================================================================
  // SCHRITT 1: CLEANUP AUF HOME
  // ====================================================================
  ns.killall("home", true);
  await ns.sleep(500);

  // ====================================================================
  // SCHRITT 2: HACKNET-INCOME VS. HACK-TARGETS EVALUIERUNG
  // ====================================================================
  const hacknetIncome = calculateHacknetIncome(ns);

  const playerHacking = ns.getPlayer().skills.hacking;
  const allServers = getAllServers(ns);

  const validTargets: TargetScore[] = allServers
    .filter(
      (s) =>
        !s.startsWith("hacknet") &&
        ns.hasRootAccess(s) &&
        ns.getServerMaxMoney(s) > 0 &&
        ns.getServerRequiredHackingLevel(s) <= playerHacking,
    )
    .map((s) => {
      const maxMoney = ns.getServerMaxMoney(s);
      const weakenTime = ns.getWeakenTime(s);
      // Grobe Schätzung des maximalen theoretischen Ertrags/Sekunde
      const score = maxMoney / Math.max(1, weakenTime / 1000);
      return { name: s, score, maxMoney, weakenTime };
    })
    .sort((a, b) => b.score - a.score);

  const TARGET_COUNT = Math.min(validTargets.length, 8);
  const topTargets = validTargets.slice(0, TARGET_COUNT);
  const estimatedMaxScriptIncome = topTargets.reduce((sum, t) => sum + t.score, 0);

  ns.tprint(`📊 [WIRTSCHAFTS-CHECK]:`);
  ns.tprint(` ├─ ⚡ Hacknet-Ertrag:   $${ns.format.number(hacknetIncome)} / Sekunde`);
  ns.tprint(` └─ 💻 Skript-Potenzial: $${ns.format.number(estimatedMaxScriptIncome)} / Sekunde`);

  // ENTSCHEIDUNG: Lohnt sich Skript-Hacking überhaupt?
  // Bricht ab, wenn Skripte weniger als 10% des Hacknet-Einkommens ausmachen würden
  const MIN_WORTHWHILE_RATIO = 0.10;
  if (hacknetIncome > 0 && estimatedMaxScriptIncome < (hacknetIncome * MIN_WORTHWHILE_RATIO)) {
    ns.tprint(`\n🛑 [BitOS] SKRIPT-DEPLOYMENT ÜBERSPRUNGEN!`);
    ns.tprint(`💡 Hacknet ist in BN9 deutlich lukrativer als Hacking-Skripte.`);
    ns.tprint(`   Alle Worker gestoppt. Das Netzwerk läuft im reinen Hacknet-Passivmodus.`);
    
    // Säubere Worker auf allen Hosts, damit RAM/Prozesse frei bleiben
    stopAllWorkers(ns, allServers);
    return;
  }

  if (validTargets.length === 0) {
    ns.tprint("❌ ERROR: Keine gültigen Hack-Ziele gefunden!");
    return;
  }

  ns.tprint(
    `🎯 [BitOS] Dynamische Lastverteilung gestartet (${topTargets.length} Ziele aktiv):`,
  );
  topTargets.forEach((t, i) => {
    ns.tprint(
      `   [Rank ${i + 1}] ${t.name.padEnd(18)} -> Max: $${ns.format.number(t.maxMoney)} | Weaken: ${Math.round(t.weakenTime / 1000)}s`,
    );
  });

  // ====================================================================
  // SCHRITT 3: WORKER-VERTEILUNG NACH RAM-LEISTUNG
  // ====================================================================
  const pServers = ns.cloud.getServerNames();
  const workerScript = "payloads/work.js";
  const workerRam = ns.getScriptRam(workerScript);

  if (!Number.isFinite(workerRam) || workerRam <= 0) {
    ns.tprint(`❌ ERROR: Worker-Skript '${workerScript}' nicht gefunden!`);
    return;
  }

  const hacknetServers: string[] = [];
  try {
    const numHacknet = ns.hacknet.numNodes();
    for (let i = 0; i < numHacknet; i++) {
      const nodeName = ns.hacknet.getNodeStats(i).name;
      if (ns.getServerMaxRam(nodeName) > 0) {
        hacknetServers.push(nodeName);
      }
    }
  } catch {
    // API nicht verfügbar
  }

  const hostServers = [...allServers, ...hacknetServers]
    .filter(
      (s) =>
        !s.startsWith("hacknet-node") &&
        (s === "home" ||
          pServers.includes(s) ||
          s.startsWith("hacknet-server") ||
          (ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0)) &&
        ns.getServerMaxRam(s) > 0,
    )
    .sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a));

  const activeTargets = new Set<string>();

  for (let i = 0; i < hostServers.length; i++) {
    const server = hostServers[i];

    if (server !== "home") {
      killWorkerScriptsOnServer(ns, server);
      await ns.sleep(20);
    }

    await provisionServer(ns, server);

    const reserve = server === "home" ? 32 : 0;
    const maxRam = Math.max(0, ns.getServerMaxRam(server) - reserve);
    const freeRam = Math.max(0, ns.getServerMaxRam(server) - ns.getServerUsedRam(server));

    const threads = Math.floor((server === "home" ? freeRam : maxRam) / workerRam);

    if (Number.isFinite(threads) && threads > 0) {
      const targetIndex = i % topTargets.length;
      const assignedTarget = topTargets[targetIndex].name;

      activeTargets.add(assignedTarget);

      if (server !== "home") ns.scp(workerScript, server, "home");

      const pid = ns.exec(workerScript, server, threads, assignedTarget);
      if (pid === 0) {
        ns.print(`⚠️ Exec fehlgeschlagen auf ${server} für ${assignedTarget}`);
      }
    }
  }

  if (activeTargets.size === 0) {
    ns.tprint("❌ ERROR: Keine Worker gestartet (unzureichender RAM im Netz).");
    return;
  }

  ns.tprint("⏳ [BitOS] Multi-Zyklen gestartet. Kalibrierung läuft...");
  ns.ui.openTail();
  ns.ui.setTailTitle("Offline-Modus");
  ns.ui.resizeTail(600, 330);

  // Status-Monitoring
  let stableTicks = 0;
  let lastTotalIncome = 0;
  const startTime = Date.now();
  const maxWaitTime = Math.max(...Array.from(activeTargets).map((t) => ns.getWeakenTime(t))) + 5000;

  while (true) {
    let currentTotalIncome = 0;
    for (const server of hostServers) {
      for (const target of activeTargets) {
        const income = ns.getScriptIncome(workerScript, server, target);
        if (!isNaN(income) && income > 0) currentTotalIncome += income;
      }
    }

    ns.clearLog();
    ns.print(`============================================================`);
    ns.print(`🔥 BIT-OS CLUSTER-KALIBRIERUNG (${activeTargets.size} TARGETS)`);
    ns.print(`============================================================`);
    ns.print(`NETZWERK-PROD: $${ns.format.number(currentTotalIncome)} / Sekunde`);
    ns.print(`HACKNET-PROD:  $${ns.format.number(hacknetIncome)} / Sekunde`);
    ns.print(`============================================================`);

    if (currentTotalIncome > 0 && Math.abs(currentTotalIncome - lastTotalIncome) < currentTotalIncome * 0.05) {
      stableTicks++;
    } else if (currentTotalIncome > 0) {
      stableTicks = Math.max(1, stableTicks);
    }

    if (stableTicks >= 8 || Date.now() - startTime > maxWaitTime) break;

    lastTotalIncome = currentTotalIncome;
    await ns.sleep(3000);
  }

  ns.tprint(`🚀 [BitOS] NETZWERK STABILISIERT. Bereit für Offline-Phase.`);
}

// ====================================================================
// HILFSFUNKTIONEN
// ====================================================================

/**
 * Berechnet das aktuelle Hacknet-Einkommen pro Sekunde.
 * Berücksichtigt sowohl Hash-Produktion (Hacknet Servers) als auch direkte Money-Produktion (Hacknet Nodes).
 */
function calculateHacknetIncome(ns: NS): number {
  try {
    const numNodes = ns.hacknet.numNodes();
    if (numNodes === 0) return 0;

    // Prüfung auf Hacknet-Server (Hash-System)
    // 1 Hash entspricht bei 'Sell for Money' ungefähr $250.000 ($1M pro 4 Hashes)
    if ("getHashGainRate" in ns.hacknet) {
      const hashRate = (ns.hacknet as unknown as { getHashGainRate: () => number }).getHashGainRate();
      return hashRate * 250_000;
    }

    // Klassische Hacknet Nodes (direkter Geld-Ertrag)
    let totalProd = 0;
    for (let i = 0; i < numNodes; i++) {
      totalProd += ns.hacknet.getNodeStats(i).production;
    }
    return totalProd;
  } catch {
    return 0;
  }
}

function killWorkerScriptsOnServer(ns: NS, server: string): void {
  const activeProcesses = ns.ps(server);
  for (const proc of activeProcesses) {
    if (
      proc.filename.includes("hack.js") ||
      proc.filename.includes("grow.js") ||
      proc.filename.includes("weaken.js") ||
      proc.filename.includes("work.js")
    ) {
      ns.scriptKill(proc.filename, server);
    }
  }
}

function stopAllWorkers(ns: NS, allServers: string[]): void {
  for (const server of allServers) {
    if (ns.hasRootAccess(server)) {
      killWorkerScriptsOnServer(ns, server);
    }
  }
}