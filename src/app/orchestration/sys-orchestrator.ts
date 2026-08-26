import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { getAllServers } from "/infrastructure/network/network";
import { PATHS } from "/infrastructure/runtime/paths";
import { loadState } from "/infrastructure/state/state";
import { hasSingularity, hasGang, hasSleeve, hasCorporation } from "/lib/utils";

interface DaemonConfig {
  name: string;
  path: string;
  args?: (string | number)[];
  minHomeRam?: number;
  condition?: (ns: NS) => boolean;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new LoggerClient(ns, "SysOrchestrator");
  logger.info("⚡ BitOS System-Orchestrator initiiert.");

  const daemons: DaemonConfig[] = [
    // 1. CCT Solver Task
    {
      name: "CCT Solver Task",
      path: PATHS.domain.tasks.cctSolver,
      condition: (ns) => {
        const state = loadState(ns);
        const nodes = state?.allServers?.length
          ? state.allServers
          : getAllServers(ns);
        return nodes.some(
          (server) =>
            ns.serverExists(server) && ns.ls(server, ".cct").length > 0,
        );
      },
    },

    // 2. Intelligent Backdoor Service (SF4 / Singularity)
    {
      name: "Backdoor Service",
      path: PATHS.services.daemons.backdoor,
      condition: (ns) => {
        if (!hasSingularity(ns)) return false;
        const state = loadState(ns);
        const nodes = state?.allServers?.length
          ? state.allServers
          : getAllServers(ns);
        const playerHacking = ns.getHackingLevel();

        return nodes.some((node) => {
          if (
            ["home", "darkweb", "Darknet", "w0r1d_d43m0n"].includes(node) ||
            node.startsWith("hacknet-node")
          ) {
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

    // 3. Finance Manager
    {
      name: "Finance Manager",
      path: PATHS.services.daemons.financeDispatcher,
      minHomeRam: 128,
    },

    // 4. Hash Manager
    {
      name: "Hash Manager",
      path: PATHS.services.managers.hash,
      minHomeRam: 32,
      condition: (ns) => {
        try {
          return ns.hacknet.hashCapacity() > 0;
        } catch {
          return false;
        }
      },
    },

    // 4b. IPvGo Manager (Passive Boni über Go-Spiele)
    {
      name: "IPvGo Manager",
      path: PATHS.services.managers.ipvgo,
      args: ["Netburners", 5], // Standard-Gegner & Boardgröße
      minHomeRam: 64,
      condition: (ns) => {
        try {
          // Prüft, ob die ns.go API vorhanden und aufrufbar ist
          return (
            typeof ns.go !== "undefined" &&
            typeof ns.go.getBoardState === "function"
          );
        } catch {
          return false;
        }
      },
    },

    // 5. Network Crawler & Darknet Subsystem
    {
      name: "Network Crawler",
      path: PATHS.services.daemons.crawler,
      minHomeRam: 512,
      condition: (ns) => ns.fileExists("DarkscapeNavigator.exe", "home"),
    },
    {
      name: "Darknet Subsystem",
      path: PATHS.services.managers.dnet,
      minHomeRam: 512,
      condition: (ns) => ns.fileExists("DarkscapeNavigator.exe", "home"),
    },

    // 6. Singularity Dispatcher (SF4)
    {
      name: "Singularity Dispatcher",
      path: PATHS.app.orchestration.dispatcher,
      minHomeRam: 512,
      condition: (ns) => hasSingularity(ns),
    },

    // Roadmap UI
    {
      name: "Roadmap UI",
      path: PATHS.ui.roadmap,
      minHomeRam: 32,
      condition: () => true,
    },

    // 7. Gang Manager & UI (SF2)
    {
      name: "Gang Manager",
      path: PATHS.services.managers.gang,
      minHomeRam: 256,
      condition: (ns) => hasGang(ns) && ns.gang.inGang(),
    },
    {
      name: "Gang UI",
      path: PATHS.ui.gang,
      minHomeRam: 256,
      condition: (ns) => hasGang(ns) && ns.gang.inGang(),
    },

    // 8. Sleeve Manager & UI (SF10)
    {
      name: "Sleeve Manager",
      path: PATHS.services.managers.sleeve,
      minHomeRam: 512,
      condition: (ns) => hasSleeve(ns),
    },
    {
      name: "Sleeve UI",
      path: PATHS.ui.sleeve,
      minHomeRam: 512,
      condition: (ns) => hasSleeve(ns),
    },

    // 9. Corporation Manager & UI (SF3)
    {
      name: "Corporation Manager",
      path: PATHS.services.managers.corporation,
      minHomeRam: 1024,
      condition: (ns) =>
        hasCorporation(ns) &&
        (ns.corporation.hasCorporation() ||
          ns.getServerMoneyAvailable("home") >= 150e9),
    },
    {
      name: "Corporation UI",
      path: PATHS.ui.corporation,
      minHomeRam: 1024,
      condition: (ns) => hasCorporation(ns) && ns.corporation.hasCorporation(),
    },

    // 10. Batch Orchestrator
    {
      name: "Batch Orchestrator",
      path: PATHS.services.daemons.hackingOrchestrator,
      minHomeRam: 64,
    },

    // 11. Background Share Filler
    {
      name: "Share Filler",
      path: PATHS.services.daemons.fillShare,
      minHomeRam: 512,
    },
  ];

  while (true) {
    const maxRam = ns.getServerMaxRam("home");
    const usedRam = ns.getServerUsedRam("home");
    let freeRam = maxRam - usedRam;

    for (const daemon of daemons) {
      if (!daemon.path) continue;

      const execPath = daemon.path.endsWith(".ts")
        ? daemon.path.replace(/\.ts$/, ".js")
        : daemon.path;

      if (!ns.fileExists(execPath, "home")) continue;

      const args = daemon.args ?? [];
      if (ns.isRunning(execPath, "home", ...args)) continue;

      if (daemon.minHomeRam && maxRam < daemon.minHomeRam) continue;

      if (daemon.condition && !daemon.condition(ns)) continue;

      const reqRam = ns.getScriptRam(execPath, "home");

      if (freeRam >= reqRam) {
        const pid = ns.run(execPath, 1, ...args);
        if (pid > 0) {
          logger.success(
            `🚀 Daemon gestartet: ${daemon.name} [PID ${pid} | ${ns.format.ram(reqRam)}]`,
          );
          freeRam -= reqRam;
        } else {
          logger.error(
            `❌ Fehlgeschlagen: ${daemon.name} konnte nicht gestartet werden.`,
          );
        }
      } else {
        logger.debug(
          `⏳ RAM-Engpass für ${daemon.name} (Benötigt: ${ns.format.ram(reqRam)} | Frei: ${ns.format.ram(freeRam)})`,
        );
      }
    }

    await ns.sleep(10000);
  }
}
