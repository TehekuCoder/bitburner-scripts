import { NS, Server } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  // Wichtig: w0r1d_d43m0n beendet das aktuelle BitNode! 
  // Sei vorsichtig, wenn du das vollautomatisch drin lässt.
  const priorityTargets: string[] = ["CSEC", "avmnite-02h", "I.I.I.I", "run4theh111z", "fulcrumassets", "w0r1d_d43m0n"];
  const AUTO_RAM_THRESHOLD = 128;
  const AUTO_CORES_THRESHOLD = 3;

  while (true) {
    const home: Server = ns.getServer("home") as Server;
    const allServers: string[] = scanNetwork(ns);
    const myHackLevel: number = ns.getHackingLevel();

    // TS-Sicherheit: Fallbacks für Eigenschaften, die theoretisch undefined sein könnten
    const homeRam: number = home.maxRam ?? 0;
    const homeCores: number = home.cpuCores ?? 1;

    // Logik-Definitionen
    const fullAutoMode: boolean = (homeRam >= AUTO_RAM_THRESHOLD && homeCores >= AUTO_CORES_THRESHOLD);
    const midAutoMode: boolean = (homeCores === 2);

    ns.print(`--- Scan-Zyklus: ${new Date().toLocaleTimeString()} ---`);
    ns.print(`Status: ${fullAutoMode ? "VOLL-AUTO" : midAutoMode ? "MID-AUTO (3-Port)" : "NUR PRIORITÄTEN"}`);
    ns.print(`Hardware: ${homeCores} Cores | ${ns.format.ram(homeRam)} RAM`);

    let targetsFound = 0;

    for (const target of allServers) {
      // 3.0.0 FIX: Darknet und unhackbare Spezial-Nodes filtern
      if (target === "darkweb" || target === "Darknet" || target.startsWith("hacknet-node")) continue;
      if (!ns.serverExists(target)) continue;

      const srv: Server = ns.getServer(target) as Server;
      const isPriority: boolean = priorityTargets.includes(target);

      const openPortsReq: number = srv.numOpenPortsRequired ?? 0;
      const reqHackingSkill: number = srv.requiredHackingSkill ?? 0;

      const shouldBackdoor: boolean = isPriority ||
        fullAutoMode ||
        (midAutoMode && openPortsReq <= 3);

      if (shouldBackdoor && !srv.backdoorInstalled && !srv.purchasedByPlayer && target !== "home") {
        if (!srv.hasAdminRights) continue;

        if (myHackLevel >= reqHackingSkill) {
          targetsFound++;
          ns.tprint(`[AUTO-BACKDOOR] Ziel identifiziert: ${target}`);

          const path: string[] | null = findPath(ns, target);
          if (path) {
            try {
              // Verbindung aufbauen
              for (const node of path) ns.singularity.connect(node);

              // 3.0.0 FIX: Explizites Await für die Backdoor-Infiltration
              ns.print(`Infiltriere ${target}...`);
              await ns.singularity.installBackdoor();
              ns.tprint(`[AUTO-BACKDOOR] ✅ ${target} erfolgreich infiltriert.`);
            } catch (e: unknown) {
              // TypeScript verlangt, dass geworfene Fehler als 'unknown' behandelt werden
              ns.tprint(`[AUTO-BACKDOOR] ❌ Fehler bei ${target}: ${String(e)}`);
            } finally {
              // IMMER zurück nach home, egal ob Erfolg oder Fehler
              ns.singularity.connect("home");
            }
            await ns.sleep(1000);
          }
        }
      }
    }

    if (targetsFound === 0) {
      ns.print("Status: Alle Ziele gemäß Policy gesichert.");
    }

    await ns.sleep(30000);
  }
}

// --- Hilfsfunktionen (Optimiert für 3.0.0 TS-Kernel) ---

function findPath(ns: NS, target: string): string[] | null {
  // Record<KeyType, ValueType> ist die saubere TS-Alternative zu einem simplen Objekt `{}`
  const paths: Record<string, string[]> = { "home": [] };
  const queue: string[] = ["home"];

  while (queue.length > 0) {
    const curr = queue.shift();
    // Wenn shift() undefined zurückgibt (leeres Array), abbrechen
    if (curr === undefined) continue;

    if (curr === target) return paths[curr];

    // scan() ist in 3.0.0 sicher gegen Darknet-Zyklen
    for (const next of ns.scan(curr)) {
      if (!paths[next]) {
        paths[next] = [...paths[curr], next];
        queue.push(next);
      }
    }
  }
  return null;
}

function scanNetwork(ns: NS): string[] {
  const visited = new Set<string>();
  const stack: string[] = ["home"];

  while (stack.length > 0) {
    const curr = stack.pop();
    if (curr !== undefined && !visited.has(curr)) {
      visited.add(curr);
      stack.push(...ns.scan(curr));
    }
  }
  return Array.from(visited);
}