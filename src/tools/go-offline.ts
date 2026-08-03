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
  ns.tprint(
    "💤 [BitOS] Leite Schlafmodus ein. Initialisiere dynamisches Multi-Target-Balancing...",
  );

  // ====================================================================
  // SCHRITT 1: CLEANUP AUF HOME
  // ====================================================================
  ns.killall("home", true);
  await ns.sleep(500);

  // ====================================================================
  // SCHRITT 2: DYNAMISCHE EVALUIERUNG ALLER ZIELE (SCORE: MONEY / TIME)
  // ====================================================================
  const playerHacking = ns.getPlayer().skills.hacking;
  const allServers = getAllServers(ns);

  // Filtern: Root-Zugriff, Geld vorhanden & Hack-Level erreichbar
  const validTargets: TargetScore[] = allServers
    .filter(
      (s) =>
        ns.hasRootAccess(s) &&
        ns.getServerMaxMoney(s) > 0 &&
        ns.getServerRequiredHackingLevel(s) <= playerHacking, // Keine künstliche Halbung mehr!
    )
    .map((s) => {
      const maxMoney = ns.getServerMaxMoney(s);
      const weakenTime = ns.getWeakenTime(s);
      // Score = Ertrag pro Sekunde Aufwand
      const score = maxMoney / Math.max(1, weakenTime);
      return { name: s, score, maxMoney, weakenTime };
    })
    .sort((a, b) => b.score - a.score);

  if (validTargets.length === 0) {
    ns.tprint("❌ ERROR: Keine gültigen Hack-Ziele gefunden!");
    return;
  }

  // Wähle dynamisch bis zu 8 der besten Ziele
  const TARGET_COUNT = Math.min(validTargets.length, 8);
  const topTargets = validTargets.slice(0, TARGET_COUNT);

  ns.tprint(`🎯 [BitOS] Dynamische Lastverteilung gestartet (${topTargets.length} Ziele aktiv):`);
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
    ns.tprint(
      `❌ ERROR: Worker-Skript '${workerScript}' nicht gefunden oder benötigt 0 GB RAM!`,
    );
    return;
  }

  // Alle verfügbaren Ausführungs-Hosts ermitteln und nach RAM sortieren (stärkste zuerst!)
  const hostServers = allServers
    .filter(
      (s) =>
        s === "home" ||
        pServers.includes(s) ||
        (ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0),
    )
    .sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a));

  let totalShareThreads = 0;
  const activeTargets = new Set<string>();

  for (let i = 0; i < hostServers.length; i++) {
    const server = hostServers[i];
    const activeProcesses = ns.ps(server);

    if (server !== "home") {
      for (const proc of activeProcesses) {
        if (proc.filename.includes("share")) {
          totalShareThreads += proc.threads;
        } else if (
          proc.filename.includes("hack.js") ||
          proc.filename.includes("grow.js") ||
          proc.filename.includes("weaken.js") ||
          proc.filename.includes("work.js")
        ) {
          ns.scriptKill(proc.filename, server);
        }
      }
      await ns.sleep(20);
    }

    // Root / Root-Tools sicherstellen
    await provisionServer(ns, server);

    const reserve = server === "home" ? 32 : 0;
    const maxRam = Math.max(0, ns.getServerMaxRam(server) - reserve);
    const usedRam = ns.getServerUsedRam(server);
    const freeRam = Math.max(0, maxRam - usedRam);

    const threads = Math.floor(freeRam / workerRam);

    if (Number.isFinite(threads) && threads > 0) {
      // Round-Robin Verteilung: Stärkste Hosts bedienen die Top-Ranked Targets!
      const targetIndex = i % topTargets.length;
      const assignedTarget = topTargets[targetIndex].name;

      activeTargets.add(assignedTarget);

      if (server !== "home") ns.scp(workerScript, server, "home");

      const pid = ns.exec(workerScript, server, threads, assignedTarget);
      if (pid === 0) {
        ns.print(
          `⚠️ Exec fehlgeschlagen auf ${server} mit ${threads} Threads für ${assignedTarget}`,
        );
      }
    }
  }

  // ====================================================================
  // SCHRITT 4: MONITORING & KALIBRIERUNG
  // ====================================================================
  if (activeTargets.size === 0) {
    ns.tprint("❌ ERROR: Keine Worker gestartet (unzureichender RAM im Netz).");
    return;
  }

  ns.tprint("⏳ [BitOS] Multi-Zyklen gestartet. Kalibrierung läuft...");
  ns.ui.openTail();
  ns.ui.setTailTitle("Offline-Modus");
  ns.ui.resizeTail(600, 330);

  let stableTicks = 0;
  let lastTotalIncome = 0;
  const startTime = Date.now();

  const longestWeakenTime = Math.max(
    ...Array.from(activeTargets).map((t) => ns.getWeakenTime(t)),
  );
  const maxWaitTime = longestWeakenTime + 5000;

  while (true) {
    let currentTotalIncome = 0;

    for (const server of hostServers) {
      for (const target of activeTargets) {
        const income = ns.getScriptIncome(workerScript, server, target);
        if (!isNaN(income) && income > 0) {
          currentTotalIncome += income;
        }
      }
    }

    const elapsedMs = Date.now() - startTime;
    const elapsedSecs = Math.floor(elapsedMs / 1000);
    const remainingMs = Math.max(0, maxWaitTime - elapsedMs);
    const remainingSecs = Math.ceil(remainingMs / 1000);

    ns.clearLog();
    ns.print(`============================================================`);
    ns.print(`🔥 BIT-OS CLUSTER-KALIBRIERUNG (${activeTargets.size} TARGETS)`);
    ns.print(`============================================================`);
    ns.print(`AKTIVE ZIELE: ${Array.from(activeTargets).join(", ")}`);
    ns.print(
      `LAUFZEIT:     ${elapsedSecs}s / Failsafe: ${Math.floor(maxWaitTime / 1000)}s`,
    );

    if (currentTotalIncome === 0) {
      ns.print(
        `⚠️ WARTEZEIT-SCHÄTZUNG: ca. ${remainingSecs}s bis zum ersten Profit...`,
      );
      ns.print(`                      (Server-Präparation läuft noch)`);
    } else {
      ns.print(`✅ STATUS:             Netzwerk produziert aktiv.`);
    }
    ns.print(`------------------------------------------------------------`);

    if (currentTotalIncome < 0) {
      ns.print(`NETZWERK-PROD:        🚀 Hyper-Produktion (> $10q/s)`);
    } else {
      ns.print(
        `NETZWERK-PROD:        $${ns.format.number(currentTotalIncome)} / Sekunde`,
      );
      ns.print(
        `Hochrechnung / Std:   $${ns.format.number(currentTotalIncome * 3600)} / Stunde`,
      );
    }

    ns.print(`🛡️ UTILITY:            ${totalShareThreads} Share-Threads aktiv`);
    const bar = "█".repeat(stableTicks) + "░".repeat(8 - stableTicks);
    ns.print(`STABILITÄT:           [${bar}] (${stableTicks}/8 Ticks)`);
    ns.print(`============================================================`);

    if (currentTotalIncome < 0) {
      stableTicks++;
    } else if (
      currentTotalIncome > 0 &&
      Math.abs(currentTotalIncome - lastTotalIncome) < currentTotalIncome * 0.05
    ) {
      stableTicks++;
    } else if (currentTotalIncome > 0) {
      stableTicks = Math.max(1, stableTicks);
    } else {
      if (lastTotalIncome > 0) {
        stableTicks = 0;
      }
    }

    if (stableTicks >= 8 || elapsedMs > maxWaitTime) {
      break;
    }

    lastTotalIncome = currentTotalIncome;
    await ns.sleep(3000);
  }

  ns.tprint(`🚀 [BitOS] NETZWERK STABILISIERT. Bereit für Offline-Phase.`);
}