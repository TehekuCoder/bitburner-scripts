// tools/find-path.ts
import { NS } from "@ns";
import { getAllServers } from "/lib/network.js";

interface BackdoorTarget {
  name: string;
  reqLevel: number;
  path: string[];
}

// Rekursive Pfadsuche (BFS/DFS) von 'home' zum Ziel
function findPath(ns: NS, current: string, target: string, visited = new Set<string>()): string[] | null {
  visited.add(current);
  if (current === target) return [current];

  const neighbors = ns.scan(current);
  for (const neighbor of neighbors) {
    if (!visited.has(neighbor)) {
      const path = findPath(ns, neighbor, target, new Set(visited));
      if (path) return [current, ...path];
    }
  }
  return null;
}

export async function main(ns: NS): Promise<void> {
  const playerHack = ns.getPlayer().skills.hacking;
  const allServers = getAllServers(ns);

  const targets: BackdoorTarget[] = [];

  for (const server of allServers) {
    if (server === "home" || server.startsWith("cloud-") ||server.startsWith("hacknet-server-")) continue;

    const sObj = ns.getServer(server);
    // Kriterien: Root-Zugriff vorhanden, aber noch KEIN Backdoor gesetzt
    if (sObj.hasAdminRights && !sObj.backdoorInstalled) {
      const path = findPath(ns, "home", server);
      if (path) {
        targets.push({
          name: server,
          reqLevel: sObj.requiredHackingSkill ?? 1,
          path,
        });
      }
    }
  }

  if (targets.length === 0) {
    ns.tprint("✅ [Backdoor-Finder] Alle gerooteten Server haben bereits ein Backdoor!");
    return;
  }

  // Sortieren: Nächstgelegene / erreichbare Ziele zuerst
  targets.sort((a, b) => a.reqLevel - b.reqLevel);

  ns.tprint("==========================================================");
  ns.tprint("🔍 [BitOS] UPCOMING BACKDOOR TARGETS");
  ns.tprint("==========================================================");

  for (const t of targets) {
    const isReady = playerHack >= t.reqLevel;
    const statusIcon = isReady ? "🟢 BEREIT" : "🔴 SPERRE";
    const levelInfo = `(Req: ${t.reqLevel} | Current: ${playerHack})`;
    
    // Connect-Befehl zusammenbauen
    const connectChain = t.path.slice(1).map((s) => `connect ${s}`).join("; ");
    const fullCmd = `home; ${connectChain}; backdoor`;

    ns.tprint(`${statusIcon.padEnd(10)} ${t.name.padEnd(18)} ${levelInfo}`);
    if (isReady) {
      ns.tprint(`   👉 Cmd:  ${fullCmd}`);
    }
  }
  ns.tprint("==========================================================");
}