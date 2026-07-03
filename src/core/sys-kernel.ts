import { NS, Player } from "@ns";
import { loadState, patchState, BotState } from "./state-manager.js";
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js"; 

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
  weak: string;
}

export async function main(ns: NS): Promise<void> {
  const scripts: ScriptList = {
    worker: "tasks/work.js",
    dispatcher: "core/sys-dispatcher.js",
    infra: "core/sys-infra.js",
    backdoor: "tasks/backdoor.js",
    xpfarm: "tasks/xp-grind.js",
    trade: "modules/trading-bot.js",
    hacknet: "tasks/hacknet-early.js",
    replicator: "core/dnet-master.js",
    crawler: "tasks/dnet/dnet-crawler.js",
    hack: "tasks/hack.js",
    grow: "tasks/grow.js",
    weak: "tasks/weaken.js",
  };

  ns.disableLog("ALL");
  ns.ui.openTail();

  // ======================================================================
  // --- 🔄 BOOT-SEQUENCE: ENVIRONMENT ANALYSIS ---
  // ======================================================================
  try {
    ns.print("🔄 [BOOT] Analysiere BitNode-Umgebung via Source-File 5...");
    const realMults = ns.getBitNodeMultipliers();
    ns.write("bn-multipliers.txt", JSON.stringify(realMults, null, 2), "w");
    ns.print("✅ [BOOT] bn-multipliers.txt erfolgreich generiert.");
  } catch {
    ns.print("⚠️ [BOOT_WARN] Source-File 5 nicht aktiv. Nutze Failsafe-Matrix.");
    ns.write("bn-multipliers.txt", JSON.stringify(DEFAULT_MULTIPLIERS, null, 2), "w");
  }

  const bnMults = loadBnMults(ns);
  ns.print("🚀 [Kernel] Subsysteme werden initialisiert...");

  if (!ns.scriptRunning("sys-hud.ts", "home")) {
    ns.exec("sys-hud.ts", "home", 1);
  }

  let lastRootCount = -1;

  while (true) {
    breakAndInfectNetwork(ns);
    const allNodes: string[] = getAllServers(ns);

    const currentRootCount = allNodes.filter((n) => ns.hasRootAccess(n)).length;
    const triggerBackdoor = currentRootCount > lastRootCount;
    lastRootCount = currentRootCount;

    const homeMax = ns.getServerMaxRam("home");
    const player = ns.getPlayer();
    const currentState = loadState(ns);
    
    let activeStrategy = currentState?.strategy || "MONEY";
    let activeProgressBar = currentState?.progressBar || "";

    // ======================================================================
    // --- 🧠 DYNAMISCHE EFFIZIENZ-MATRIX (KORREKTUR-LOGIK) ---
    // ======================================================================
    
    // 1. Totale Hacking-Insolvenz (z.B. BitNode 8 oder extreme Strafen)
    const hackingEfficiency = bnMults.ServerMaxMoney * bnMults.ScriptHackMoneyGain;
    
    if (hackingEfficiency === 0) {
      activeStrategy = "XP_SPRINT";
      activeProgressBar = "📉 BN-Sonderregel: Hacking wirft kein Geld ab! Fokus auf XP-Sprint.";
    } 
    // 2. Temporärer Early-Game Crime-Wechsel bei extrem schwachem Hacking-Yield
    else if (activeStrategy === "MONEY" && hackingEfficiency < 0.2 && player.money < 50_000_000) {
      if (bnMults.CrimeMoney > 0.5) {
        activeStrategy = "CRIME";
        activeProgressBar = `🥷 Hacking ineffizient (${(hackingEfficiency * 100).toFixed(0)}%). Generiere Startkapital über Verbrechen.`;
      }
    }
    // 3. Strategischer Wechsel zu hochbezahlter Firmenarbeit (Company Work)
    else if (activeStrategy === "MONEY" || activeStrategy === "CRIME") {
      const combatAvg = (player.skills.strength + player.skills.defense + player.skills.dexterity + player.skills.agility) / 4;
      
      if (bnMults.CompanyWorkMoney > 1.2 && combatAvg >= 30) {
        activeStrategy = "CORP";
        activeProgressBar = `🏢 BN-Spezial: Firmen-Arbeit stark skaliert (${(bnMults.CompanyWorkMoney * 100).toFixed(0)}%).`;
      } else if (!activeProgressBar || activeProgressBar.startsWith("🥷") || activeProgressBar.startsWith("📉")) {
        activeStrategy = "MONEY";
        activeProgressBar = `💻 Hacking-Fleet aktiv (Netzwerk-Ressourcen optimal genutzt)`;
      }
    }

    // Synchronisiere den ermittelten Zustand mit dem globalen State
    patchState(ns, {
      strategy: activeStrategy,
      progressBar: activeProgressBar,
    });

    // Target-Validierung unter Einbeziehung des MaxMoney-Multiplikators
    const bestTarget: string = findBestTarget(ns, allNodes, player, bnMults.ServerMaxMoney);
    
    const localStateSnapshot: BotState = {
      strategy: activeStrategy,
      targetFaction: currentState?.targetFaction,
      targetCompany: currentState?.targetCompany,
      targetStat: currentState?.targetStat,
      progressBar: activeProgressBar,
      lastUpdate: Date.now(),
      playerHacking: ns.getHackingLevel(),
    };

    // Subsysteme steuern (reagiert intern auf Hacknet & Stock Market Mults)
    manageSuites(ns, scripts, localStateSnapshot, triggerBackdoor, bnMults);

    // ======================================================================
    // --- 🚀 ORCHESTRIERUNG DER SUB-MANAGER ---
    // ======================================================================
    if (homeMax >= 256 && ns.fileExists(scripts.dispatcher, "home") && !ns.isRunning(scripts.dispatcher, "home")) {
      ns.print("👑 Overlord: Starte zentralen System-Dispatcher...");
      ns.exec(scripts.dispatcher, "home", 1);
    }

    if (ns.fileExists(scripts.infra, "home") && !ns.isRunning(scripts.infra, "home")) {
      ns.print("🛠️ Overlord: Starte Infrastruktur-Manager...");
      ns.exec(scripts.infra, "home", 1);
    }

    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    const pServers = ns.cloud.getServerNames();
    const eligiblePServers = pServers.filter((s) => ns.getServerMaxRam(s) >= 64);
    const isFleetReady = hasFormulas && homeMax >= 256 && eligiblePServers.length > 0;
    const isDispatcherRunning = ns.isRunning(scripts.dispatcher, "home");

    // ======================================================================
    // --- 🧹 CLEANUP-TRIGGER: DYNAMIC FLEET EVAKUIERUNG ---
    // ======================================================================
    if (isFleetReady || isDispatcherRunning) {
      if (ns.isRunning(scripts.worker, "home") || ns.isRunning(scripts.xpfarm, "home")) {
        ns.print("🧹 [Kernel] ENGINE-MODE: DYNAMIC FLEET aktiv. Säubere 'home'...");
        ns.scriptKill(scripts.worker, "home");
        ns.scriptKill(scripts.xpfarm, "home");
      }

      for (const pServer of pServers) {
        if (ns.isRunning(scripts.worker, pServer) || ns.isRunning(scripts.xpfarm, pServer)) {
          ns.print(`🧹 [Kernel] Befreie P-Server '${pServer}' von Early-Game-Altlasten...`);
          ns.scriptKill(scripts.worker, pServer);
          ns.scriptKill(scripts.xpfarm, pServer);
        }
      }
    }

    // ======================================================================
    // --- 📡 WORKER DEPLOYMENT (NUR WENN DISPATCHER NOCH NICHT ÜBERNOMMEN HAT) ---
    // ======================================================================
    for (const node of allNodes) {
      if (ns.hasRootAccess(node)) {
        if (isDispatcherRunning) continue; // Dispatcher hat volle Kontrolle über RAM-Infrastruktur

        // Verhindere Thread-Verschwendung auf Home, wenn der Spieler manuell trainiert/arbeitet
        if (node === "home" && ["REP", "TRAIN", "CORP", "CRIME"].includes(activeStrategy)) {
          continue;
        }

        let activeScript = activeStrategy === "XP_SPRINT" ? scripts.xpfarm : scripts.worker;

        // --- 📊 DYNAMISCHER RAM-BUFFER (Abhängig von ServerWeakenRate & Strategie) ---
        let ramBuffer = 8;
        if (node === "home") {
          // Wenn das Abschwächen der Server extrem träge ist (WeakenRate niedrig), 
          // halten wir mehr RAM auf Home frei, um System-Deadlocks zu blockieren.
          const weakenPenalty = bnMults.ServerWeakenRate < 0.5 ? 16 : 0;
          
          if (["CRIME", "REP", "TRAIN", "CORP", "XP_SPRINT"].includes(activeStrategy)) {
            ramBuffer = 24 + weakenPenalty;
          } else {
            ramBuffer = 8 + weakenPenalty;
          }
          ramBuffer = Math.min(ramBuffer, homeMax * 0.5);
        }

        deployWorker(ns, node, activeScript, bestTarget, ramBuffer);
      }
    }

    const freshStateForDashboard = loadState(ns);
    drawSysKernelDashboard(
      ns,
      freshStateForDashboard || localStateSnapshot,
      bestTarget,
      allNodes,
      isFleetReady,
      bnMults,
    );
    await ns.sleep(2000);
  }
}

