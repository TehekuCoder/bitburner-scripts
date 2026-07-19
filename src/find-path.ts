import { NS, Server } from "@ns";
import { NetworkInfo } from "./core/types";

export async function main(ns: NS): Promise<void> {
  const network: NetworkInfo = scanNetworkFull(ns);
  const myLevel: number = ns.getHackingLevel();

  ns.tprint("--- 🚀 AUTO-ROUTER & BACKDOOR-CHECK ---");

  for (const serv of network.nodes) {
    if (serv === "home" || serv.startsWith("p-serv-")) continue;

    const serverObj: Server = ns.getServer(serv) as Server;
    const reqLevel: number = ns.getServerRequiredHackingLevel(serv);

    // Check: Keine Backdoor, Root vorhanden und Hacking-Level reicht aus
    if (!serverObj.backdoorInstalled && ns.hasRootAccess(serv) && myLevel >= reqLevel) {
      
      // Pfad rekonstruieren
      const path: string[] = [];
      let curr: string = serv;
      
      while (curr !== "home") {
        path.push(curr);
        curr = network.parentMap[curr];
      }
      path.reverse(); // Von home zum Ziel

      // Befehl für das Terminal zusammenbauen
      const command: string = "home; " + path.map(s => `connect ${s}`).join("; ") + "; backdoor";
      
      ns.tprint(`📍 ZIEL: ${serv}`);
      ns.tprint(`👉 BEFEHL: ${command}`);
      ns.tprint("---------------------------------------");
    }
  }
}

function scanNetworkFull(ns: NS): NetworkInfo {
  const nodes: string[] = ["home"];
  const parentMap: Record<string, string> = {}; 

  for (let i = 0; i < nodes.length; i++) {
    const current: string = nodes[i];
    const neighbors: string[] = ns.scan(current);

    for (const neighbor of neighbors) {
      if (!nodes.includes(neighbor)) {
        nodes.push(neighbor);
        parentMap[neighbor] = current; // Mapping für die Pfadrückverfolgung
      }
    }
  }
  return { nodes, parentMap };
}