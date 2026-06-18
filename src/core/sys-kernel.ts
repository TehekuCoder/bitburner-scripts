import { NS, Player, Server } from "@ns";
import { loadState, saveState, BotState } from "./state-manager.js";
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";

interface ScriptList {
  worker: string;
  dispatcher: string;
  infra: string;
  backdoor: string;
  xpfarm: string;
  trade: string;
  hacknet: string;
  replicator: string;
  hack: string;
  grow: string;
  weaken: string;
}

export async function main(ns: NS): Promise<void> {
  const scripts: ScriptList = {
    worker: "tasks/work.js",
    dispatcher: "core/sys-dispatcher.js",
    infra: "core/sys-infra.js",
    backdoor: "tasks/backdoor.js",
    xpfarm: "tasks/weaken-xp.js",
    trade: "modules/trading-bot.js",
    hacknet: "tasks/hacknet-early.js", // ANGEPASST: Nutzt jetzt den schlanken Early-Game-Bot
    replicator: "tasks/dnet/dnet-crawler.js",
    hack: "tasks/hack.js",
    grow: "tasks/grow.js",
    weaken: "tasks/weaken.js",
  };

  ns.disableLog("ALL");
  ns.ui.openTail();

  ns.print("🚀 [Kernel] Starte Subsysteme...");

  if (!ns.scriptRunning("sys-hud.ts", "home")) {
    ns.exec("sys-hud.ts", "home", 1);
  }

  let bnMults = {
    ServerMaxMoney: 1.0,
    HacknetProduction: 1.0,
    CrimeMoney: 1.0,
    FactionWorkRepGain: 1.0,
  };

  if (ns.fileExists("bn-multipliers.txt", "home")) {
    try {
      const fileContent = ns.read("bn-multipliers.txt");
      if (fileContent) {
        bnMults = { ...bnMults, ...JSON.parse(fileContent) };
      }
    } catch {
      ns.print(
        "⚠️ [KERNEL] Fehler beim Parsen der bn-multipliers.txt. Failsafe aktiv.",
      );
    }
  }

  // Für den intelligenten Backdoor-Trigger
  let lastRootCount = -1;

  while (true) {
    // 1. NETZWERK ANREICHERN & SCANNEN
    breakAndInfectNetwork(ns);
    const allNodes: string[] = getAllServers(ns);

    // Prüfen, ob neue Server gerootet wurden, um Backdoor-Skript effizient anzustoßen
    const currentRootCount = allNodes.filter((n) => ns.hasRootAccess(n)).length;
    const triggerBackdoor = currentRootCount > lastRootCount;
    lastRootCount = currentRootCount;

    const homeMax = ns.getServerMaxRam("home");
    const loadedState = loadState(ns);

    const state: BotState = {
      strategy: loadedState?.strategy || "MONEY",
      targetFaction: loadedState?.targetFaction || undefined,
      targetCompany: loadedState?.targetCompany || undefined,
      targetStat: loadedState?.targetStat || undefined,
      progressBar: loadedState?.progressBar || "",
      lastUpdate: Date.now(),
      playerHacking: ns.getHackingLevel(),
    };

    // HARDCORE EARLY-GAME SAFEGUARD:
    if (homeMax < 64) {
      state.strategy = "MONEY";
      state.progressBar = "💰 Early-Game-Booster (Warte auf 64GB RAM)";
    }

    if (bnMults.ServerMaxMoney === 0 && state.strategy === "MONEY") {
      state.strategy = "XP_SPRINT";
      state.progressBar =
        "📉 BN-Sonderregel: Kein Server-Geld! Wechsle auf XP-Sprint.";
    }

    const player: Player = ns.getPlayer();
    const bestTarget: string = findBestTarget(
      ns,
      allNodes,
      player,
      bnMults.ServerMaxMoney,
    );

    saveState(ns, state);

    // REPARIERT: Übergibt den triggerBackdoor-Flag an den Suite-Manager
    manageSuites(ns, scripts, state, triggerBackdoor);

    if (
      homeMax >= 64 &&
      ns.fileExists(scripts.dispatcher, "home") &&
      !ns.isRunning(scripts.dispatcher, "home")
    ) {
      ns.print("👑 Overlord: Starte zentralen System-Dispatcher...");
      ns.exec(scripts.dispatcher, "home", 1);
    }

    if (
      ns.fileExists(scripts.infra, "home") &&
      !ns.isRunning(scripts.infra, "home")
    ) {
      ns.print("🛠️ Overlord: Starte Infrastruktur-Manager...");
      ns.exec(scripts.infra, "home", 1);
    }

    const maxMoney = ns.getServerMaxMoney(bestTarget);
    const minSecurity = ns.getServerMinSecurityLevel(bestTarget);
    const currentSecurity = ns.getServerSecurityLevel(bestTarget);
    const currentMoney = ns.getServerMoneyAvailable(bestTarget);

    const moneyThresh = maxMoney * 0.9;
    const securityThresh = minSecurity + 2;

    const hasFormulas = ns.fileExists("Formulas.exe", "home");

    // ======================================================================
    // --- WORKER DEPLOYMENT ---
    // ======================================================================
    for (const node of allNodes) {
      if (ns.hasRootAccess(node)) {
        if (
          node === "home" &&
          ["REP", "TRAIN", "CORP", "CRIME"].includes(state.strategy)
        ) {
          continue;
        }

        // Kernel tritt zurück, wenn der Dispatcher übernehmen kann
        if (hasFormulas && homeMax >= 64) {
          const procs = ns.ps(node);
          const standardScripts = [
            "tasks/work.js",
            "tasks/weaken-xp.js",
            "tasks/hack.js",
            "tasks/grow.js",
            "tasks/weaken.js",
          ];

          for (const p of procs) {
            if (
              standardScripts.includes(p.filename) &&
              p.args[2] === undefined
            ) {
              ns.kill(p.pid);
            }
          }
          continue;
        }

        // --- LEGACY FALLBACK (Early Game Hacking) ---
        let activeScript =
          state.strategy === "XP_SPRINT" ? scripts.xpfarm : scripts.worker;

        if (homeMax >= 128 && state.strategy !== "XP_SPRINT") {
          if (currentSecurity > securityThresh) {
            activeScript = scripts.weaken;
          } else if (currentMoney < moneyThresh) {
            activeScript = scripts.grow;
          } else {
            activeScript = scripts.hack;
          }
        }

        let ramBuffer = 0;
        if (node === "home") {
          if (
            ["CRIME", "REP", "TRAIN", "CORP", "SHOP", "XP_SPRINT"].includes(
              state.strategy,
            )
          ) {
            ramBuffer = 24;
          } else {
            ramBuffer = 8;
          }
          ramBuffer = Math.min(ramBuffer, homeMax * 0.5);
        }

        deployWorker(ns, node, activeScript, bestTarget, ramBuffer);
      }
    }

    drawSysKernelDashboard(
      ns,
      state,
      bestTarget,
      allNodes,
      homeMax >= 128,
      bnMults.ServerMaxMoney,
    );
    await ns.sleep(2000);
  }
}

