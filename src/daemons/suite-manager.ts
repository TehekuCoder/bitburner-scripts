import { NS } from "@ns";
import { PATHS } from "/lib/paths";
import { BotStateNetwork, ScriptList } from "/lib/types.js";

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

  const hasFormulas = ns.fileExists("Formulas.exe", "home");
  const hasNavigator = ns.fileExists("DarkscapeNavigator.exe", "home");

  /**
   * Hilfsfunktion zum Prüfen & Starten von Daemons inkl. RAM-Abzug in Echtzeit.
   */
  const tryLaunch = (
    scriptPath: string | undefined,
    args: (string | number)[] = [],
    launchLog?: () => void,
  ): boolean => {
    if (
      !scriptPath ||
      !ns.fileExists(scriptPath, "home") ||
      ns.isRunning(scriptPath, "home")
    ) {
      return false;
    }

    const requiredRam = ns.getScriptRam(scriptPath, "home");
    if (dynamicFreeRam < requiredRam) return false;

    if (launchLog) launchLog();

    const pid = ns.exec(scriptPath, "home", 1, ...args);
    if (pid > 0) {
      dynamicFreeRam -= requiredRam;
      return true;
    }
    return false;
  };

  // ====================================================================
  // 1. 🚪 INTELLIGENTE BACKDOOR LOGIK
  // ====================================================================
  let backdoorIsNeeded = false;
  const networkNodes = state?.allServers || [];
  const currentHackingLevel = ns.getHackingLevel();

  for (const node of networkNodes) {
    if (
      node === "home" ||
      node === "darkweb" ||
      node.startsWith("hacknet-node")
    )
      continue;
    if (node === "w0r1d_d43m0n") continue;

    if (ns.serverExists(node)) {
      const srv = ns.getServer(node);
      if (
        srv.hasAdminRights &&
        !srv.backdoorInstalled &&
        !srv.purchasedByPlayer
      ) {
        if (currentHackingLevel >= (srv.requiredHackingSkill ?? 0)) {
          backdoorIsNeeded = true;
          break;
        }
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

  // ====================================================================
  // 2. 🚀 HACKING ORCHESTRATOR (Haupt-Pipeline)
  // ====================================================================
  tryLaunch(scripts.orchestrator, [], () => {
    logger.success("Starte Hacking-Orchestrator...");
  });

  // ====================================================================
  // 3. 🏗️ INFRASTRUKTUR MANAGER (Ab 64GB RAM)
  // ====================================================================
  if (homeMaxRam >= 64) {
    tryLaunch(scripts.infra, [], () => {
      logger.info("Initialisiere Infrastruktur-Manager...");
    });
  }

  // ====================================================================
  // 4. ⚡ HACKNET LOGIK (Erst ab 256GB RAM + BruteSSH.exe)
  // ====================================================================
  const targetHacknetScript = hasFormulas
    ? PATHS.daemons.hacknet
    : PATHS.daemons.hacknetEarly;
  const obsoleteHacknetScript = hasFormulas
    ? PATHS.daemons.hacknetEarly
    : PATHS.daemons.hacknet;

  if (ns.isRunning(obsoleteHacknetScript, "home")) {
    logger.info(`Beende veraltetes Hacknet-Skript (${obsoleteHacknetScript}).`);
    ns.scriptKill(obsoleteHacknetScript, "home");
  }

  const hasBrute = ns.fileExists("BruteSSH.exe", "home");
  if (homeMaxRam < 256 || !hasBrute) {
    if (ns.isRunning(targetHacknetScript, "home")) {
      logger.warn(
        "Hacknet deaktiviert (benötigt mindestens 256GB RAM & BruteSSH.exe).",
      );
      ns.scriptKill(targetHacknetScript, "home");
    }
  } else {
    const hacknetMoneyMult = bnMults?.HacknetNodeMoney ?? 1.0;
    if (hacknetMoneyMult < 0.4) {
      tryLaunch(targetHacknetScript, [4, 100, 8, 4], () => {
        logger.warn("Hacknet-Produktion gedrosselt! Starte im Failsafe-Modus.");
      });
    } else {
      tryLaunch(targetHacknetScript, [], () => {
        logger.success("Starte unlimitiertes Hacknet-Subsystem...");
      });
    }
  }

  // ====================================================================
  // 5. 🌐 NETWORK EXPANSION (Darknet & Crawler ab 256GB + Navigator)
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
  // 6. ⚡ SINGULARITY DISPATCHER (SF4 Automatisierung ab 256GB RAM)
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
  // 8. 📈 FINANCE LOGIK (Börsen-Trade ab 512GB RAM)
  // ====================================================================
  if (homeMaxRam >= 512) {
    tryLaunch(scripts.trade, [], () => {
      logger.success("Initialisiere Finanz-Subsystem...");
    });
  } else if (ns.isRunning(scripts.trade, "home")) {
    logger.warn(
      `Erzwinge Stopp von finance.js. Home-RAM (${ns.format.ram(homeMaxRam)}) unter 512GB.`,
    );
    ns.scriptKill(scripts.trade, "home");
  }

  // ====================================================================
  // 9. 🧬 SLEEVE LOGIK
  // ====================================================================
  if (ns.sleeve !== undefined) {
    if (homeMaxRam >= 512) {
      tryLaunch(scripts.sleeve, [], () => {
        logger.info(
          "Sleeve-API detektiert. Initialisiere Klon-Automatisierung...",
        );
      });
    }
  }

  // ====================================================================
  // 10. 🔄 SHARE-FILLER LOGIK (Ab 32GB RAM)
  // ====================================================================
  if (homeMaxRam >= 32) {
    tryLaunch(scripts.fillShare, [], () => {
      logger.info("Initialisiere Hintergrund-Share-Filler auf home...");
    });
  }
}
