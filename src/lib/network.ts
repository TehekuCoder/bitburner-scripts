import { NS } from "@ns";

/**
 * Durchsucht das gesamte Bitburner-Netzwerk via Breitensuche (BFS).
 * Gibt ein Array mit ALLEN Servernamen im Spiel zurück.
 */
export function getAllServers(ns: NS): string[] {
  const visited = new Set<string>(["home"]);
  const queue = ["home"];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const connections = ns.scan(current);

    for (const nextServer of connections) {
      if (!visited.has(nextServer)) {
        visited.add(nextServer);
        queue.push(nextServer);
      }
    }
  }
  return Array.from(visited);
}

/**
 * Findet den exakten Verbindungspfad von 'home' zu einem Zielserver.
 */
export function findPathTo(ns: NS, target: string, current = "home", visited = new Set<string>()): string[] | null {
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
 * Scannt das gesamte Netzwerk und bricht vollautomatisch alle Server auf,
 * für die die nötigen Programme und Hacking-Level vorhanden sind.
 */
export function breakAndInfectNetwork(ns: NS): void {
  const allServers = getAllServers(ns);

  // 1. Prüfen, welche Cracks wir aktuell besitzen
  const hasBrute = ns.fileExists("BruteSSH.exe", "home");
  const hasFTP = ns.fileExists("FTPCrack.exe", "home");
  const hasSMTP = ns.fileExists("relaySMTP.exe", "home");
  const hasWorm = ns.fileExists("HTTPWorm.exe", "home");
  const hasSQL = ns.fileExists("SQLInject.exe", "home");

  // Zählen, wie viele Ports wir maximal öffnen können
  let maxPossiblePorts = 0;
  if (hasBrute) maxPossiblePorts++;
  if (hasFTP) maxPossiblePorts++;
  if (hasSMTP) maxPossiblePorts++;
  if (hasWorm) maxPossiblePorts++;
  if (hasSQL) maxPossiblePorts++;

  const playerHackingLevel = ns.getPlayer().skills.hacking;

  for (const server of allServers) {
    // 'home' und bereits gerootete Server überspringen
    if (server === "home" || ns.hasRootAccess(server)) {
      continue;
    }

    const portsRequired = ns.getServerNumPortsRequired(server);
    const hackingLevelRequired = ns.getServerRequiredHackingLevel(server);

    // Prüfen, ob wir den Server theoretisch überhaupt schon knacken KÖNNEN
    if (playerHackingLevel >= hackingLevelRequired && maxPossiblePorts >= portsRequired) {
      
      // Ports Stück für Stück öffnen, sofern Programm vorhanden
      if (hasBrute) ns.brutessh(server);
      if (hasFTP) ns.ftpcrack(server);
      if (hasSMTP) ns.relaysmtp(server);
      if (hasWorm) ns.httpworm(server);
      if (hasSQL) ns.sqlinject(server);

      // Der finale Schlag: Admin-Rechte holen!
      ns.nuke(server);
      ns.print(`🔓 Server erfolgreich gehackt: ${server}`);
    }
  }
}