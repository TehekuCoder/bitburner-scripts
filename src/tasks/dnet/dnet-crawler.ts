import { NS } from "@ns";

const processedServers = new Set<string>();
const COOLDOWN_FILE = "/dnet-cooldowns.txt";
const COOLDOWN_MS = 5 * 60 * 1000;

function isServerInCooldown(ns: NS, host: string): boolean {
  if (!ns.fileExists(COOLDOWN_FILE)) return false;
  const lines = ns.read(COOLDOWN_FILE).split("\n");
  const now = Date.now();

  for (const line of lines) {
    const [cHost, cTime] = line.split(",");
    if (cHost === host) {
      if (now - Number(cTime) < COOLDOWN_MS) {
        return true;
      }
    }
  }
  return false;
}

// 🔥 NEU: Holt das Passwort direkt aus der strukturierten JSON-Datenbank
function getPasswordFromRegistry(ns: NS, host: string): string | null {
  const jsonDbFile = "/dnet-master-db.json";
  if (!ns.fileExists(jsonDbFile)) return null;

  try {
    const passwordDb = JSON.parse(ns.read(jsonDbFile));
    if (passwordDb && passwordDb[host] !== undefined) {
      return passwordDb[host]; // Gibt das Passwort zurück (auch wenn es "" ist!)
    }
  } catch {
    return null;
  }
  return null;
}

export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName();
  const currentHost = ns.getHostname();

  if (currentHost !== "home") {
    await ns.dnet.memoryReallocation();
  }

  while (true) {
    // 1. SMART LOOT CHECK
    const cacheFiles = ns.ls(currentHost, ".cache");
    const hasLoot = cacheFiles.length > 0;

    if (
      currentHost !== "home" &&
      hasLoot &&
      !ns.scriptRunning("/tasks/dnet/dnet-loot.js", currentHost)
    ) {
      const freeRam =
        ns.getServerMaxRam(currentHost) - ns.getServerUsedRam(currentHost);
      if (freeRam >= 6.5) {
        ns.print(
          `💰 Loot gefunden (${cacheFiles.length} Dateien). Starte dnet-loot.js...`,
        );
        ns.exec("/tasks/dnet/dnet-loot.js", currentHost, 1);
      }
    }

    // 2. NETZWERK-SCAN
    const nearbyServers = ns.dnet.probe();

    for (const hostname of nearbyServers) {
      if (hostname === "home" || processedServers.has(hostname)) continue;
      if (isServerInCooldown(ns, hostname)) continue;

      const details = ns.dnet.getServerDetails(hostname) as any;
      if (!details.isConnectedToCurrentServer || !details.isOnline) continue;

      const wasAlreadyOpen = details.hasSession;
      let success = wasAlreadyOpen;

      // Falls kein Passwort passte -> Solver rufen
      if (!success) {
        if (ns.getServerMaxRam(currentHost) < 14) {
          ns.print(
            `⚠️ ${currentHost} hat zu wenig RAM für den Solver. Warte auf Sync.`,
          );
          continue;
        }

        if (ns.scriptRunning("/tasks/dnet/dnet-loot.js", currentHost)) {
          ns.print(`🛑 Schließe dnet-loot.js für Solver-RAM...`);
          ns.scriptKill("/tasks/dnet/dnet-loot.js", currentHost);
          await ns.sleep(200);
        }

        ns.print(`📡 Target gesichtet: ${hostname}. Starte Krypto-Solver...`);
        const solverPid = ns.exec(
          "/tasks/dnet/dnet-solver.js",
          currentHost,
          1,
          hostname,
          details.modelId || "Unknown",
          details.passwordLength || 0,
          details.passwordHint || "", // 🔥 HIER: Einfach nur details.passwordHint
          details.data || "",
        );

        if (solverPid === 0) {
          ns.print(`[WARN] RAM-Squeeze fehlgeschlagen auf ${currentHost}.`);
          continue;
        }

        while (ns.isRunning(solverPid)) {
          await ns.sleep(200);
        }

        success = !isServerInCooldown(ns, hostname);
      }

      // 3. REPLIKATION & AUSBREITUNG
      if (success) {
        processedServers.add(hostname);

        if (!ns.scriptRunning(scriptName, hostname)) {
          const targetMaxRam = ns.getServerMaxRam(hostname);

          if (targetMaxRam >= 8) {
            // Authentifizierung bei geschlossenen Servern
            if (!wasAlreadyOpen) {
              const password = getPasswordFromRegistry(ns, hostname);

              // 🛡️ FIX: Explizit auf null prüfen, damit "" (ZeroLogon) als valides PW durchgeht!
              if (password === null) {
                ns.print(
                  `❌ Fehler: Kein Passwort für ${hostname} in /dnet-master-db.json gefunden!`,
                );
                continue;
              }

              ns.print(
                `🎉 [SUCCESS] Session aktiv. Authentifiziere mit Session...`,
              );
              await ns.dnet.connectToSession(hostname, password);
            } else {
              ns.print(
                `ℹ️ ${hostname} ist bereits offen. Überspringe Authentifizierung.`,
              );
            }

            ns.print(`📦 Kopiere Infrastruktur auf ${hostname}...`);

            const filesToCopy = [
              scriptName,
              "/tasks/dnet/dnet-solver.js",
              "/tasks/dnet/dnet-loot.js",
              "/dnet-master-db.json", // 🔥 FIX: Kopiert jetzt die JSON-Datenbank statt der txt!
              "/utils/progress.js",
            ];

            const modularSolvers = ns.ls(currentHost, "/modules/solvers/");
            if (modularSolvers.length > 0) {
              filesToCopy.push(...modularSolvers);
            }

            ns.scp(filesToCopy, hostname, currentHost);

            if (ns.fileExists("/tasks/dnet/dnet-stasis.js", hostname)) {
              ns.exec("/tasks/dnet/dnet-stasis.js", hostname, 1);
              while (ns.scriptRunning("/tasks/dnet/dnet-stasis.js", hostname)) {
                await ns.sleep(100);
              }
            }

            ns.exec(scriptName, hostname, 1);
          } else {
            ns.print(
              `ℹ️ ${hostname} hat zu wenig RAM (${targetMaxRam}GB) für Botnet-Knoten.`,
            );
          }
        }
      }
    }

    await ns.sleep(5000);
  }
}