// ======================================================================
// --- 🛠️ SUBSYSTEM MANAGER (DYNAMIC FREISCHALTUNG) ---
// ======================================================================
function manageSuites(
  ns: NS,
  scripts: ScriptList,
  state: BotState,
  triggerBackdoor: boolean,
  bnMults: any,
): void {
  const homeMaxRam = ns.getServerMaxRam("home");
  const playerMoney = ns.getPlayer().money;
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  const targetHacknetScript = hasFormulas ? "tasks/hacknet.js" : "tasks/hacknet-early.js";
  const obsoleteHacknetScript = hasFormulas ? "tasks/hacknet-early.js" : "tasks/hacknet.js";

  if (ns.isRunning(obsoleteHacknetScript, "home")) {
    ns.scriptKill(obsoleteHacknetScript, "home");
  }

  const hasBrute = ns.fileExists("BruteSSH.exe", "home");

  if (homeMaxRam < 128) {
    if (ns.isRunning(targetHacknetScript, "home")) {
      ns.scriptKill(targetHacknetScript, "home");
    }
  } else if (!hasBrute) {
    if (ns.isRunning(targetHacknetScript, "home")) {
      ns.scriptKill(targetHacknetScript, "home");
    }
  } else {
    if (ns.fileExists(targetHacknetScript, "home") && !ns.isRunning(targetHacknetScript, "home")) {
      // Reagiere auf Hacknet-Mutilplier: Bei starkem Nerf (< 40% Ertrag) drosseln wir das Budget im Startaufruf
      if (bnMults.HacknetNodeMoney < 0.4) {
        ns.print("⚠️ [KERNEL] Hacknet-Produktion generft! Starte im limitierten Failsafe-Modus.");
        ns.exec(targetHacknetScript, "home", 1, 4, 100, 8, 4); // Begrenzte Nodes/Upgrades
      } else {
        ns.print(`⚡ [KERNEL] Starte unlimitiertes Hacknet-Subsystem...`);
        ns.exec(targetHacknetScript, "home", 1);
      }
    }
  }

  if (triggerBackdoor && ns.fileExists(scripts.backdoor, "home") && !ns.isRunning(scripts.backdoor, "home")) {
    ns.exec(scripts.backdoor, "home", 1);
  }

  // --- 📈 STOCK MARKET ENTRY (Skaliert mit API/Data Kosten) ---
  if (ns.fileExists(scripts.trade, "home") && !ns.isRunning(scripts.trade, "home")) {
    const hasTix = ns.stock.hasTixApiAccess();
    
    // Berechne dynamische finanzielle Einstiegsschwellen basierend auf den BN-Multiplikatoren
    const baseEntryCapital = 25_000_000_000 * bnMults.FourSigmaMarketDataCost;
    const tixApiThreshold = 100_000_000 * bnMults.FourSigmaMarketDataApiCost;

    if (
      (homeMaxRam >= 128 && playerMoney >= baseEntryCapital) ||
      (hasTix && ns.stock.purchase4SMarketDataTixApi() && playerMoney >= tixApiThreshold)
    ) {
      ns.exec(scripts.trade, "home", 1);
    }
  }

  if (ns.fileExists("DarkscapeNavigator.exe", "home")) {
    if (!ns.isRunning(scripts.replicator, "home")) {
      ns.exec(scripts.replicator, "home", 1);
    }
    if (ns.fileExists(scripts.crawler, "home") && !ns.isRunning(scripts.crawler, "home")) {
      ns.exec(scripts.crawler, "home", 1);
    }
  }
}

