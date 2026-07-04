import { NS } from "@ns";

/**
 * Durchsucht das gesamte Bitburner-Netzwerk via hochperformantem Stack (DFS).
 * Gibt ein Array mit ALLEN Servernamen im Spiel zurück. Performance: O(1) beim Pop.
 */
export function getAllServers(ns: NS): string[] {
  const visited = new Set<string>(["home"]);
  const stack = ["home"]; // Stack statt Queue spart das teure .shift()

  while (stack.length > 0) {
    const current = stack.pop()!; // O(1) Operation
    const connections = ns.scan(current);

    for (const nextServer of connections) {
      if (!visited.has(nextServer)) {
        visited.add(nextServer);
        stack.push(nextServer);
      }
    }
  }
  return Array.from(visited);
}

/**
 * Findet den exakten Verbindungspfad von 'home' zu einem Zielserver.
 */
export function findPathTo(
  ns: NS,
  target: string,
  current = "home",
  visited = new Set<string>(),
): string[] | null {
  visited.add(current);

  if (current === target) return [current];

  const connections = ns.scan(current);
  for (const next of connections) {
    if (visited.has(next)) continue;
    const path = findPathTo(ns, target, next, visited);
    if (path) return [current, ...path];
  }

  return null;
}

/**
 * Scannt das gesamte Netzwerk und bricht vollautomatisch alle Server auf.
 * Optimiert: Stoppt das Ausführen von Cracks, sobald die nötige Port-Anzahl erreicht ist.
 */
export function breakAndInfectNetwork(ns: NS): void {
  const allServers = getAllServers(ns);

  const cricks = {
    ssh: { has: ns.fileExists("BruteSSH.exe", "home"), run: ns.brutessh },
    ftp: { has: ns.fileExists("FTPCrack.exe", "home"), run: ns.ftpcrack },
    smtp: { has: ns.fileExists("relaySMTP.exe", "home"), run: ns.relaysmtp },
    http: { has: ns.fileExists("HTTPWorm.exe", "home"), run: ns.httpworm },
    sql: { has: ns.fileExists("SQLInject.exe", "home"), run: ns.sqlinject },
  };

  // Zählen, wie viele Ports wir INSGESAMT öffnen können
  const maxPossiblePorts = Object.values(cricks).filter((c) => c.has).length;
  const playerHackingLevel = ns.getPlayer().skills.hacking;

  for (const server of allServers) {
    if (server === "home" || ns.hasRootAccess(server)) continue;

    const portsRequired = ns.getServerNumPortsRequired(server);
    const hackingLevelRequired = ns.getServerRequiredHackingLevel(server);

    // Prüfen, ob der Server aktuell überhaupt knackbar ist
    if (
      playerHackingLevel >= hackingLevelRequired &&
      maxPossiblePorts >= portsRequired
    ) {
      let portsOpened = 0;

      // Gezieltes Cracken: Nur so viele Ports öffnen, wie wirklich benötigt werden!
      if (portsOpened < portsRequired && cricks.ssh.has) {
        cricks.ssh.run(server);
        portsOpened++;
      }
      if (portsOpened < portsRequired && cricks.ftp.has) {
        cricks.ftp.run(server);
        portsOpened++;
      }
      if (portsOpened < portsRequired && cricks.smtp.has) {
        cricks.smtp.run(server);
        portsOpened++;
      }
      if (portsOpened < portsRequired && cricks.http.has) {
        cricks.http.run(server);
        portsOpened++;
      }
      if (portsOpened < portsRequired && cricks.sql.has) {
        cricks.sql.run(server);
        portsOpened++;
      }

      // lib/network.ts (in breakAndInfectNetwork)

      if (
        !ns.hasRootAccess(server) &&
        portsOpened >= ns.getServerNumPortsRequired(server)
      ) {
        ns.nuke(server);
        // Server wurde soeben gerootet -> Einmalig alles rüberschieben, was das System jemals braucht!
        ns.scp(
          [
            "tasks/work.js",
            "tasks/xp-grind.js",
            "tasks/weaken.js",
            "tasks/grow.js",
            "tasks/hack.js",
          ],
          server,
          "home",
        );
      }
      
      // Admin-Rechte zünden
      ns.nuke(server);
      ns.print(`🔓 Server erfolgreich gehackt: ${server}`);
    }
  }
}
