import { NS } from "@ns";

const processedServers = new Set<string>();

export async function main(ns: NS): Promise<void> {
  // ns.disableLog("ALL");
  const scriptName = ns.getScriptName(); // Wird automatisch zu "/tasks/dnet/dnet-crawler.js"
  const currentHost = ns.getHostname();

  if (currentHost !== "home") {
    await ns.dnet.memoryReallocation();
  }

  while (true) {
    // 1. Loot-Prozess asynchron auslagern (Pfad angepasst an /tasks/dnet/)
    if (
      currentHost !== "home" &&
      !ns.scriptRunning("/tasks/dnet/dnet-loot.js", currentHost)
    ) {
      ns.exec("/tasks/dnet/dnet-loot.js", currentHost, 1);
    }

    const nearbyServers = ns.dnet.probe();

    for (const hostname of nearbyServers) {
      if (hostname === "home" || processedServers.has(hostname)) continue;

      const details = ns.dnet.getServerDetails(hostname) as any;
      if (!details.isConnectedToCurrentServer) continue;

      let success = details.hasSession;

      // Falls noch KEIN Zugriff besteht -> Solver starten
      if (!success) {
        ns.print(`📡 Target gesichtet: ${hostname}. Starte Solver...`);

        // Pfad angepasst an /tasks/dnet/
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
          ns.print(
            `[WARN] Nicht genug RAM auf ${currentHost}, um Solver zu starten!`,
          );
          continue;
        }

        // Warten bis der Solver fertig ist
        while (ns.isRunning(solverPid)) {
          await ns.sleep(200);
        }

        const postCheck = ns.dnet.getServerDetails(hostname) as any;
        success = postCheck && postCheck.hasSession;
      }

      // Wenn wir Zugriff haben -> Auf den nächsten Server replizieren!
      if (success) {
        processedServers.add(hostname);

        if (!ns.scriptRunning(scriptName, hostname)) {
          ns.print(
            `🎉 [SUCCESS] Zugriff auf ${hostname} steht. Repliziere Infrastruktur...`,
          );

          if (ns.getServerMaxRam(hostname) >= 16) {
            // --- DYNAMISCHE DEPENDENCY-RESOLVER-LOGIK ---
            // Wir sammeln die Kernskripte...
            const filesToCopy = [
              scriptName,
              "/tasks/dnet/dnet-solver.js",
              "/tasks/dnet/dnet-loot.js",
              "/passwords.txt",
              "/utils/progress.js", // UI-Hilfsfunktion muss mit!
            ];

            // ...und packen automatisch ALLE modularen Sub-Solver aus /modules/solvers/ ein!
            const modularSolvers = ns.ls(currentHost, "/modules/solvers/");
            filesToCopy.push(...modularSolvers);

            // Datenübertragung zum Ziel-Server
            ns.scp(filesToCopy, hostname, currentHost);

            // Stasis-Hilfe ausführen, falls vorhanden
            if (ns.fileExists("/tasks/dnet/dnet-stasis.js", hostname)) {
              ns.exec("/tasks/dnet/dnet-stasis.js", hostname, 1);
              while (ns.scriptRunning("/tasks/dnet/dnet-stasis.js", hostname)) {
                await ns.sleep(100);
              }
            }

            // Crawler auf dem Remote-Server zünden
            ns.exec(scriptName, hostname, 1);
          } else {
            ns.print(
              `ℹ️ ${hostname} hat zu wenig RAM (${ns.getServerMaxRam(hostname)}GB) für eigenen Crawler.`,
            );
          }
        }
      }
    }
    await ns.sleep(5000);
  }
}
