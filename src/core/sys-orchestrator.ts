import { NS } from "@ns";
import { PATHS } from "/lib/paths.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { loadState } from "/lib/state.js";
import { getAllServers } from "/lib/network.js";

interface DaemonConfig {
  name: string;
  path: string;
  args?: (string | number)[];
  minHomeRam?: number;
  /** Custom Check, ob der Daemon im aktuellen BitNode / Spielstand Sinn macht */
  condition?: (ns: NS) => boolean;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "SysOrchestrator");
  logger.info("⚡ BitOS System-Orchestrator initiiert.");

  // Deklarative Registrierung aller Daemons nach Start-Priorität
  const daemons: DaemonConfig[] = [
    // 1. CCT Solver (Sofort Geld/Stats abgreifen, wenn Verträge existieren)
    {
      name: "CCT Solver Task",
      path: PATHS.tasks.cctSolver,
      condition: (ns) => {
        const state = loadState(ns);
        const nodes = state?.allServers?.length ? state.allServers : getAllServers(ns);
        return nodes.some((server) => ns.serverExists(server) && ns.ls(server, ".cct").length > 0);
      },
    },

    // 2. Intelligent Backdoor Service
    {
      name: "Backdoor Service",
      path: PATHS.daemons.backdoor,
      condition: (ns) => {
        if (ns.singularity === undefined) return false;
        const state = loadState(ns);
        const nodes = state?.allServers?.length ? state.allServers : getAllServers(ns);
        const playerHacking = ns.getHackingLevel();

        return nodes.some((node) => {
          if (["home", "darkweb", "Darknet", "w0r1d_d43m0n"].includes(node) || node.startsWith("hacknet-node")) {
            return false;
          }
          if (!ns.serverExists(node)) return false;
          const srv = ns.getServer(node);
          return (
            srv.hasAdminRights &&
            !srv.backdoorInstalled &&
            !srv.purchasedByPlayer &&
            playerHacking >= (srv.requiredHackingSkill ?? 0)
          );
        });
      },
    },

    // 3. Batch Orchestrator (Haupt-Geldquelle)
    {
      name: "Batch Orchestrator",
      path: PATHS.daemons.hackingOrchestrator,
      minHomeRam: 64,
    },

    // 4. Finance Manager
    {
      name: "Finance Manager",
      path: PATHS.daemons.financeDispatcher,
      minHomeRam: 128,
    },

    // 5. Hash Manager
    {
      name: "Hash Manager",
      path: PATHS.managers.hash,
      minHomeRam: 32,
      condition: (ns) => {
        try {
          return ns.hacknet.hashCapacity() > 0;
        } catch {
          return false;
        }
      },
    },

    // 6. Network Crawler & Darknet Subsystem
    {
      name: "Network Crawler",
      path: PATHS.daemons.crawler,
      minHomeRam: 512,
      condition: (ns) => ns.fileExists("DarkscapeNavigator.exe", "home"),
    },
    {
      name: "Darknet Subsystem",
      path: PATHS.managers.dnet,
      minHomeRam: 512,
      condition: (ns) => ns.fileExists("DarkscapeNavigator.exe", "home"),
    },

    // 7. Singularity Dispatcher (SF4)
    {
      name: "Singularity Dispatcher",
      path: PATHS.core.dispatcher,
      minHomeRam: 512,
      condition: (ns) => ns.singularity !== undefined,
    },

    // 8. Gang Manager
    {
      name: "Gang Manager",
      path: PATHS.managers.gang,
      minHomeRam: 256,
      condition: (ns) => {
        try {
          return ns.gang.inGang();
        } catch {
          return false;
        }
      },
    },

    // 9. Sleeve Manager
    {
      name: "Sleeve Manager",
      path: PATHS.managers.sleeve,
      minHomeRam: 512,
      condition: (ns) => ns.sleeve !== undefined,
    },

    // 10. Background Share Filler
    {
      name: "Share Filler",
      path: PATHS.daemons.fillShare,
      minHomeRam: 128,
    },
  ];

  while (true) {
    const maxRam = ns.getServerMaxRam("home");
    const usedRam = ns.getServerUsedRam("home");
    let freeRam = maxRam - usedRam;

    for (const daemon of daemons) {
      if (!daemon.path) continue;

      // Endung auflösen (.ts zu .js falls nötig)
      const execPath = daemon.path.endsWith(".ts")
        ? daemon.path.replace(/\.ts$/, ".js")
        : daemon.path;

      // 1. Skript-Existenz auf home prüfen
      if (!ns.fileExists(execPath, "home")) {
        continue;
      }

      // 2. Laufzeit-Status prüfen
      const args = daemon.args ?? [];
      if (ns.isRunning(execPath, "home", ...args)) {
        continue;
      }

      // 3. Hardware-Bedingung (Min RAM) prüfen
      if (daemon.minHomeRam && maxRam < daemon.minHomeRam) {
        continue;
      }

      // 4. Optionalen Bedingungs-Guard ausführen
      if (daemon.condition && !daemon.condition(ns)) {
        continue;
      }

      // 5. Dynamischen RAM-Bedarf abfragen & Allokation prüfen
      const reqRam = ns.getScriptRam(execPath, "home");

      if (freeRam >= reqRam) {
        const pid = ns.run(execPath, 1, ...args);
        if (pid > 0) {
          logger.success(`🚀 Daemon gestartet: ${daemon.name} [PID ${pid} | ${ns.format.ram(reqRam)}]`);
          freeRam -= reqRam;
        } else {
          logger.error(`❌ Fehlgeschlagen: ${daemon.name} konnte nicht gestartet werden.`);
        }
      } else {
        logger.debug(
          `⏳ RAM-Engpass für ${daemon.name} (Benötigt: ${ns.format.ram(reqRam)} | Frei: ${ns.format.ram(freeRam)})`
        );
      }
    }

    await ns.sleep(10000);
  }
}