function findBestTarget(
  ns: NS,
  nodes: string[],
  player: Player,
  serverMaxMoneyMult: number,
): string {
  let best = "n00dles";
  let maxWeight = 0;
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

    // SPEZIALMODUS: Reine Hacking-XP Optimierung ($0-Server)
    if (isNoMoneyNode) {
      const cycleTime = ns.getWeakenTime(node);
      const weight = reqSkill / (Math.max(1, cycleTime) / 1000);
      if (weight > maxWeight) {
        maxWeight = weight;
        best = node;
      }
      continue;
    }

    // REPARIERT: Formulas-Zweig komplett entfernt, um 5GB RAM im Kernel einzusparen.
    // Early-Game-Gewichtung basiert rein auf Geld im Verhältnis zur Laufzeit.
    const cycleTime = ns.getWeakenTime(node);
    if (cycleTime > 5 * 60 * 1000) continue; // Ignoriere Server, die länger als 5 Min brauchen

    const weight = (maxMoney / (cycleTime / 1000)) * (reqSkill / 100);
    if (weight > maxWeight) {
      maxWeight = weight;
      best = node;
    }
  }
  return best;
}

function deployWorker(
  ns: NS,
  targetNode: string,
  scriptFilename: string,
  hackTarget: string,
  ramBuffer: number,
): void {
  if (!ns.fileExists(scriptFilename, "home")) return;

  const scriptCost = ns.getScriptRam(scriptFilename);
  const maxRam = ns.getServerMaxRam(targetNode);
  const usedRam = ns.getServerUsedRam(targetNode);
  let freedRam = 0;
  const procs = ns.ps(targetNode);

  const allWorkerScripts = [
    "tasks/work.js",
    "tasks/weaken-xp.js",
    "tasks/hack.js",
    "tasks/grow.js",
    "tasks/weaken.js",
  ];

  for (const p of procs) {
    if (
      allWorkerScripts.includes(p.filename) &&
      (p.filename !== scriptFilename || p.args[0] !== hackTarget)
    ) {
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

function manageSuites(
  ns: NS,
  scripts: ScriptList,
  state: BotState,
  triggerBackdoor: boolean,
): void {
  const homeMaxRam = ns.getServerMaxRam("home");
  const playerMoney = ns.getPlayer().money;
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  // ======================================================================
  // --- HACKNET HOT-SWAP MANAGER ---
  // ======================================================================
  // Bestimme den Soll-Zustand basierend auf Formulas-Besitz
  const targetHacknetScript = hasFormulas ? "tasks/hacknet.js" : "tasks/hacknet-early.js";
  const obsoleteHacknetScript = hasFormulas ? "tasks/hacknet-early.js" : "tasks/hacknet.js";

  // Falls der falsche Bot läuft: Killen!
  if (ns.isRunning(obsoleteHacknetScript, "home")) {
    ns.print(`🔄 [KERNEL] Formulas-Status geändert. Beende ${obsoleteHacknetScript}...`);
    ns.scriptKill(obsoleteHacknetScript, "home");
  }

  // Richtigen Bot starten, falls er noch nicht läuft
  if (
    ns.fileExists(targetHacknetScript, "home") &&
    !ns.isRunning(targetHacknetScript, "home")
  ) {
    ns.print(`⚡ [KERNEL] Starte adaptives Hacknet-Subsystem (${hasFormulas ? "Advanced ROI" : "Early-Heuristic"})...`);
    ns.exec(targetHacknetScript, "home", 1);
  }
  // ======================================================================

  // --- RESTLICHE SUITEN ---
  if (
    triggerBackdoor &&
    ns.fileExists(scripts.backdoor, "home") &&
    !ns.isRunning(scripts.backdoor, "home")
  ) {
    ns.exec(scripts.backdoor, "home", 1);
  }

  if (
    ns.fileExists(scripts.trade, "home") &&
    !ns.isRunning(scripts.trade, "home")
  ) {
    const hasTix = ns.stock.hasTixApiAccess();
    if (
      (homeMaxRam >= 128 && playerMoney >= 25_000_000_000) ||
      (hasTix &&
        ns.stock.purchase4SMarketDataTixApi() &&
        playerMoney >= 100_000_000)
    )
      ns.exec(scripts.trade, "home", 1);
  }

  if (
    ns.fileExists("DarkscapeNavigator.exe", "home") &&
    !ns.isRunning(scripts.replicator, "home")
  ) {
    ns.tprint("🌐 DarkscapeNavigator erkannt. Starte Darknet-Subsystem...");
    ns.exec(scripts.replicator, "home", 1);
  }
}
function drawSysKernelDashboard(
  ns: NS,
  state: BotState,
  bestTarget: string,
  allNodes: string[],
  isFleetMode: boolean,
  serverMaxMoneyMult: number,
): void {
  ns.clearLog();
  const rootCount = allNodes.filter((n) => ns.hasRootAccess(n)).length;
  ns.print(`========================================`);
  ns.print(`👑 BIT-OS SYS-KERNEL - Units: ${rootCount}/${allNodes.length}`);
  ns.print(`========================================`);
  ns.print(
    `ENGINE-MODE: ${isFleetMode ? "DYNAMIC FLEET (>=128GB)" : "LEGACY LOOP (<128GB)"}`,
  );
  ns.print(`STRATEGIE:  ${state.strategy}`);
  ns.print(`ZIEL:       ${bestTarget}`);
  if (serverMaxMoneyMult !== 1.0) {
    ns.print(`BN-MONEY:   ${(serverMaxMoneyMult * 100).toFixed(0)}% Effizienz`);
  }
  if (state.targetFaction) {
    ns.print(`FRAKTION:   ${state.targetFaction}`);
  }
  if (state.progressBar) {
    ns.print("----------------------------------------");
    ns.print(`PROGRESS:   ${state.progressBar}`);
  }
  ns.print(`========================================`);
}
