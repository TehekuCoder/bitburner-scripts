import { NS } from "@ns";

const processedServers = new Set<string>();

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
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

    const nearbyServers = ns.dnet.probe();

    for (const hostname of nearbyServers) {
      if (hostname === "home" || processedServers.has(hostname)) continue;

      const details = ns.dnet.getServerDetails(hostname) as any;

      if (!details.isConnectedToCurrentServer || !details.isOnline) continue;

      let success = details.hasSession;

      // --- 🔥 FIX: DICTIONARY-ATTACK ERLAUBT NUN LEERE STRINGS & NUTZT SET ---
      if (!success && ns.fileExists("/passwords.txt", currentHost)) {
        const cachedPasswords = [
          ...new Set(
            ns
              .read("/passwords.txt")
              .split(/[\r\n,]+/)
              .map((p) => p.trim()),
          ),
        ];

        for (const pw of cachedPasswords) {
          if (details.passwordLength && pw.length > details.passwordLength)
            continue;

          const authResult = await ns.dnet.authenticate(hostname, pw);
          if (authResult && authResult.success) {
            ns.print(
              `🔑 [DICTIONARY-SUCCESS] Bekanntes Passwort funktioniert bei ${hostname}!`,
            );
            success = true;
            break;
          }
        }
      }

      // Falls kein bekanntes Passwort griff -> Solver starten
      if (!success) {
        if (ns.getServerMaxRam(currentHost) < 14) {
          ns.print(
            `⚠️ ${currentHost} hat zu wenig RAM für den Solver. Warte auf Passwort-Sync.`,
          );
          continue;
        }

        if (ns.scriptRunning("/tasks/dnet/dnet-loot.js", currentHost)) {
          ns.print(
            `🛑 Schließe dnet-loot.js, um RAM für den Solver freizugeben...`,
          );
          ns.scriptKill("/tasks/dnet/dnet-loot.js", currentHost);
          await ns.sleep(200);
        }

        ns.print(`📡 Target gesichtet: ${hostname}. Starte Solver...`);
        const solverPid = ns.exec(
          "/tasks/dnet/dnet-solver.js",
          currentHost,
          1,
          hostname,
          details.modelId || "Unknown",
          details.passwordLength || 0,
          details.passwordHint || "",
          details.data || "",
        );

        if (solverPid === 0) {
          ns.print(`[WARN] RAM-Squeeze fehlgeschlagen auf ${currentHost}.`);
          continue;
        }

        while (ns.isRunning(solverPid)) {
          await ns.sleep(200);
        }

        const postCheck = ns.dnet.getServerDetails(hostname) as any;
        success = postCheck && postCheck.hasSession;
      }

      // ECHTE REPLIKATION
      if (success) {
        processedServers.add(hostname);

        if (!ns.scriptRunning(scriptName, hostname)) {
          const targetMaxRam = ns.getServerMaxRam(hostname);

          if (targetMaxRam >= 8) {
            ns.print(
              `🎉 [SUCCESS] Session aktiv. Kopiere Infrastruktur auf ${hostname}...`,
            );

            const filesToCopy = [
              scriptName,
              "/tasks/dnet/dnet-solver.js",
              "/tasks/dnet/dnet-loot.js",
              "/passwords.txt",
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
