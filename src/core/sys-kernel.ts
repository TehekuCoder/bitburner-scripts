import { NS, Player } from "@ns";
import { loadState, patchState, BotState } from "./state-manager.js";
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { provisionServer } from "../utils/provision.js";
import { Logger } from "./logger.js";

interface ScriptList {
  worker: string;
  dispatcher: string;
  infra: string;
  backdoor: string;
  xpfarm: string;
  trade: string;
  hacknet: string;
  replicator: string;
  crawler: string;
  hack: string;
  grow: string;
  weaken: string;
  sleeve: string;
  dashboard: string; // 🆕 Dashboard im Interface
}

export async function main(ns: NS): Promise<void> {
  const logger = new Logger(ns, "Kernel", "INFO");

  const scripts: ScriptList = {
    worker: "tasks/work.js",
    dispatcher: "core/sys-dispatcher.js",
    infra: "core/sys-infra.js",
    backdoor: "tasks/backdoor.js",
    xpfarm: "tasks/xp-grind.js",
    trade: "systems/finance.js",
    hacknet: "systems/hacknet-early.js",
    replicator: "core/dnet-master.js",
    crawler: "tasks/dnet/dnet-crawler.js",
    hack: "tasks/hack.js",
    grow: "tasks/grow.js",
    weaken: "tasks/weaken.js",
    sleeve: "core/sys-sleeve.js",
    dashboard: "core/sys-dashboard.js" // 🆕 Pfad anpassen falls nötig
  };

  ns.disableLog("ALL");

  // --- 🔄 BOOT-SEQUENCE: ENVIRONMENT ANALYSIS ---
  try {
    logger.info("Analysiere BitNode-Umgebung via Source-File 5...");
    const realMults = ns.getBitNodeMultipliers();
    ns.write("bn-multipliers.txt", JSON.stringify(realMults, null, 2), "w");
    logger.success("bn-multipliers.txt erfolgreich generiert.");
  } catch {
    logger.warn("Source-File 5 nicht aktiv. Nutze Failsafe-Matrix.");
    ns.write("bn-multipliers.txt", JSON.stringify(DEFAULT_MULTIPLIERS, null, 2), "w");
  }

  const bnMults = loadBnMults(ns);
  logger.info("Subsysteme werden initialisiert...");

  if (!ns.scriptRunning("sys-hud.js", "home")) {
    ns.exec("sys-hud.js", "home", 1);
  }

  // 🆕 Start des neuen UI-Dashboards falls nicht aktiv
  if (!ns.scriptRunning(scripts.dashboard, "home")) {
    logger.info("Starte zentrales System-Dashboard...");
    ns.exec(scripts.dashboard, "home", 1);
  }

  // Caching-Variablen für Performance-Optimierung
  let lastRootCount = -1;
  let lastStrategy = "";
  let lastProgressBar = "";
  let lastDeployedTarget = "";
  let lastDeployedStrategy = "";

  while (true) {
    // 1. Netzwerk infizieren & scannen
    breakAndInfectNetwork(ns);
    const allNodes: string[] = getAllServers(ns);

    const currentRootCount = allNodes.filter((n) => ns.hasRootAccess(n)).length;
    const triggerBackdoor = currentRootCount > lastRootCount;
    const networkChanged = currentRootCount !== lastRootCount;
    lastRootCount = currentRootCount;

    const homeMax = ns.getServerMaxRam("home");
    const player = ns.getPlayer();
    const currentState = loadState(ns);

    let activeStrategy = currentState?.strategy || "MONEY";
    let activeProgressBar = currentState?.progressBar || "";

    // --- 🧠 DYNAMISCHE EFFIZIENZ-MATRIX (GEWALTENTEILUNG) ---
    const isDispatcherReady = homeMax >= 256 && ns.fileExists(scripts.dispatcher, "home");

    if (!isDispatcherReady) {
      // 🛡️ FALLBACK-LOGIK: Nur aktiv im Early-Game (wenn kein Dispatcher läuft)
      const hackingEfficiency = bnMults.ServerMaxMoney * bnMults.ScriptHackMoneyGain;
      const hackingExpMult = bnMults.HackingLevelMultiplier ?? 1.0;

      if (hackingEfficiency === 0) {
        activeStrategy = "XP_SPRINT";
        activeProgressBar = "📉 BN-Sonderregel: Hacking wirft kein Geld ab! Fokus auf XP-Sprint.";
      } else if (hackingEfficiency < 0.2 && player.money < 50_000_000 && bnMults.CrimeMoney > 0.5) {
        activeStrategy = "CRIME";
        activeProgressBar = `🥷 Hacking ineffizient (${(hackingEfficiency * 100).toFixed(0)}%). Starte Verbrechen-Grind.`;
      } else {
        const combatAvg = (player.skills.strength + player.skills.defense + player.skills.dexterity + player.skills.agility) / 4;

        if (bnMults.CompanyWorkMoney > 1.2 && combatAvg >= 30) {
          activeStrategy = "CORP";
          activeProgressBar = `🏢 BN-Spezial: Firmen-Arbeit stark skaliert (${(bnMults.CompanyWorkMoney * 100).toFixed(0)}%).`;
        } else {
          activeStrategy = "MONEY";
          activeProgressBar = `💻 Hacking-Fleet aktiv (Netzwerk-Ressourcen optimal genutzt)`;
        }
      }

      if (activeStrategy === "XP_SPRINT" && hackingExpMult < 0.2) {
        activeProgressBar = `⚠️ XP-Sprint aktiv, aber BN-Hacking-XP ist stark gedrosselt (${(hackingExpMult * 100).toFixed(0)}%)!`;
      }

      // PERFORMANCE-FIX: Nur patchen, wenn sich Werte real verändert haben!
      if (activeStrategy !== lastStrategy || activeProgressBar !== lastProgressBar) {
        patchState(ns, {
          strategy: activeStrategy,
          progressBar: activeProgressBar,
        });
        lastStrategy = activeStrategy;
        lastProgressBar = activeProgressBar;
      }
    } else {
      activeStrategy = currentState?.strategy || "MONEY";
      activeProgressBar = currentState?.progressBar || "";
    }

    const bestTarget: string = findBestTarget(ns, allNodes, player, bnMults);

    const localStateSnapshot: BotState = {
      strategy: activeStrategy,
      targetFaction: currentState?.targetFaction,
      targetCompany: currentState?.targetCompany,
      targetStat: currentState?.targetStat,
      batcherTarget: currentState?.batcherTarget,
      progressBar: activeProgressBar,
      lastUpdate: Date.now(),
      playerHacking: ns.getHackingLevel(),
    };

    // Subsysteme verwalten
    manageSuites(ns, scripts, localStateSnapshot, triggerBackdoor, bnMults, logger);

    // --- 🚀 ORCHESTRIERUNG DER SUB-MANAGER ---
    let isDispatcherRunning = ns.isRunning(scripts.dispatcher, "home");

    if (isDispatcherReady && !isDispatcherRunning) {
      logger.info("Starte zentralen System-Dispatcher (Dispatcher-Modus aktiv)...");
      ns.exec(scripts.dispatcher, "home", 1);
      isDispatcherRunning = true;
    }

    if (ns.fileExists(scripts.infra, "home") && !ns.isRunning(scripts.infra, "home")) {
      logger.info("Starte Infrastruktur-Manager...");
      ns.exec(scripts.infra, "home", 1);
    }

    // --- 🧹 CLEANUP & 📡 WORKER DEPLOYMENT ---
    if (!isDispatcherRunning) {
      const targetChanged = bestTarget !== lastDeployedTarget;
      const strategyChanged = activeStrategy !== lastDeployedStrategy;

      if (targetChanged || strategyChanged || networkChanged) {
        let activeScript = activeStrategy === "XP_SPRINT" ? scripts.xpfarm : scripts.worker;

        for (const node of allNodes) {
          if (!ns.hasRootAccess(node)) continue;
          if (node === "home" && ["REP", "TRAIN", "CORP", "CRIME"].includes(activeStrategy)) continue;

          let ramBuffer = 0;
          if (node === "home") {
            const weakenModifier = bnMults.ServerWeakenRate < 1.0 ? Math.ceil(16 / bnMults.ServerWeakenRate) : 0;
            const baseBuffer = ["CRIME", "REP", "TRAIN", "CORP", "XP_SPRINT"].includes(activeStrategy) ? 24 : 8;
            ramBuffer = Math.min(baseBuffer + weakenModifier, homeMax * 0.4);
          }

          await deployWorker(ns, node, activeScript, bestTarget, ramBuffer, scripts);
        }
        
        lastDeployedTarget = bestTarget;
        lastDeployedStrategy = activeStrategy;
      }
    }

    // --- 📡 EXPORTIEREN DER KERNEL-DATEN AN DAS PORT-SYSTEM ---
    const pServers = ns.cloud.getServerNames();
    const isFleetMode = homeMax >= 256 && pServers.some((s) => ns.getServerMaxRam(s) >= 64);

    // Der Kernel schickt seine Daten atomar an den State. Das Dashboard liest sie dort aus.
    patchState(ns, {
      kernelTarget: bestTarget,
      rootCount: currentRootCount,
      totalNodes: allNodes.length,
      isFleetMode: isFleetMode
    });

    await ns.sleep(2000);
  }
}

