import { NS, Player, Server } from "@ns";
import { loadState, BotState } from "./state-manager.js";

// --- INTERFACES ---
interface ScriptList {
  worker: string;
  dispatcher: string;
  infra: string;
  backdoor: string;
  xpfarm: string;
  trade: string;
  hacknet: string;
  earlyHacknet: string; // NEU: Für das Formulas-freie Early Game
  replicator: string;

  hack: string;
  grow: string;
  weaken: string;
}

export async function main(ns: NS): Promise<void> {
  // Pfade zeigen jetzt sauber in die neuen Systemordner
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

  // --- 1. DARKNET-SUBSYSTEM START ---
  if (ns.fileExists("DarkscapeNavigator.exe", "home")) {
    if (!ns.isRunning(scripts.replicator, "home")) {
      ns.tprint("🌐 DarkscapeNavigator erkannt. Starte Darknet-Subsystem...");
      ns.run(scripts.replicator, 1);
    }
  }

  while (true) {
    // Nutzen jetzt den zentralen State-Manager zum Laden des Systemzustands
    const loadedState = loadState(ns);
    const state: BotState = {
      strategy: loadedState?.strategy || "MONEY",
      targetFaction: loadedState?.targetFaction || undefined,
      targetCompany: loadedState?.targetCompany || undefined,
      targetStat: loadedState?.targetStat || undefined,
      progressBar: loadedState?.progressBar || "",
    };

    const player: Player = ns.getPlayer();
    const allNodes: string[] = scanNetwork(ns);
    const bestTarget: string = findBestTarget(ns, allNodes, player);

    // --- SUBSYSTEME STARTEN & MANAGEN (Inkl. Hacknet Hot-Swap) ---
    manageSuites(ns, scripts, state);

    // System-Dispatcher sicherstellen
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

    // --- STRATEGISCHE ENTSCHEIDUNG FÜR DIE FLOTTE ---
    const homeMax = ns.getServerMaxRam("home");

    // Wir holen die aktuellen Werte des besten Ziels für die Zentral-Steuerung
    const maxMoney = ns.getServerMaxMoney(bestTarget);
    const minSecurity = ns.getServerMinSecurityLevel(bestTarget);
    const currentSecurity = ns.getServerBaseSecurityLevel(bestTarget);
    const currentMoney = ns.getServerMoneyAvailable(bestTarget);

    const moneyThresh = maxMoney * 0.9;
    const securityThresh = minSecurity + 2;

    // --- WORKER DEPLOYMENT ---
    for (const node of allNodes) {
      if (node !== "home") autoInfect(ns, node);

      if (ns.hasRootAccess(node)) {
        if (node === "home" && state.strategy === "REP") continue;

        // UNTER 128GB: Nutze klassisches work.js oder xp-farm.js
        let activeScript =
          state.strategy === "XP_SPRINT" ? scripts.xpfarm : scripts.worker;

        // --- DYNAMISCHES RAM-MANAGEMENT FÜR MICROSERVICES ---
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
            ramBuffer = 24; // Genug Platz für Dispatcher + Background-Worker
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

  for (const node of nodes) {
    if (
      node === "home" ||
      node === "darkweb" ||
      node.startsWith("hacknet-node")
    )
      continue;
    if (!ns.hasRootAccess(node)) continue;

    const srv = ns.getServer(node) as Server;
    if (!srv.moneyMax || srv.moneyMax <= 0) continue;

    const reqSkill = srv.requiredHackingSkill || 0;
    if (reqSkill > player.skills.hacking) continue;

    const cycleTime = ns.getWeakenTime(node);
    if (cycleTime > 5 * 60 * 1000) continue;

    const cycleTimeSeconds = cycleTime / 1000;
    const weight = (srv.moneyMax / cycleTimeSeconds) * (reqSkill / 100);

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

// --- ERWEITERTES MANAGEMENT DER HACKNET-SUITES ---
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

  // --- DYNAMISCHE HACKNET-WEICHE (HOT-SWAPPING) ---
  const hasFormulas = ns.fileExists("Formulas.exe", "home");
  const targetHacknet = hasFormulas ? scripts.hacknet : scripts.earlyHacknet;
  const obsoleteHacknet = hasFormulas ? scripts.earlyHacknet : scripts.hacknet;

  // 1. Kill den veralteten Service, falls er läuft (z.B. nach frischem Formulas-Kauf)
  if (ns.isRunning(obsoleteHacknet, "home")) {
    ns.scriptKill(obsoleteHacknet, "home");
    ns.print(`🔄 [KERNEL] Hacknet-Wechsel: ${obsoleteHacknet} beendet.`);
  }

  // 2. Starte den korrekten Service, falls er existiert und ruht
  if (
    ns.fileExists(targetHacknet, "home") &&
    !ns.isRunning(targetHacknet, "home")
  ) {
    ns.exec(targetHacknet, "home", 1);
  }
}

function scanNetwork(ns: NS): string[] {
  const visited = new Set<string>();
  const stack = ["home"];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (!visited.has(curr)) {
      visited.add(curr);
      ns.scan(curr).forEach((n) => stack.push(n));
    }
  }
  return Array.from(visited);
}

function autoInfect(ns: NS, node: string): void {
  if (ns.hasRootAccess(node)) return;

  let portsOpened = 0;
  if (ns.fileExists("BruteSSH.exe", "home")) {
    ns.brutessh(node);
    portsOpened++;
  }
  if (ns.fileExists("FTPCrack.exe", "home")) {
    ns.ftpcrack(node);
    portsOpened++;
  }
  if (ns.fileExists("relaySMTP.exe", "home")) {
    ns.relaysmtp(node);
    portsOpened++;
  }
  if (ns.fileExists("HTTPWorm.exe", "home")) {
    ns.httpworm(node);
    portsOpened++;
  }
  if (ns.fileExists("SQLInject.exe", "home")) {
    ns.sqlinject(node);
    portsOpened++;
  }

  if (portsOpened >= ns.getServerNumPortsRequired(node)) {
    ns.nuke(node);
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
