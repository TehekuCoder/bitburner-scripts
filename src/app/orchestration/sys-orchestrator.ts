import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import {
  getAllRootedServersIncludingPurchased,
  getAllServers,
} from "/infrastructure/network/network";
import { PATHS } from "/infrastructure/runtime/paths";
import { loadState } from "/infrastructure/state/state";
import { hasSingularity, hasGang, hasSleeve, hasCorporation, isCorporationViable } from "/lib/utils";

interface DaemonConfig {
  name: string;
  path: string;
  args?: (string | number)[];
  priority?: number;
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
      priority: 10,
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
      condition: (ns) => {
        const state = loadState(ns);
        return !isModuleDisabled(state, ["finance", "stock"]);
      },
    },

    // 4. Hash Manager
    {
      name: "Hash Manager",
      path: PATHS.services.managers.hash,
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
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, ["crawler", "darknet"])) return false;
        return ns.fileExists("DarkscapeNavigator.exe", "home");
      },
    },
    {
      name: "Darknet Subsystem",
      path: PATHS.services.managers.dnet,
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
      priority: 10,
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
      condition: (ns) => {
        const state = loadState(ns);
        return !isModuleDisabled(state, ["ui", "roadmap"]);
      },
    },

    // 7. Gang Manager & UI
    {
      name: "Gang Manager",
      path: PATHS.services.managers.gang,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, "gang")) return false;
        return hasGang(ns) && ns.gang.inGang();
      },
    },
    {
      name: "Gang UI",
      path: PATHS.ui.gang,
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
      priority: 20,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, "sleeve")) return false;
        return hasSleeve(ns);
      },
    },
    {
      name: "Sleeve UI",
      path: PATHS.ui.sleeve,
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
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, ["corporation", "corp"])) return false;
        return isCorporationViable(ns);
      },
    },
    {
      name: "Corporation UI",
      path: PATHS.ui.corporation,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, ["corporation", "corp", "ui"]))
          return false;
        return hasCorporation(ns) && ns.corporation.hasCorporation();
      },
    },

    // 10. Bladeburner Manager & Daemon
    {
      name: "Bladeburner Manager",
      path: PATHS.services.managers.bladeburner,
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

    // 10b. Stanek Manager & Charger
    {
      name: "Stanek Manager",
      path: PATHS.services.managers.stanek,
      condition: (ns) => {
        const state = loadState(ns);
        if (isModuleDisabled(state, ["stanek", "church"])) return false;
        try {
          return typeof ns.stanek !== "undefined";
        } catch {
          return false;
        }
      },
    },

    // 11. Batch Orchestrator
    {
      name: "Batch Orchestrator",
      path: PATHS.services.daemons.hackingOrchestrator,
      priority: 30,
      condition: (ns) => {
        const state = loadState(ns);
        return !isModuleDisabled(state, ["batcher", "hacking"]);
      },
    },

    // 12. Background Share Filler
    {
      name: "Share Filler",
      path: PATHS.services.daemons.fillShare,
      condition: (ns) => {
        const state = loadState(ns);
        return !isModuleDisabled(state, ["share", "filler"]);
      },
    },
  ];

  while (true) {
    const orderedDaemons = [...daemons].sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
    );

    for (const daemon of orderedDaemons) {
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
        if (daemon.name === "Stanek Manager") {
          stopNetworkPayload(ns, PATHS.services.payloads.stanekCharge);
        } else if (daemon.name === "Share Filler") {
          stopNetworkPayload(ns, PATHS.services.payloads.share);
        }
        continue;
      }

      if (isRunning) continue;

      const reqRam = ns.getScriptRam(execPath, "home");
      if (!Number.isFinite(reqRam) || reqRam <= 0) {
        logger.warn(
          `Überspringe ${daemon.name}: ungültiger Skript-RAM (${reqRam}).`,
        );
        continue;
      }

      const freeRam =
        ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
      if (freeRam >= reqRam) {
        const pid = ns.run(execPath, 1, ...args);
        if (pid > 0) {
          logger.success(
            `🚀 Daemon gestartet: ${daemon.name} [PID ${pid} | ${ns.format.ram(reqRam)}]`,
          );
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

function stopNetworkPayload(ns: NS, scriptPath: string): void {
  const scriptName = scriptPath
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/\.ts$/, ".js");
  for (const host of getAllRootedServersIncludingPurchased(ns)) {
    for (const process of ns.ps(host)) {
      if (process.filename.endsWith(scriptName)) ns.kill(process.pid);
    }
  }
}
