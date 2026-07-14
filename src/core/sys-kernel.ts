import { NS, Player } from "@ns";
import {
  loadState,
  patchState,
  BotState,
  clearState,
  saveState,
} from "./state-manager.js";
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
  dashboard: string;
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
    dashboard: "core/sys-dashboard.js",
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
    ns.write(
      "bn-multipliers.txt",
      JSON.stringify(DEFAULT_MULTIPLIERS, null, 2),
      "w",
    );
  }

  const bnMults = loadBnMults(ns);
  logger.info("Subsysteme werden initialisiert...");

  // --- 🎖️ PROGRESSION DETECTION (0 GB RAM ANALYSE) ---
  logger.info("Scanne Account-Progression und Unlocks...");
  
  let ownedSourceFiles: Record<number, number> = {};
  let currentBN = 10;
  let currentBNLvl = 2; // Du bist aktuell bei BN 10.2!

  try {
    // Falls SF4 (Singularity) aktiv ist, lesen wir die echten Daten live aus
    const sfData = ns.singularity.getOwnedSourceFiles();
    for (const sf of sfData) {
      ownedSourceFiles[sf.n] = sf.lvl;
    }
    currentBN = ns.getResetInfo().currentNode;
    // Das Level lässt sich leider nicht direkt per API auslesen, 
    // daher nutzen wir deinen realen Stand als exzellenten Standardwert:
    if (currentBN === 10) currentBNLvl = 2;
  } catch {
    // Failsafe-Fallback: Deine exakte historische Unlock-Reihenfolge!
    // Unlocked: 1.1, 1.2, 4.1, 4.2, 4.3, 1.3, 5.1, 5.2, 5.3, 10.1.
    ownedSourceFiles = {
      1: 3,  // SF1 Maxed (1.1, 1.2, 1.3)
      4: 3,  // SF4 Maxed (4.1, 4.2, 4.3)
      5: 3,  // SF5 Maxed (5.1, 5.2, 5.3)
      10: 1  // SF10 Level 1 (10.1 geschafft)
    };
  }

  // DarkScapeNavigator Erkennung (Bitburner v3.0 / Custom)
  const hasDarkScapeNavigator = 
    ns.fileExists("DarkScapeNavigator.exe", "home") || 
    ns.fileExists("DarkScapeNavigator.js", "home");

  // TOR-Router Erkennung via simpler Netzwerkumgebung (0 GB RAM)
  const hasTor = ns.scan("home").includes("darkweb");

  // Einmalige Abfrage aktiver Firmen/Gangs beim Booten
  let hasGang = false;
  try { hasGang = ns.gang.inGang(); } catch {}

  let hasCorp = false;
  try { hasCorp = ns.corporation.hasCorporation(); } catch {}

  let hasBladeburner = false;
  try { hasBladeburner = ns.bladeburner.inBladeburner(); } catch {}

  // 🆕 BOOT-RESET MIT INITIALISIERUNG ALLER SPUREN (Inklusive Progression)
  logger.info("Initialisiere globalen State-Port...");
  clearState(ns);
  saveState(ns, {
    strategy: "MONEY",
    progressBar: "Kernel erfolgreich gestartet.",
    batcherProgress: "Inaktiv",
    financeProgress: "Berechne Budget...",
    traderProgress: "Kein Depot",
    hacknetProgress: "Inaktiv",
    
    // Progressions-Spur befüllen
    currentBitNode: currentBN,
    currentBitNodeLevel: currentBNLvl,
    sourceFiles: ownedSourceFiles,
    hasDarkScapeNavigator: hasDarkScapeNavigator,
    hasTorRouter: hasTor,
    hasGang: hasGang,
    hasCorporation: hasCorp,
    hasBladeburner: hasBladeburner
  });

  // 🆕 AUTOMATISCHER START DER CORE-VISUALISIERUNG
  if (!ns.scriptRunning("sys-hud.js", "home")) {
    logger.info("Starte HUD-Overlay...");
    ns.exec("sys-hud.js", "home", 1);
  }

  if (ns.fileExists(scripts.dashboard, "home") && !ns.scriptRunning(scripts.dashboard, "home")) {
    logger.success("Starte Consolidated Operational Dashboard...");
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
    const isDispatcherReady =
      homeMax >= 256 && ns.fileExists(scripts.dispatcher, "home");

    if (!isDispatcherReady) {
      // 🛡️ FALLBACK-LOGIK: Nur aktiv im Early-Game (wenn kein Dispatcher läuft)
      const hackingEfficiency =
        bnMults.ServerMaxMoney * bnMults.ScriptHackMoneyGain;
      const hackingExpMult = bnMults.HackingLevelMultiplier ?? 1.0;

      if (hackingEfficiency === 0) {
        activeStrategy = "XP_SPRINT";
        activeProgressBar =
          "📉 BN-Sonderregel: Hacking wirft kein Geld ab! Fokus auf XP-Sprint.";
      } else if (
        hackingEfficiency < 0.2 &&
        player.money < 50_000_000 &&
        bnMults.CrimeMoney > 0.5
      ) {
        activeStrategy = "CRIME";
        activeProgressBar = `🥷 Hacking ineffizient (${(hackingEfficiency * 100).toFixed(0)}%). Starte Verbrechen-Grind.`;
      } else {
        const combatAvg =
          (player.skills.strength +
            player.skills.defense +
            player.skills.dexterity +
            player.skills.agility) /
          4;

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
      if (
        activeStrategy !== lastStrategy ||
        activeProgressBar !== lastProgressBar
      ) {
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

    // --- 📡 REALTIME-PROGRESSION CHECKS ---
    // Wir aktualisieren im Loop günstige States (wie TOR, Gangs, Corps), falls sie im laufenden Run erworben werden
    const currentTor = ns.scan("home").includes("darkweb");
    let currentGang = false;
    try { currentGang = ns.gang.inGang(); } catch {}
    let currentCorp = false;
    try { currentCorp = ns.corporation.hasCorporation(); } catch {}
    let currentBlade = false;
    try { currentBlade = ns.bladeburner.inBladeburner(); } catch {}

    const localStateSnapshot: BotState = {
      ...(currentState || {}),
      strategy: activeStrategy,
      progressBar: activeProgressBar,
      lastUpdate: Date.now(),
      playerHacking: ns.getHackingLevel(),
      hasTorRouter: currentTor,
      hasGang: currentGang,
      hasCorporation: currentCorp,
      hasBladeburner: currentBlade
    } as BotState;

    // Subsysteme verwalten (Nutzt den aktualisierten Snapshot)
    manageSuites(
      ns,
      scripts,
      localStateSnapshot,
      triggerBackdoor,
      bnMults,
      logger,
    );

    // --- 🚀 ORCHESTRIERUNG DER SUB-MANAGER ---
    let isDispatcherRunning = ns.isRunning(scripts.dispatcher, "home");

    if (isDispatcherReady && !isDispatcherRunning) {
      logger.info(
        "Starte zentralen System-Dispatcher (Dispatcher-Modus aktiv)...",
      );
      ns.exec(scripts.dispatcher, "home", 1);
      isDispatcherRunning = true;
    }

    if (
      ns.fileExists(scripts.infra, "home") &&
      !ns.isRunning(scripts.infra, "home")
    ) {
      logger.info("Starte Infrastruktur-Manager...");
      ns.exec(scripts.infra, "home", 1);
    }

    // --- 🧹 CLEANUP & 📡 WORKER DEPLOYMENT ---
    if (!isDispatcherRunning) {
      const targetChanged = bestTarget !== lastDeployedTarget;
      const strategyChanged = activeStrategy !== lastDeployedStrategy;

      if (targetChanged || strategyChanged || networkChanged) {
        let activeScript =
          activeStrategy === "XP_SPRINT" ? scripts.xpfarm : scripts.worker;

        for (const node of allNodes) {
          if (!ns.hasRootAccess(node)) continue;
          if (
            node === "home" &&
            ["REP", "TRAIN", "CORP", "CRIME"].includes(activeStrategy)
          )
            continue;

          let ramBuffer = 0;
          if (node === "home") {
            const weakenModifier =
              bnMults.ServerWeakenRate < 1.0
                ? Math.ceil(16 / bnMults.ServerWeakenRate)
                : 0;
            const baseBuffer = [
              "CRIME",
              "REP",
              "TRAIN",
              "CORP",
              "XP_SPRINT",
            ].includes(activeStrategy)
              ? 24
              : 8;
            ramBuffer = Math.min(baseBuffer + weakenModifier, homeMax * 0.4);
          }

          await deployWorker(
            ns,
            node,
            activeScript,
            bestTarget,
            ramBuffer,
            scripts,
          );
        }

        lastDeployedTarget = bestTarget;
        lastDeployedStrategy = activeStrategy;
      }
    }

    // --- 📡 EXPORTIEREN DER KERNEL-DATEN AN DAS PORT-SYSTEM ---
    const pServers = ns.cloud.getServerNames();
    const isFleetMode =
      homeMax >= 256 && pServers.some((s) => ns.getServerMaxRam(s) >= 64);

    patchState(ns, {
      kernelTarget: bestTarget,
      rootCount: currentRootCount,
      totalNodes: allNodes.length,
      isFleetMode: isFleetMode,
      hasTorRouter: currentTor,
      hasGang: currentGang,
      hasCorporation: currentCorp,
      hasBladeburner: currentBlade
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
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  const targetHacknetScript = hasFormulas
    ? "systems/hacknet.js"
    : "systems/hacknet-early.js";
  const obsoleteHacknetScript = hasFormulas
    ? "systems/hacknet-early.js"
    : "systems/hacknet.js";

  if (ns.isRunning(obsoleteHacknetScript, "home")) {
    logger.info(`Beende veraltetes Hacknet-Skript (${obsoleteHacknetScript}).`);
    ns.scriptKill(obsoleteHacknetScript, "home");
  }

  const hasBrute = ns.fileExists("BruteSSH.exe", "home");

  if (homeMaxRam < 128 || !hasBrute) {
    if (ns.isRunning(targetHacknetScript, "home")) {
      logger.warn(
        "Ressourcen oder Port-Tools unzureichend. Deaktiviere Hacknet-Subsystem.",
      );
      ns.scriptKill(targetHacknetScript, "home");
    }
  } else {
    if (
      ns.fileExists(targetHacknetScript, "home") &&
      !ns.isRunning(targetHacknetScript, "home")
    ) {
      if (bnMults.HacknetNodeMoney < 0.4) {
        logger.warn(
          "Hacknet-Produktion durch BitNode gedrosselt! Starte im Failsafe-Modus.",
        );
        ns.exec(targetHacknetScript, "home", 1, 4, 100, 8, 4);
      } else {
        logger.success("Starte unlimitiertes Hacknet-Subsystem...");
        ns.exec(targetHacknetScript, "home", 1);
      }
    }
  }

  if (
    triggerBackdoor &&
    ns.fileExists(scripts.backdoor, "home") &&
    !ns.isRunning(scripts.backdoor, "home")
  ) {
    logger.info("Neuer anfälliger Server gefunden. Starte Backdoor-Prozess...");
    ns.exec(scripts.backdoor, "home", 1);
  }

  // 🚀 OPTIMIERTE FINANCE START-LOGIK:
  // Wir überlassen finance.ts die vollständige Lizenz- und Budgetkontrolle.
  // Das Skript startet, sobald wir genug RAM haben, und meldet seinen Status ("EARLY") live ans Dashboard.
  if (
    ns.fileExists(scripts.trade, "home") &&
    !ns.isRunning(scripts.trade, "home")
  ) {
    if (homeMaxRam >= 64) {
      logger.success("Initialisiere Finanz-Subsystem [STATE-INTEGRATED]...");
      ns.exec(scripts.trade, "home", 1);
    }
  }

  // Nutzen der gecachten State-Variable statt redundanter File-Checks
  if (state.hasDarkScapeNavigator && homeMaxRam >= 256) {
    if (!ns.isRunning(scripts.replicator, "home")) {
      logger.info(
        "Darkscape-Netzwerk bereit. Starte DNet-Master Replicator...",
      );
      ns.exec(scripts.replicator, "home", 1);
    }
    if (
      ns.fileExists(scripts.crawler, "home") &&
      !ns.isRunning(scripts.crawler, "home")
    ) {
      logger.info("Starte DNet-Crawler...");
      ns.exec(scripts.crawler, "home", 1);
    }
  }

  if (ns.sleeve !== undefined && ns.fileExists(scripts.sleeve, "home")) {
    if (!ns.isRunning(scripts.sleeve, "home")) {
      logger.info(
        "Sleeve-API detektiert. Initialisiere Klon-Automatisierung...",
      );
      ns.exec(scripts.sleeve, "home", 1);
    }
  }
}

function findBestTarget(
  ns: NS,
  nodes: string[],
  player: Player,
  bnMults: any,
): string {
  let best = "n00dles";
  let maxWeight = 0;

  const serverMaxMoneyMult = bnMults.ServerMaxMoney ?? 1.0;
  const growthMult = bnMults.ServerGrowthRate ?? 1.0;
  const isNoMoneyNode = serverMaxMoneyMult === 0;

  for (const node of nodes) {
    if (
      node === "home" ||
      node === "darkweb" ||
      node.startsWith("hacknet-node")
    )
      continue;
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

    const weight =
      (maxMoney / (cycleTime / 1000)) * (reqSkill / 100) * growthMult;

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
  const allWorkerScripts = [
    scripts.worker,
    scripts.xpfarm,
    scripts.hack,
    scripts.grow,
    scripts.weaken,
  ];

  for (const p of procs) {
    if (
      allWorkerScripts.includes(p.filename) &&
      (p.filename !== scriptFilename || p.args[0] !== hackTarget)
    ) {
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