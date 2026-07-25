import { NS } from "@ns";
import { provisionServer } from "./provision.js";
import { getAllServers } from "/lib/network.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.tprint(
    "💤 [BitOS] Leite Schlafmodus ein. Initialisiere Multi-Target-Balancing...",
  );

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

  const validTargets = allServers
    .filter(
      (s) =>
        ns.hasRootAccess(s) &&
        ns.getServerMaxMoney(s) > 0 &&
        ns.getServerRequiredHackingLevel(s) <= playerHacking / 2,
    )
    .sort((a, b) => ns.getServerMaxMoney(b) - ns.getServerMaxMoney(a));

  if (validTargets.length === 0) {
    ns.tprint("❌ ERROR: Keine gültigen Hack-Ziele gefunden!");
    return;
  }

  const targetTier1 = validTargets[0];
  const targetTier2 = validTargets[1] || targetTier1;
  const targetTier3 = validTargets[2] || targetTier2;

  ns.tprint(`🎯 [BitOS] Lastverteilung aktiv:`);
  ns.tprint(
    `   - Tier 1 (High RAM / Home) -> ${targetTier1} ($${ns.format.number(ns.getServerMaxMoney(targetTier1))})`,
  );
  ns.tprint(
    `   - Tier 2 (Mid-Range/P-Serv) -> ${targetTier2} ($${ns.format.number(ns.getServerMaxMoney(targetTier2))})`,
  );
  ns.tprint(
    `   - Tier 3 (Low-RAM Network)  -> ${targetTier3} ($${ns.format.number(ns.getServerMaxMoney(targetTier3))})`,
  );

  // ====================================================================
  // SCHRITT 3: WORKER-VERTEILUNG NACH LEISTUNGSKLASSE
  // ====================================================================
  const pServers = ns.cloud.getServerNames();
  const workerScript = "payloads/work.js";
  const workerRam = ns.getScriptRam(workerScript);

  // 🛡️ SICHERHEITS-CHECK: Existiert das Worker-Skript auf 'home'?
  if (!Number.isFinite(workerRam) || workerRam <= 0) {
    ns.tprint(
      `❌ ERROR: Worker-Skript '${workerScript}' wurde nicht gefunden oder benötigt 0 GB RAM! Checke den Dateipfad (.js vs .ts).`,
    );
    return;
  }

  const hostServers = allServers.filter(
    (s) =>
      s === "home" ||
      pServers.includes(s) ||
      (ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0),
  );

  let totalShareThreads = 0;
  const activeTargets = new Set<string>();

  for (const server of hostServers) {
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

    // 🛡️ Root-/Provisionierungs-Check
    await provisionServer(ns, server);

    const reserve = server === "home" ? 32 : 0;
    const maxRam = Math.max(0, ns.getServerMaxRam(server) - reserve);
    const usedRam = ns.getServerUsedRam(server);
    const freeRam = Math.max(0, maxRam - usedRam);

    // 🛡️ Expliziter Guard gegen Division durch Null / Infinity
    const threads = Math.floor(freeRam / workerRam);

    if (Number.isFinite(threads) && threads > 0) {
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
  // 📊 MONITORING MIT DYNAMISCHER WARTEZEIT-SCHÄTZUNG
  // ====================================================================
  if (activeTargets.size === 0) {
    ns.tprint("❌ ERROR: Keine Worker gestartet (unzureichender RAM im Netz).");
    return;
  }

  ns.tprint("⏳ [BitOS] Multi-Zyklen gestartet. Kalibrierung läuft...");
  ns.ui.openTail();
  ns.ui.setTailTitle("Offline-Modus");
  ns.ui.resizeTail(583, 312);

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
    ns.print(`🔥 BIT-OS CLUSTER-KALIBRIERUNG (MULTI-TARGET MODUS)`);
    ns.print(`============================================================`);
    ns.print(`AKTIVE CLUSTER-ZIELE: ${Array.from(activeTargets).join(", ")}`);
    ns.print(
      `LAUFZEIT:             ${elapsedSecs}s / Failsafe: ${Math.floor(maxWaitTime / 1000)}s`,
    );

    if (currentTotalIncome === 0) {
      ns.print(
        `⚠️ WARTEZEIT-SCHÄTZUNG: ca. ${remainingSecs}s bis zum ersten Profit...`,
      );
      ns.print(`                      (Server-Präparation läuft noch)`);
    } else {
      ns.print(`✅ STATUS:            Netzwerk produziert aktiv.`);
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