// ======================================================================
// --- 🎯 MATHEMATISCHES RE-WEIGHTING (TARGET FINDER) ---
// ======================================================================
function findBestTarget(ns: NS, nodes: string[], player: Player, serverMaxMoneyMult: number): string {
  let best = "n00dles";
  let maxWeight = 0;
  const isNoMoneyNode = serverMaxMoneyMult === 0;

  for (const node of nodes) {
    if (node === "home" || node === "darkweb" || node.startsWith("hacknet-node")) continue;
    if (!ns.hasRootAccess(node)) continue;

    const srv = ns.getServer(node);
    const maxMoney = srv.moneyMax ?? 0;

    if (!isNoMoneyNode && maxMoney <= 0) continue;

    const reqSkill = srv.requiredHackingSkill || 0;
    if (reqSkill > player.skills.hacking) continue;

    // XP_SPRINT Modus (z.B. BN8 oder Hacking-Insolvenz)
    if (isNoMoneyNode) {
      const cycleTime = ns.getWeakenTime(node);
      // Reines Gewichten nach Hacking-Skill-Anforderung pro Zeiteinheit
      const weight = reqSkill / (Math.max(1, cycleTime) / 1000);
      if (weight > maxWeight) {
        maxWeight = weight;
        best = node;
      }
      continue;
    }

    const cycleTime = ns.getWeakenTime(node);
    if (cycleTime > 5 * 60 * 1000) continue; // Filter Server mit mehr als 5 Min Laufzeit aus

    // Standard Profit-Gewichtung
    const weight = (maxMoney / (cycleTime / 1000)) * (reqSkill / 100);
    if (weight > maxWeight) {
      maxWeight = weight;
      best = node;
    }
  }
  return best;
}