// ======================================================================
// --- 🛠️ SUBSYSTEM MANAGER ---
// ======================================================================
function manageSuites(
  ns: NS,
  scripts: ScriptList,
  state: BotState,
  triggerBackdoor: boolean,
  bnMults: any,
  logger: Logger,
): void {
  const homeMaxRam = ns.getServerMaxRam("home");
  const playerMoney = ns.getPlayer().money;
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  const targetHacknetScript = hasFormulas ? "systems/hacknet.js" : "systems/hacknet-early.js";
  const obsoleteHacknetScript = hasFormulas ? "systems/hacknet-early.js" : "systems/hacknet.js";

  if (ns.isRunning(obsoleteHacknetScript, "home")) {
    logger.info(`Beende veraltetes Hacknet-Skript (${obsoleteHacknetScript}).`);
    ns.scriptKill(obsoleteHacknetScript, "home");
  }

  const hasBrute = ns.fileExists("BruteSSH.exe", "home");

  if (homeMaxRam < 128 || !hasBrute) {
    if (ns.isRunning(targetHacknetScript, "home")) {
      logger.warn("Ressourcen oder Port-Tools unzureichend. Deaktiviere Hacknet-Subsystem.");
      ns.scriptKill(targetHacknetScript, "home");
    }
  } else {
    if (ns.fileExists(targetHacknetScript, "home") && !ns.isRunning(targetHacknetScript, "home")) {
      if (bnMults.HacknetNodeMoney < 0.4) {
        logger.warn("Hacknet-Produktion durch BitNode gedrosselt! Starte im Failsafe-Modus.");
        ns.exec(targetHacknetScript, "home", 1, 4, 100, 8, 4);
      } else {
        logger.success("Starte unlimitiertes Hacknet-Subsystem...");
        ns.exec(targetHacknetScript, "home", 1);
      }
    }
  }

  if (triggerBackdoor && ns.fileExists(scripts.backdoor, "home") && !ns.isRunning(scripts.backdoor, "home")) {
    logger.info("Neuer anfälliger Server gefunden. Starte Backdoor-Prozess...");
    ns.exec(scripts.backdoor, "home", 1);
  }

  if (ns.fileExists(scripts.trade, "home") && !ns.isRunning(scripts.trade, "home")) {
    try {
      const hasTix = ns.stock.hasTixApiAccess();
      const baseEntryCapital = 25_000_000_000 * (bnMults.FourSigmaMarketDataCost ?? 1.0);
      const tixApiThreshold = 100_000_000 * (bnMults.FourSigmaMarketDataApiCost ?? 1.0);

      if ((homeMaxRam >= 128 && playerMoney >= baseEntryCapital) || 
          (hasTix && ns.stock.purchase4SMarketDataTixApi() && playerMoney >= tixApiThreshold)) {
        logger.success("Finanzielle Voraussetzungen erfüllt. Starte TIX-Trading-Bot...");
        ns.exec(scripts.trade, "home", 1);
      }
    } catch {
      // Stilles Abfangen
    }
  }

  if (ns.fileExists("DarkscapeNavigator.exe", "home") && homeMaxRam >= 256) {
    if (!ns.isRunning(scripts.replicator, "home")) {
      logger.info("Darkscape-Netzwerk bereit. Starte DNet-Master Replicator...");
      ns.exec(scripts.replicator, "home", 1);
    }
    if (ns.fileExists(scripts.crawler, "home") && !ns.isRunning(scripts.crawler, "home")) {
      logger.info("Starte DNet-Crawler...");
      ns.exec(scripts.crawler, "home", 1);
    }
  }

  if (ns.sleeve !== undefined && ns.fileExists(scripts.sleeve, "home")) {
    if (!ns.isRunning(scripts.sleeve, "home")) {
      logger.info("Sleeve-API detektiert. Initialisiere Klon-Automatisierung...");
      ns.exec(scripts.sleeve, "home", 1);
    }
  }
}

