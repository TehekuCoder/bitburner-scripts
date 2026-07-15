// modules/suite-manager.ts

import { NS } from "@ns";
import { BotState } from "/core/state-manager.js"; 

export function manageSuites(
  ns: NS,
  scripts: { backdoor: string; trade: string; sleeve: string }, // 🟢 Explizit typisiert für maximale Sicherheit
  state: BotState,
  triggerBackdoor: boolean,
  bnMults: any,
  logger: any
): void {
  const homeMaxRam = ns.getServerMaxRam("home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

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
  } else if (ns.fileExists(targetHacknetScript, "home") && !ns.isRunning(targetHacknetScript, "home")) {
    if (bnMults.HacknetNodeMoney < 0.4) {
      logger.warn("Hacknet-Produktion gedrosselt! Starte im Failsafe-Modus.");
      ns.exec(targetHacknetScript, "home", 1, 4, 100, 8, 4);
    } else {
      logger.success("Starte unlimitiertes Hacknet-Subsystem...");
      ns.exec(targetHacknetScript, "home", 1);
    }
  }

  // --- 🚪 Backdoor Logik ---
  if (triggerBackdoor && ns.fileExists(scripts.backdoor, "home") && !ns.isRunning(scripts.backdoor, "home")) {
    logger.info("Neuer anfälliger Server gefunden. Starte Backdoor-Prozess...");
    ns.exec(scripts.backdoor, "home", 1);
  }

  // --- 📈 Finance Logik ---
  if (ns.fileExists(scripts.trade, "home") && !ns.isRunning(scripts.trade, "home") && homeMaxRam >= 64) {
    logger.success("Initialisiere Finanz-Subsystem...");
    ns.exec(scripts.trade, "home", 1);
  }

  // --- 👥 Sleeve Logik ---
  if (ns.sleeve !== undefined && ns.fileExists(scripts.sleeve, "home") && !ns.isRunning(scripts.sleeve, "home")) {
    logger.info("Sleeve-API detektiert. Initialisiere Klon-Automatisierung...");
    ns.exec(scripts.sleeve, "home", 1);
  }
}