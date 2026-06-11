import { NS, Player, Server } from "@ns";
import { loadState, saveState, BotState } from "./state-manager.js"; // REPARIERT: saveState importiert
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
    hacknet: "tasks/hacknet.js",
    replicator: "modules/darknet-replicator.js",
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

  // --- SAFE ENVIRONMENT LAYER (FAILSAFE-FALLBACK) ---
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
        "⚠️ [KERNEL] Fehler beim Parsen der bn-multipliers.txt. Nutze Failsafe-Modus.",
      );
    }
  }

  while (true) {
    // 2. NETZWERK ANREICHERN & SCANNEN
    breakAndInfectNetwork(ns);
    const allNodes: string[] = getAllServers(ns);

    const homeMax = ns.getServerMaxRam("home");
    const loadedState = loadState(ns);

    // REPARIERT: lastUpdate nutzt JETZT immer die Echtzeit, damit das HUD den Kernel-Puls spürt
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

    // HIGH-END STRATEGIE-ANPASSUNG
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

    // REPARIERT: Zustand auf Platte sichern, damit HUD und Subskripte die Kernel-Entscheidungen sehen!
    saveState(ns, state);

    manageSuites(ns, scripts, state);

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

        // OPTIMIERT: Der Kernel tritt nur zurück, wenn Formulas UND genug RAM für den Dispatcher da sind!
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

        // --- LEGACY FALLBACK ---
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
  const hasFormulas = ns.fileExists("Formulas.exe", "home");
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

    // TYPENSICHERHEIT: Fallback auf 0, falls moneyMax 'undefined' ist.
    // Damit weiß TypeScript ab hier, dass 'maxMoney' definitiv vom Typ 'number' ist.
    const maxMoney = srv.moneyMax ?? 0;

    // Wenn wir im normalen Geld-Modus sind, ignorieren wir Server ohne Geld
    if (!isNoMoneyNode && maxMoney <= 0) continue;

    const reqSkill = srv.requiredHackingSkill || 0;
    if (reqSkill > player.skills.hacking) continue;

    // SPEZIALMODUS: Reine Hacking-XP Optimierung bei $0-Servern (z.B. BitNode 8)
    if (isNoMoneyNode) {
      const cycleTime = ns.getWeakenTime(node);
      const weight = reqSkill / (Math.max(1, cycleTime) / 1000);
      if (weight > maxWeight) {
        maxWeight = weight;
        best = node;
      }
      continue;
    }

    if (hasFormulas) {
      const mockServer = {
        ...srv,
        hackDifficulty: srv.minDifficulty ?? 100, // Failsafe für Compiler
        moneyAvailable: maxMoney, // Jetzt garantiert eine Number
      };

      const hackChance = ns.formulas.hacking.hackChance(mockServer, player);
      const hackPct = ns.formulas.hacking.hackPercent(mockServer, player);
      const weakenTime = ns.formulas.hacking.weakenTime(mockServer, player);

      const weight = (maxMoney * hackPct * hackChance) / (weakenTime / 1000);

      if (weight > maxWeight) {
        maxWeight = weight;
        best = node;
      }
    } else {
      const cycleTime = ns.getWeakenTime(node);
      if (cycleTime > 5 * 60 * 1000) continue;

      // Mathematische Operationen sind jetzt sicher vor 'undefined'-Fehlern
      const weight = (maxMoney / (cycleTime / 1000)) * (reqSkill / 100);
      if (weight > maxWeight) {
        maxWeight = weight;
        best = node;
      }
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

function manageSuites(ns: NS, scripts: ScriptList, state: BotState): void {
  const homeMaxRam = ns.getServerMaxRam("home");
  const playerMoney = ns.getPlayer().money;

  if (
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
    ns.fileExists(scripts.hacknet, "home") &&
    !ns.isRunning(scripts.hacknet, "home")
  ) {
    ns.print("⚡ [KERNEL] Starte adaptives Hacknet-Subsystem...");
    ns.exec(scripts.hacknet, "home", 1);
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
