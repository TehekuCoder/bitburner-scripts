import { NS, AutocompleteData } from "@ns";

const MAP_FILE = "/data/darknet-map.json";

interface NetworkMap {
  [hostname: string]: string[];
}

interface QueueNode {
  current: string;
  path: string[];
}

export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string;
  const currentHost = ns.getHostname();

  if (!target) {
    ns.tprint("❌ ERROR: Bitte gib ein Ziel an. Beispiel: run tools/find-darknet-path.js dark-node-03");
    return;
  }

  // Falls das Skript nicht auf 'home' läuft, holen wir die aktuelle Netzkarte von 'home'
  if (currentHost !== "home" && ns.fileExists(MAP_FILE, "home")) {
    ns.scp(MAP_FILE, currentHost, "home");
  }

  if (!ns.fileExists(MAP_FILE)) {
    ns.tprint("❌ ERROR: Keine Netzkarte gefunden! Starte zuerst: run tools/manual-darknet-crawler.js");
    return;
  }

  // Korrektur: ns.read() nimmt nur 1 Argument entgegen
  const map: NetworkMap = JSON.parse(ns.read(MAP_FILE));
  const startNode = currentHost;

  // BFS (Breitensuche) für den kürzesten Pfad über alle Ebenen
  const queue: QueueNode[] = [{ current: startNode, path: [startNode] }];
  const visited = new Set<string>([startNode]);
  let foundPath: string[] | null = null;

  while (queue.length > 0) {
    const { current, path } = queue.shift()!;

    if (current === target) {
      foundPath = path;
      break;
    }

    const neighbors = map[current] || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ current: neighbor, path: [...path, neighbor] });
      }
    }
  }

  if (!foundPath) {
    ns.tprint(`❌ Kein Pfad von '${startNode}' zu '${target}' in der aktuellen Netzkarte gefunden.`);
    ns.tprint("💡 Tipp: Führe 'run tools/manual-darknet-crawler.js' erneut aus, um neue Sessions zu erfassen.");
    return;
  }

  // Erstelle die fertige Command-Kette fürs Bitburner-Terminal
  const connectChain = foundPath.slice(1).map((s) => `connect ${s}`).join("; ");

  ns.tprint("==========================================================");
  ns.tprint(`🔍 [Darknet Path] Ziel: ${target} (${foundPath.length - 1} Hops entfernt)`);
  ns.tprint(`📍 Pfad: ${foundPath.join(" ➔ ")}`);
  ns.tprint(`👉 Terminal-Cmd: ${connectChain}`);
  ns.tprint("==========================================================");
}

export function autocomplete(data: AutocompleteData) {
  return data.servers;
}