function findBestTarget(ns: NS, nodes: string[], player: Player, bnMults: any): string {
  let best = "n00dles";
  let maxWeight = 0;

  const serverMaxMoneyMult = bnMults.ServerMaxMoney ?? 1.0;
  const growthMult = bnMults.ServerGrowthRate ?? 1.0;
  const isNoMoneyNode = serverMaxMoneyMult === 0;

  for (const node of nodes) {
    if (node === "home" || node === "darkweb" || node.startsWith("hacknet-node")) continue;
    if (!ns.hasRootAccess(node)) continue;

    const srv = ns.getServer(node);
    const maxMoney = srv.moneyMax ?? 0;

    if (!isNoMoneyNode && maxMoney <= 0) continue;

    const reqSkill = srv.requiredHackingSkill || 0;
    if (reqSkill > player.skills.hacking) continue;

    const cycleTime = ns.getWeakenTime(node);

    if (isNoMoneyNode) {
      const weight = reqSkill / (Math.max(1, cycleTime) / 1000);
      if (weight > maxWeight) {
        maxWeight = weight;
        best = node;
      }
      continue;
    }

    if (cycleTime > 5 * 60 * 1000) continue;

    const weight = (maxMoney / (cycleTime / 1000)) * (reqSkill / 100) * growthMult;

    if (weight > maxWeight) {
      maxWeight = weight;
      best = node;
    }
  }
  return best;
}

async function deployWorker(
  ns: NS,
  targetNode: string,
  scriptFilename: string,
  hackTarget: string,
  ramBuffer: number,
  scripts: ScriptList,
): Promise<void> {
  if (targetNode !== "home") {
    await provisionServer(ns, targetNode);
  }

  if (!ns.fileExists(scriptFilename, "home")) return;

  const scriptCost = ns.getScriptRam(scriptFilename);
  const maxRam = ns.getServerMaxRam(targetNode);
  const usedRam = ns.getServerUsedRam(targetNode);
  let freedRam = 0;
  
  const procs = ns.ps(targetNode);
  const allWorkerScripts = [scripts.worker, scripts.xpfarm, scripts.hack, scripts.grow, scripts.weaken];

  for (const p of procs) {
    if (allWorkerScripts.includes(p.filename) && (p.filename !== scriptFilename || p.args[0] !== hackTarget)) {
      ns.kill(p.pid);
      freedRam += ns.getScriptRam(p.filename) * p.threads;
    }
  }

  const actualFreeRam = maxRam - usedRam + freedRam - ramBuffer;
  const threads = Math.floor(actualFreeRam / scriptCost);

  if (threads > 0) {
    ns.exec(scriptFilename, targetNode, threads, hackTarget);
  }
}