function deployWorker(ns: NS, targetNode: string, scriptFilename: string, hackTarget: string, ramBuffer: number): void {
  if (!ns.fileExists(scriptFilename, "home")) return;

  const scriptCost = ns.getScriptRam(scriptFilename);
  const maxRam = ns.getServerMaxRam(targetNode);
  const usedRam = ns.getServerUsedRam(targetNode);
  let freedRam = 0;
  const procs = ns.ps(targetNode);

  const allWorkerScripts = ["tasks/work.js", "tasks/xp-grind.js", "tasks/hack.js", "tasks/grow.js", "tasks/weaken.js"];

  for (const p of procs) {
    if (allWorkerScripts.includes(p.filename) && (p.filename !== scriptFilename || p.args[0] !== hackTarget)) {
      ns.kill(p.pid);
      freedRam += ns.getScriptRam(p.filename, targetNode) * p.threads;
    }
  }

  const actualFreeRam = maxRam - usedRam + freedRam - ramBuffer;
  const threads = Math.floor(actualFreeRam / scriptCost);
  if (threads > 0) {
    if (targetNode !== "home") ns.scp(scriptFilename, targetNode, "home");
    ns.exec(scriptFilename, targetNode, threads, hackTarget);
  }
}

// ======================================================================
// --- 📊 OPERATIONAL OS DASHBOARD ---
// ======================================================================
function drawSysKernelDashboard(
  ns: NS,
  state: BotState,
  bestTarget: string,
  allNodes: string[],
  isFleetMode: boolean,
  bnMults: any,
): void {
  ns.clearLog();
  const rootCount = allNodes.filter((n) => ns.hasRootAccess(n)).length;
  
  ns.print(`================================================`);
  ns.print(`👑 BIT-OS SYS-KERNEL v2.0 - Units: ${rootCount}/${allNodes.length}`);
  ns.print(`================================================`);
  ns.print(`ENGINE-MODE : ${isFleetMode ? "DYNAMIC FLEET (>= 256GB)" : "BASIC LOOP (< 256GB)"}`);
  ns.print(`STRATEGIE   : ${state.strategy}`);

  if (isFleetMode && state.batcherTarget) {
    ns.print(`PRIMÄRZIEL  : ${state.batcherTarget} (BATCH)`);
    ns.print(`SEKUNDÄRZIEL: ${bestTarget} (FLEET)`);
  } else {
    ns.print(`ZIEL-SERVER : ${bestTarget}`);
  }

  ns.print("------------------------------------------------");
  ns.print(`HACK-YIELD  : ${(bnMults.ServerMaxMoney * bnMults.ScriptHackMoneyGain * 100).toFixed(0)}% Effizienz`);
  ns.print(`WEAKEN-RATE : ${(bnMults.ServerWeakenRate * 100).toFixed(0)}% Geschwindigkeit`);
  
  if (state.targetFaction) ns.print(`FRAKTION    : ${state.targetFaction}`);
  if (state.progressBar) {
    ns.print("------------------------------------------------");
    ns.print(`PROGRESS    : ${state.progressBar}`);
  }
  ns.print(`================================================`);
}