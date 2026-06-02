import { NS, Player, Server } from "@ns";
import { loadState, BotState } from "./state-manager.js";
// 1. IMPORTIERE DIE ZENTRALEN ZAHNRÄDER
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";

interface ScriptList {
  worker: string;
  dispatcher: string;
  infra: string;
  backdoor: string;
  xpfarm: string;
  trade: string;
  hacknet: string;
  earlyHacknet: string;
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
    xpfarm: "tasks/xp-farm.js",
    trade: "modules/trading-bot.js",
    hacknet: "tasks/hacknet.js",
    earlyHacknet: "tasks/early-hacknet.js",
    replicator: "modules/darknet-replicator.js",
    hack: "tasks/hack.js",
    grow: "tasks/grow.js",
    weaken: "tasks/weaken.js",
  };

  ns.disableLog("ALL");
  ns.ui.openTail();

  if (ns.fileExists("DarkscapeNavigator.exe", "home")) {
    if (!ns.isRunning(scripts.replicator, "home")) {
      ns.tprint("🌐 DarkscapeNavigator erkannt. Starte Darknet-Subsystem...");
      ns.run(scripts.replicator, 1);
    }
  }

  while (true) {
    // 2. NETZWERK ANREICHERN & SCANNEN
    // Bricht sofort alle neu knackbaren Server auf
    breakAndInfectNetwork(ns);
    // Holt die saubere, einheitliche Serverliste
    const allNodes: string[] = getAllServers(ns);

    const loadedState = loadState(ns);
    const state: BotState = {
      strategy: loadedState?.strategy || "MONEY",
      targetFaction: loadedState?.targetFaction || undefined,
      targetCompany: loadedState?.targetCompany || undefined,
      targetStat: loadedState?.targetStat || undefined,
      progressBar: loadedState?.progressBar || "",
    };

    const player: Player = ns.getPlayer();
    const bestTarget: string = findBestTarget(ns, allNodes, player);

    manageSuites(ns, scripts, state);

    if (
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

    const homeMax = ns.getServerMaxRam("home");
    const maxMoney = ns.getServerMaxMoney(bestTarget);
    const minSecurity = ns.getServerMinSecurityLevel(bestTarget);
    const currentSecurity = ns.getServerBaseSecurityLevel(bestTarget);
    const currentMoney = ns.getServerMoneyAvailable(bestTarget);

    const moneyThresh = maxMoney * 0.9;
    const securityThresh = minSecurity + 2;

    const hasFormulas = ns.fileExists("Formulas.exe", "home");

    // --- WORKER DEPLOYMENT ---
    for (const node of allNodes) {
      // HINWEIS: autoInfect(ns, node) wurde gelöscht, da breakAndInfectNetwork(ns) oben bereits ALLES erledigt hat!

      if (ns.hasRootAccess(node)) {
        if (node === "home" && state.strategy === "REP") continue;

        // NEU: Wenn wir im MONEY-Modus sind UND Formulas besitzen,
        // übernimmt der sys-batcher die volle Kontrolle über den Ram.
        // Der Kernel zieht seine Standard-Worker ab!
        if (state.strategy === "MONEY" && hasFormulas) {
          // Bestehende Standard-Worker töten, um Platz für die präzisen Batches zu machen
          const procs = ns.ps(node);
          const standardScripts = [
            "tasks/work.js",
            "tasks/xp-farm.js",
            "tasks/hack.js",
            "tasks/grow.js",
            "tasks/weaken.js",
          ];

          // Aber ACHTUNG: Wir dürfen die vom Batcher gestarteten Skripte NICHT killen.
          // Der Batcher übergibt eine BatchID als args[2]. Standard-Worker haben das nicht.
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

    drawSysKernelDashboard(ns, state, bestTarget, allNodes, homeMax >= 128);
    await ns.sleep(2000);
  }
}

function findBestTarget(ns: NS, nodes: string[], player: Player): string {
  let best = "n00dles";
  let maxWeight = 0;
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  for (const node of nodes) {
    if (
      node === "home" ||
      node === "darkweb" ||
      node.startsWith("hacknet-node")
    )
      continue;
    if (!ns.hasRootAccess(node)) continue;

    const srv = ns.getServer(node);
    if (!srv.moneyMax || srv.moneyMax <= 0) continue;

    const reqSkill = srv.requiredHackingSkill || 0;
    if (reqSkill > player.skills.hacking) continue;

    if (hasFormulas) {
      // --- HIGH-END FORMULAS CALCULATION ---
      // Wir simulieren den Server im Idealzustand (Min Security, Max Money)
      const mockServer = {
        ...srv,
        hackDifficulty: srv.minDifficulty,
        moneyAvailable: srv.moneyMax,
      };

      const hackChance = ns.formulas.hacking.hackChance(mockServer, player);
      const hackPct = ns.formulas.hacking.hackPercent(mockServer, player);
      const weakenTime = ns.formulas.hacking.weakenTime(mockServer, player);

      if (weakenTime > 5 * 60 * 1000) continue; // Alles über 5 Min ignorieren

      // Gewichtung = (Maximales Geld * Dieb-Prozent pro Thread * Erfolgschance) / Zeit
      // Das ergibt den exakten, realen theoretischen Gewinn pro Sekunde und Thread!
      const weight =
        (srv.moneyMax * hackPct * hackChance) / (weakenTime / 1000);

      if (weight > maxWeight) {
        maxWeight = weight;
        best = node;
      }
    } else {
      // --- LEGACY FALLBACK (Wenn Formulas.exe noch fehlt) ---
      const cycleTime = ns.getWeakenTime(node);
      if (cycleTime > 5 * 60 * 1000) continue;

      const weight = (srv.moneyMax / (cycleTime / 1000)) * (reqSkill / 100);
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
    "tasks/xp-farm.js",
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

  const hasFormulas = ns.fileExists("Formulas.exe", "home");
  const targetHacknet = hasFormulas ? scripts.hacknet : scripts.earlyHacknet;
  const obsoleteHacknet = hasFormulas ? scripts.earlyHacknet : scripts.hacknet;

  if (ns.isRunning(obsoleteHacknet, "home")) {
    ns.scriptKill(obsoleteHacknet, "home");
    ns.print(`🔄 [KERNEL] Hacknet-Wechsel: ${obsoleteHacknet} beendet.`);
  }

  if (
    ns.fileExists(targetHacknet, "home") &&
    !ns.isRunning(targetHacknet, "home")
  ) {
    ns.exec(targetHacknet, "home", 1);
  }
}

function drawSysKernelDashboard(
  ns: NS,
  state: BotState,
  bestTarget: string,
  allNodes: string[],
  isFleetMode: boolean,
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
  if (state.targetFaction) {
    ns.print(`FRAKTION:   ${state.targetFaction}`);
  }
  if (state.progressBar) {
    ns.print(`----------------------------------------`);
    ns.print(`PROGRESS:   ${state.progressBar}`);
  }
  ns.print(`========================================`);
}
