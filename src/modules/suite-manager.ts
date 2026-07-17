// src/modules/suite-manager.ts

import { NS } from "@ns";
import { BotState } from "/core/state-manager.js"; 

export function manageSuites(
  ns: NS,
  scripts: { backdoor: string; trade: string; sleeve: string }, 
  state: BotState,
  bnMults: any,
  logger: any
): void {
  const homeMaxRam = ns.getServerMaxRam("home");
  const homeUsedRam = ns.getServerUsedRam("home");
  
  let dynamicFreeRam = homeMaxRam - homeUsedRam;
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  const tryLaunch = (scriptPath: string, args: (string | number)[] = [], launchLog?: () => void): boolean => {
    if (!ns.fileExists(scriptPath, "home") || ns.isRunning(scriptPath, "home")) return false;
    
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

  // --- ⚡ Hacknet Logik ---
  const targetHacknetScript = hasFormulas ? "systems/hacknet.js" : "systems/hacknet-early.js";
  const obsoleteHacknetScript = hasFormulas ? "systems/hacknet-early.js" : "systems/hacknet.js";

  if (ns.isRunning(obsoleteHacknetScript, "home")) {
    logger.info(`Beende veraltetes Hacknet-Skript (${obsoleteHacknetScript}).`);
    ns.scriptKill(obsoleteHacknetScript, "home");
  }

  const hasBrute = ns.fileExists("BruteSSH.exe", "home");
  if (homeMaxRam < 128 || !hasBrute) {
    if (ns.isRunning(targetHacknetScript, "home")) {
      logger.warn("Ressourcen unzureichend. Deaktiviere Hacknet.");
      ns.scriptKill(targetHacknetScript, "home");
    }
  } else {
    if (bnMults.HacknetNodeMoney < 0.4) {
      tryLaunch(targetHacknetScript, [4, 100, 8, 4], () => {
        logger.warn("Hacknet-Produktion gedrosselt! Starte im Failsafe-Modus.");
      });
    } else {
      tryLaunch(targetHacknetScript, [], () => {
        logger.success("Starte unlimitiertes Hacknet-Subsystem...");
      });
    }
  }

  // --- 🚪 Intelligente Backdoor Logik (Zustandsbasiert) ---
  let backdoorIsNeeded = false;
  const networkNodes = state.allServers || [];
  const currentHackingLevel = ns.getHackingLevel();

  for (const node of networkNodes) {
    if (node === "home" || node === "darkweb" || node.startsWith("hacknet-node")) continue;
    if (node === "w0r1d_d43m0n") continue; 

    if (ns.serverExists(node)) {
      const srv = ns.getServer(node);
      if (srv.hasAdminRights && !srv.backdoorInstalled && !srv.purchasedByPlayer) {
        if (currentHackingLevel >= (srv.requiredHackingSkill ?? 0)) {
          backdoorIsNeeded = true;
          break; 
        }
      }
    }
  }

  if (backdoorIsNeeded) {
    tryLaunch(scripts.backdoor, [], () => {
      logger.info("Verifizierte Backdoor-Lücke im Netzwerk entdeckt. Starte Infiltration...");
    });
  }

  // --- 📈 Finance Logik (Sperre unter 512GB RAM) ---
  if (homeMaxRam >= 512) {
    tryLaunch(scripts.trade, [], () => {
      logger.success("Initialisiere Finanz-Subsystem...");
    });
  } else if (ns.isRunning(scripts.trade, "home")) {
    // 🛑 DEFENSIVER GEGEN-KILLSWITCH: Schützt den RAM, falls manuell gestartet
    logger.warn(`Erzwinge Stopp von finance.js. Home-RAM (${ns.format.ram(homeMaxRam)}) unter 512GB.`);
    ns.scriptKill(scripts.trade, "home");
  }

  // --- 👥 Sleeve Logik ---
  if (ns.sleeve !== undefined) {
    tryLaunch(scripts.sleeve, [], () => {
      logger.info("Sleeve-API detektiert. Initialisiere Klon-Automatisierung...");
    });
  }
}