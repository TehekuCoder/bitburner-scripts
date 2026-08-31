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

function isModuleDisabled(state: any, moduleName: string | string[]): boolean {
  if (!state?.disabledModules || !Array.isArray(state.disabledModules))
    return false;
  const names = Array.isArray(moduleName) ? moduleName : [moduleName];
  return names.some((name) => state.disabledModules.includes(name));
}

function isManualMode(state: any): boolean {
  return Boolean(state?.manualMode || state?.strategy === "MANUAL");
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
        if (isModuleDisabled(state, ["cct", "solver"])) return false;
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
        const state = loadState(ns);
        if (isModuleDisabled(state, ["backdoor", "singularity"])) return false;
        if (!hasSingularity(ns)) return false;

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
      condition: (ns) => {
        const state = loadState(ns);
        return !isModuleDisabled(state, ["finance", "stock"]);
      },
    },

    // 4. Hash Manager
    {
      name: "Hash Manager",
      path: PATHS.services.managers.hash,
      minHomeRam: 32,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, "hacknet")) return false;
        try {
          return ns.hacknet.hashCapacity() > 0;
        } catch {
          return false;
        }
      },
    },

    // 4b. IPvGo Manager
    {
      name: "IPvGo Manager",
      path: PATHS.services.managers.ipvgo,
      minHomeRam: 64,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, ["ipvgo", "go"])) return false;
        try {
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
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, ["crawler", "darknet"])) return false;
        return ns.fileExists("DarkscapeNavigator.exe", "home");
      },
    },
    {
      name: "Darknet Subsystem",
      path: PATHS.services.managers.dnet,
      minHomeRam: 512,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, ["dnet", "darknet", "stock"])) return false;
        return ns.fileExists("DarkscapeNavigator.exe", "home");
      },
    },

    // 6. Singularity Dispatcher (im Manual Mode automatisch inaktiv)
    {
      name: "Singularity Dispatcher",
      path: PATHS.app.orchestration.dispatcher,
      minHomeRam: 512,
      condition: (ns) => {
        const state = loadState(ns);
        if (isManualMode(state)) return false;
        if (isModuleDisabled(state, ["dispatcher", "singularity"]))
          return false;
        return hasSingularity(ns);
      },
    },

    // Roadmap UI
    {
      name: "Roadmap UI",
      path: PATHS.ui.roadmap,
      minHomeRam: 32,
      condition: (ns) => {
        const state = loadState(ns);
        return !isModuleDisabled(state, ["ui", "roadmap"]);
      },
    },

    // 7. Gang Manager & UI
    {
      name: "Gang Manager",
      path: PATHS.services.managers.gang,
      minHomeRam: 256,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, "gang")) return false;
        return hasGang(ns) && ns.gang.inGang();
      },
    },
    {
      name: "Gang UI",
      path: PATHS.ui.gang,
      minHomeRam: 256,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, ["gang", "ui"])) return false;
        return hasGang(ns) && ns.gang.inGang();
      },
    },

    // 8. Sleeve Manager & UI
    {
      name: "Sleeve Manager",
      path: PATHS.services.managers.sleeve,
      minHomeRam: 512,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, "sleeve")) return false;
        return hasSleeve(ns);
      },
    },
    {
      name: "Sleeve UI",
      path: PATHS.ui.sleeve,
      minHomeRam: 512,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, ["sleeve", "ui"])) return false;
        return hasSleeve(ns);
      },
    },

    // 9. Corporation Manager & UI
    {
      name: "Corporation Manager",
      path: PATHS.services.managers.corporation,
      minHomeRam: 2048,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, ["corporation", "corp"])) return false;
        return (
          hasCorporation(ns) &&
          (ns.corporation.hasCorporation() ||
            ns.getServerMoneyAvailable("home") >= 150e9)
        );
      },
    },
    {
      name: "Corporation UI",
      path: PATHS.ui.corporation,
      minHomeRam: 2048,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, ["corporation", "corp", "ui"]))
          return false;
        return hasCorporation(ns) && ns.corporation.hasCorporation();
      },
    },

    // 10. Bladeburner Manager
    {
      name: "Bladeburner Manager",
      path: PATHS.services.managers.bladeburner,
      minHomeRam: 128,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, "bladeburner")) return false;
        try {
          return (
            typeof ns.bladeburner !== "undefined" &&
            (ns.bladeburner.inBladeburner() ||
              ns.getPlayer().skills.strength >= 100)
          );
        } catch {
          return false;
        }
      },
    },

    // 11. Batch Orchestrator
    {
      name: "Batch Orchestrator",
      path: PATHS.services.daemons.hackingOrchestrator,
      minHomeRam: 64,
      condition: (ns) => {
        const state = loadState(ns);
        return !isModuleDisabled(state, ["batcher", "hacking"]);
      },
    },

    // 12. Background Share Filler
    {
      name: "Share Filler",
      path: PATHS.services.daemons.fillShare,
      minHomeRam: 512,
      condition: (ns) => {
        const state = loadState(ns);
        return !isModuleDisabled(state, ["share", "filler"]);
      },
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
      const isRunning = ns.isRunning(execPath, "home", ...args);

      // Falls die Bedinung/Sperre greift, aber das Skript bereits läuft -> automatisch beenden
      if (daemon.condition && !daemon.condition(ns)) {
        if (isRunning) {
          logger.warn(
            `🛑 Modus/Deaktivierung erkannt: Beende Daemon ${daemon.name}...`,
          );
          ns.scriptKill(execPath, "home");
        }
        continue;
      }

      if (isRunning) continue;
      if (daemon.minHomeRam && maxRam < daemon.minHomeRam) continue;

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
