import { NS } from "@ns";

const processedServers = new Set<string>();
const COOLDOWN_FILE = "/dnet-cooldowns.txt";
const COOLDOWN_MS = 5 * 60 * 1000;
let lastLootTime = 0;
const LOOT_INTERVAL_MS = 3 * 60 * 1000;

function isServerInCooldown(ns: NS, host: string): boolean {
  if (!ns.fileExists(COOLDOWN_FILE)) return false;
  const lines = ns.read(COOLDOWN_FILE).split("\n");
  const now = Date.now();

  for (const line of lines) {
    const [cHost, cTime] = line.split(",");
    if (cHost === host) {
      return now - Number(cTime) < COOLDOWN_MS;
    }
  }
  return false;
}

function getPasswordFromRegistry(ns: NS, host: string): string | null {
  const jsonDbFile = "/dnet-master-db.json";
  if (!ns.fileExists(jsonDbFile)) return null;
  try {
    const passwordDb = JSON.parse(ns.read(jsonDbFile));
    if (passwordDb && passwordDb[host] !== undefined) {
      return passwordDb[host];
    }
  } catch {
    return null;
  }
  return null;
}

export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName();
  const currentHost = ns.getHostname();
  ns.disableLog("ALL");

  if (currentHost !== "home") {
    await ns.dnet.memoryReallocation();
  }

  while (true) {
    const now = Date.now();
    const solverScript = "/tasks/dnet/dnet-solver.js";
    const lootScript = "/tasks/dnet/dnet-loot.js";

    // 📊 ZENTRALE RAM- UND PROZESS-METRIKEN
    const maxRam = ns.getServerMaxRam(currentHost);
    const freeRam = maxRam - ns.getServerUsedRam(currentHost);
    let requiredSolverRam = ns.getScriptRam(solverScript, currentHost);
    const requiredLootRam = ns.getScriptRam(lootScript, currentHost) || 6.5;

    const isSolverRunning = ns.scriptRunning(solverScript, currentHost);
    const isLootRunning = ns.scriptRunning(lootScript, currentHost);
    const isLootDue =
      now - lastLootTime > LOOT_INTERVAL_MS && currentHost !== "home";

    // 1. NETZWERK-SCAN & REGISTRY-CHECK
    const nearbyServers = ns.dnet.probe();
    let targetToCrack: string | null = null;
    let targetDetails: any = null;

    for (const hostname of nearbyServers) {
      if (hostname === "home") continue;
      if (isServerInCooldown(ns, hostname)) continue;

      let details = ns.dnet.getServerDetails(hostname) as any;
      if (!details.isConnectedToCurrentServer || !details.isOnline) continue;

      // 🔑 Wenn keine Session aktiv ist, erst in der DB suchen!
      if (!details.hasSession) {
        const storedPassword = getPasswordFromRegistry(ns, hostname);
        if (storedPassword !== null) {
          ns.print(
            `🔑 Passwort für ${hostname} in Master-DB gefunden. Versuche Direkt-Login...`,
          );
          try {
            await ns.dnet.connectToSession(hostname, storedPassword);
            details = ns.dnet.getServerDetails(hostname) as any;
          } catch (e) {
            ns.print(
              `❌ Gespeichertes Passwort für ${hostname} schlug fehl: ${e}`,
            );
          }
        }
      }

      // Auswertung NACH dem eventuellen DB-Login-Versuch
      if (!details.hasSession) {
        if (!targetToCrack) {
          targetToCrack = hostname;
          targetDetails = details;
        }
      } else {
        processedServers.add(hostname);
      }
    }

    // 🚨 PRIO-WEICHE FÜR RAM-FREISETZUNG (EVICTION)
    if (isLootDue && !isLootRunning && maxRam >= requiredLootRam) {
      if (isSolverRunning) {
        ns.print(
          `🚨 Loot-Intervall fällig! Erzwinge RAM-Freisetzung für Looter (${requiredLootRam.toFixed(2)} GB)...`,
        );
        ns.scriptKill(solverScript, currentHost);
        await ns.sleep(200);
      }
      // Targets nullen, um den Durchlauf sauber in den Loot-Fallback zu zwingen
      targetToCrack = null;
      targetDetails = null;
    }

    // 2. ENTKOPPELTE WEICHE: DYNAMISCHER ORDNER-SYNC & SOLVER
    let solverStarted = false;

    if (targetToCrack && targetDetails) {
      // 🔥 RE-SYNC TRIGGER
      if (requiredSolverRam === 0) {
        ns.print(
          `📦 Solver-Abhängigkeiten fehlen auf ${currentHost}. Starte automatischen Datei-Sync von home...`,
        );
        ns.scp(solverScript, currentHost, "home");

        const solverModules = ns.ls("home", "/modules/solvers/");
        if (solverModules.length > 0) {
          ns.scp(solverModules, currentHost, "home");
          ns.print(
            `✅ ${solverModules.length} Krypto-Module erfolgreich nach ${currentHost} repliziert.`,
          );
        }
        requiredSolverRam = ns.getScriptRam(solverScript, currentHost);
      }

      // Wenn der Solver nun sauber aufgelöst ist und der RAM reicht:
      if (requiredSolverRam > 0 && freeRam >= requiredSolverRam) {
        if (isLootRunning) {
          ns.print(`🛑 Solver wird benötigt. Beende dnet-loot.js...`);
          ns.scriptKill(lootScript, currentHost);
          await ns.sleep(200);
        }

        if (!ns.scriptRunning(solverScript, currentHost)) {
          ns.print(
            `📡 Target gesichtet: ${targetToCrack}. Starte Krypto-Solver (${requiredSolverRam.toFixed(2)} GB)...`,
          );
          ns.exec(
            solverScript,
            currentHost,
            1,
            targetToCrack,
            targetDetails.modelId || "Unknown",
            targetDetails.passwordLength || 0,
            targetDetails.passwordHint || "",
            targetDetails.data || "",
          );
        }
        solverStarted = true;
      } else {
        ns.print(
          `ℹ️ ${targetToCrack} benötigt Solver. Lokaler RAM knapp (${freeRam.toFixed(1)} GB / benötigt: ${requiredSolverRam.toFixed(1)} GB). Überlasse Knacken dem restlichen Botnetz.`,
        );
      }
    }

    // FALLBACK: Wenn kein Solver läuft, darf dieser Server TROTZDEM looten!
    if (
      currentHost !== "home" &&
      !isSolverRunning &&
      !solverStarted &&
      !isLootRunning &&
      isLootDue
    ) {
      const phishScript = "/tasks/dnet/dnet-phish.js";

      // Safety-Sync für beide Worker-Dateien
      if (
        !ns.fileExists(phishScript, currentHost) ||
        !ns.fileExists(lootScript, currentHost)
      ) {
        ns.print(
          `📦 Loot-Infrastruktur unvollständig auf ${currentHost}. Synchronisiere von home...`,
        );
        ns.scp([phishScript, lootScript], currentHost, "home");
      }

      // Da wir nacheinander (sequentiell) starten, prüfen wir, ob genug RAM für das schwerere Skript da ist
      const phishRam = ns.getScriptRam(phishScript, currentHost);
      const lootRam = ns.getScriptRam(lootScript, currentHost);
      const requiredMaxWorkerRam = Math.max(phishRam, lootRam);

      if (freeRam >= requiredMaxWorkerRam) {
        ns.print("🔄 Starte periodischen Wartungs- und Beutezyklus...");

        // 🎰 PHASE 1: RAM freischalten & Phishing generieren
        ns.print("🎣 Phase 1: Starte Phishing & Reallocation...");
        const phishPid = ns.exec(phishScript, currentHost, 1);
        if (phishPid > 0) {
          while (ns.scriptRunning(phishScript, currentHost)) {
            await ns.sleep(500); // Warten, bis Phishing beendet ist
          }
        }

        // 🎰 PHASE 2: Caches auslesen und ernten
        ns.print("💰 Phase 2: Knacke generierte Caches...");
        const lootPid = ns.exec(lootScript, currentHost, 1);
        if (lootPid > 0) {
          while (ns.scriptRunning(lootScript, currentHost)) {
            await ns.sleep(500); // Warten, bis Looten vorbei ist
          }
        }

        lastLootTime = now;
        ns.print("✅ Wartungszyklus erfolgreich abgeschlossen.");
      } else {
        ns.print(
          `ℹ️ Looten verschoben: RAM knapp (Frei: ${freeRam.toFixed(1)} GB / Benötigt: ${requiredMaxWorkerRam} GB)`,
        );
      }
    }

    // 3. REPLIKATION / AUSBREITUNG
    for (const hostname of processedServers) {
      if (!ns.scriptRunning(scriptName, hostname)) {
        const targetMaxRam = ns.getServerMaxRam(hostname);
        if (targetMaxRam >= 8) {
          const details = ns.dnet.getServerDetails(hostname) as any;
          let sessionReady = details.hasSession;

          if (!sessionReady) {
            const password = getPasswordFromRegistry(ns, hostname);
            if (password !== null) {
              await ns.dnet.connectToSession(hostname, password);
              sessionReady = true;
            }
          }

          if (sessionReady) {
            ns.print(`📦 Kopiere Infrastruktur auf ${hostname}...`);
            const filesToCopy = [
              scriptName,
              solverScript,
              lootScript,
              "/tasks/dnet/dnet-phish.js",
              "/dnet-master-db.json",
              "/utils/progress.js",
            ];
            ns.scp(filesToCopy, hostname, currentHost);
            ns.exec(scriptName, hostname, 1);
          }
        }
      }
    }

    await ns.sleep(5000);
  }
}
