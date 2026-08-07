import { NS } from "@ns";

interface ContractInfo {
  server: string;
  file: string;
  type: string;
  triesLeft: number;
}

export async function main(ns: NS): Promise<void> {
  const visited = new Set<string>();
  const queue: string[] = ["home"];
  const contracts: ContractInfo[] = [];

  // Breitensuche über alle erreichbaren Server im Netzwerk
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    // Suche nach allen .cct Dateien auf dem aktuellen Server
    const files = ns.ls(current, ".cct");
    for (const file of files) {
      const type = ns.codingcontract.getContractType(file, current);
      const triesLeft = ns.codingcontract.getNumTriesRemaining(file, current);
      contracts.push({ server: current, file, type, triesLeft });
    }

    // Nachbarn zur Queue hinzufügen
    const neighbors = ns.scan(current);
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
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
    const statusColor = c.triesLeft <= 3 ? "FAIL" : "INFO";
    ns.tprintf(
      "📄 Server: %-20s | Datei: %-22s | Tries: %2d | Typ: %s",
      c.server,
      c.file,
      c.triesLeft,
      c.type
    );
  }
  ns.tprint("========================================================================\n");
}