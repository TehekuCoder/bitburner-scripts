// daemons/suite-manager.ts

import { NS } from "@ns";
import { PATHS } from "/lib/paths";
import { ScriptList } from "/lib/types/common";
import { BotStateNetwork } from "/lib/types/strategy";
import { getAllServers } from "/lib/network.js";

export function manageSuites(
  ns: NS,
  scripts: ScriptList,
  state: BotStateNetwork,
  bnMults: any,
  logger: any,
): void {
  const homeMaxRam = ns.getServerMaxRam("home");
  const homeUsedRam = ns.getServerUsedRam("home");

  // Dynamisches Tracking des freien Speichers innerhalb eines Ausführungs-Ticks
  let dynamicFreeRam = homeMaxRam - homeUsedRam;

  const hasNavigator = ns.fileExists("DarkscapeNavigator.exe", "home");

  /**
   * Hilfsfunktion zum Prüfen & Starten von Daemons inkl. RAM-Abzug in Echtzeit.
   */
  const tryLaunch = (
    scriptPath: string | undefined,
    args: (string | number)[] = [],
    launchLog?: () => void,
  ): boolean => {
    if (!scriptPath) return false;

    // Normalisiere .ts Pfade auf .js für die Bitburner-Runtime
    const execPath = scriptPath.endsWith(".ts")
      ? scriptPath.replace(/\.ts$/, ".js")
      : scriptPath;

    if (!ns.fileExists(execPath, "home") || ns.isRunning(execPath, "home")) {
      return false;
    }

    const requiredRam = ns.getScriptRam(execPath, "home");
    if (dynamicFreeRam < requiredRam) {
      logger.warn(
        `Zu wenig RAM für ${execPath} (Benötigt: ${ns.format.ram(requiredRam)}, Frei: ${ns.format.ram(dynamicFreeRam)})`,
      );
      return false;
    }

    if (launchLog) launchLog();

    const pid = ns.exec(execPath, "home", 1, ...args);
    if (pid > 0) {
      dynamicFreeRam -= requiredRam;
      return true;
    }
    return false;
  };

  // ====================================================================
  // 1. 🚪 INTELLIGENTE BACKDOOR LOGIK
  // ====================================================================
  if (ns.singularity !== undefined) {
    let backdoorIsNeeded = false;

    const networkNodes =
      state?.allServers && state.allServers.length > 0
        ? state.allServers
        : getAllServers(ns);

    const currentHackingLevel = ns.getHackingLevel();

    for (const node of networkNodes) {
      if (
        node === "home" ||
        node === "darkweb" ||
        node === "Darknet" ||
        node.startsWith("hacknet-node") ||
        node === "w0r1d_d43m0n"
      ) {
        continue;
      }

      if (ns.serverExists(node)) {
        const srv = ns.getServer(node);
        if (
          srv.hasAdminRights &&
          !srv.backdoorInstalled &&
          !srv.purchasedByPlayer &&
          currentHackingLevel >= (srv.requiredHackingSkill ?? 0)
        ) {
          backdoorIsNeeded = true;
          break;
        }
      }
    }

    if (backdoorIsNeeded) {
      tryLaunch(scripts.backdoor, [], () => {
        logger.info(
          "Verifizierte Backdoor-Lücke im Netzwerk entdeckt. Starte Infiltration...",
        );
      });
    }
  }

  // ====================================================================
  // 2. 🚀 HACKING ORCHESTRATOR (Haupt-Pipeline)
  // ====================================================================
  if (homeMaxRam >= 64) {
    tryLaunch(scripts.orchestrator, [], () => {
      logger.success("Starte Hacking-Orchestrator...");
    });
  }

  // ====================================================================
  // 3. 🏗️ FINANCE MANAGER (Ab 128GB RAM)
  // ====================================================================
  if (homeMaxRam >= 128) {
    tryLaunch(scripts.financeManager, [], () => {
      logger.info("Initialisiere Finanz-Manager...");
    });
  }

  // ====================================================================
  // 4. 🎰 HASH MANAGER (Hacknet Servers / BN9 Automatisierung ab 32GB RAM)
  // ====================================================================
  try {
    if (homeMaxRam >= 32 && ns.hacknet.hashCapacity() > 0) {
      tryLaunch(scripts.hashManager, [], () => {
        logger.info("Hacknet-Hash-Kapazität erkannt. Starte Hash-Manager...");
      });
    }
  } catch (_) {
    /* Fallback für Umgebungen ohne Hacknet API */
  }

  // ====================================================================
  // 5. 🌐 NETWORK EXPANSION (Darknet & Crawler ab 512GB + Navigator)
  // ====================================================================
  if (homeMaxRam >= 512 && hasNavigator) {
    tryLaunch(scripts.dnet, [], () => {
      logger.info("Starte Darknet-Subsystem...");
    });
    tryLaunch(scripts.crawler, [], () => {
      logger.info("Starte Netzwerk-Crawler...");
    });
  }

  // ====================================================================
  // 6. ⚡ SINGULARITY DISPATCHER (SF4 Automatisierung ab 512GB RAM)
  // ====================================================================
  if (homeMaxRam >= 512 && ns.singularity !== undefined) {
    tryLaunch(scripts.dispatcher, [], () => {
      logger.success("Starte zentralen Singularity-Dispatcher (SF4)...");
    });
  }

  // ====================================================================
  // 7. 👥 GANG MANAGER
  // ====================================================================
  let isInGang = false;
  try {
    isInGang = ns.gang.inGang();
  } catch (_) {}

  if (isInGang && homeMaxRam >= 256) {
    tryLaunch(scripts.gang, [], () => {
      logger.info("Gang-Zugehörigkeit bestätigt. Starte Gang-Manager...");
    });
  }

  // ====================================================================
  // 8. 🧬 SLEEVE LOGIK
  // ====================================================================
  if (ns.sleeve !== undefined && homeMaxRam >= 512) {
    tryLaunch(scripts.sleeve, [], () => {
      logger.info(
        "Sleeve-API detektiert. Initialisiere Klon-Automatisierung...",
      );
    });
  }

  // ====================================================================
  // 10. 🔄 SHARE-FILLER LOGIK (Ab 128GB RAM)
  // ====================================================================
  if (homeMaxRam >= 128) {
    tryLaunch(scripts.fillShare, [], () => {
      logger.info("Initialisiere Hintergrund-Share-Filler auf home...");
    });
  }
}