import { NS } from "@ns";

interface QueueItem {
  server: string;
  path: string[];
}

interface ContractInfo {
  server: string;
  file: string;
  type: string;
  triesLeft: number;
  path: string[];
  connectCmd: string;
}

export async function main(ns: NS): Promise<void> {
  const visited = new Set<string>();
  // Queue speichert Server zusammen mit dem Pfad ab 'home'
  const queue: QueueItem[] = [{ server: "home", path: ["home"] }];
  const contracts: ContractInfo[] = [];

  // Breitensuche über alle erreichbaren Server im Netzwerk
  while (queue.length > 0) {
    const { server: current, path } = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    // Suche nach allen .cct Dateien auf dem aktuellen Server
    const files = ns.ls(current, ".cct");
    for (const file of files) {
      const type = ns.codingcontract.getContractType(file, current);
      const triesLeft = ns.codingcontract.getNumTriesRemaining(file, current);

      // Connect-Befehl zusammenbauen (analog zu find-path.ts)
      const connectChain = path.slice(1).map((s) => `connect ${s}`).join("; ");
      const connectCmd = path.length > 1 ? `home; ${connectChain}` : "home";

      contracts.push({
        server: current,
        file,
        type,
        triesLeft,
        path,
        connectCmd,
      });
    }

    // Nachbarn zur Queue hinzufügen und den Pfad verlängern
    const neighbors = ns.scan(current);
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push({
          server: neighbor,
          path: [...path, neighbor],
        });
      }
    }
  }

  // Terminal-Ausgabe
  if (contracts.length === 0) {
    ns.tprint("INFO: Keine Coding Contracts auf dem Netzwerk gefunden.");
    return;
  }

  ns.tprint(`\n=================== GEFUNDENE CODING CONTRACTS (${contracts.length}) ===================`);
  for (const c of contracts) {
    ns.tprintf(
      "📄 Server: %-18s | Datei: %-22s | Tries: %2d | Typ: %s",
      c.server,
      c.file,
      c.triesLeft,
      c.type
    );
    ns.tprint(`   👉 Pfad: ${c.path.join(" -> ")}`);
    ns.tprint(`   💻 Cmd:  ${c.connectCmd}\n`);
  }
  ns.tprint("========================================================================\n");
}