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

  ns.print("🚀 [Kernel] Starte Subsysteme...");

  if (!ns.scriptRunning("sys-hud.ts", "home")) {
    ns.exec("sys-hud.ts", "home", 1);
  }

  // Record<string, number> erlaubt uns den flexiblen Zugriff auf ALLE geladenen Multiplikatoren
  let bnMults: Record<string, number> = {
    ServerMaxMoney: 1.0,
    HacknetNodeMoney: 1.0,
    CrimeMoney: 1.0,
    CompanyWorkMoney: 1.0,
    FactionWorkRepGain: 1.0,
    ScriptHackMoney: 1.0,
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

  let lastRootCount = -1;

  while (true) {
    breakAndInfectNetwork(ns);
    const allNodes: string[] = getAllServers(ns);

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

    // ======================================================================
    // --- 🧠 DYNAMISCHE STRATEGIE-MATRIX (MULTIPLIER-GESTEUERT) ---
    // ======================================================================
    // FIX: Der Dispatcher ist das Hauptgehirn. Der Kernel greift nur noch bei
    // absoluten Notfällen (BitNode-Restriktionen) oder Upgrades ein.

    if (bnMults.ServerMaxMoney === 0) {
      // Höchste Priorität: Wenn wir absolut kein Geld aus Servern ziehen können.
      state.strategy = "XP_SPRINT";
      state.progressBar =
        "📉 BN-Sonderregel: Kein Server-Geld! Wechsle auf XP-Sprint.";
    } else if (state.strategy === "MONEY") {
      // Nur wenn der Dispatcher auf "MONEY" (Standard) steht, prüfen wir,
      // ob wir wegen eines BN-Multiplikators lieber arbeiten gehen sollten.
      const player = ns.getPlayer();
      const combatAvg =
        (player.skills.strength +
          player.skills.defense +
          player.skills.dexterity +
          player.skills.agility) /
        4;

      if (bnMults.CompanyWorkMoney > 1.0 && combatAvg >= 30) {
        state.strategy = "CORP";
        state.progressBar = `🏢 BN-Spezial: Nutze hocheffiziente Firmen-Arbeit (${(bnMults.CompanyWorkMoney * 100).toFixed(0)}%)`;
      }
      // Wir setzen die Standard-Nachricht nur, wenn der Dispatcher noch nichts gesetzt hat
      else if (!state.progressBar || state.progressBar === "") {
        state.progressBar = `💻 Hacking-Fleet aktiv (Ressourcen optimal genutzt)`;
      }
    }
    // ======================================================================

    const player: Player = ns.getPlayer();
    const bestTarget: string = findBestTarget(
      ns,
      allNodes,
      player,
      bnMults.ServerMaxMoney,
    );

    saveState(ns, state);
    // ... (Code über diesem Bereich bleibt gleich) ...
    manageSuites(ns, scripts, state, triggerBackdoor, bnMults);

    // 1. FIX: Dispatcher (Batcher) erst ab 256 GB starten!
    if (
      homeMax >= 256 &&
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

    const hasFormulas = ns.fileExists("Formulas.exe", "home");

    // --- ZENTRALE FLOTTEN-PRÜFUNG ---
    const pServers = ns.cloud.getServerNames();
    const eligiblePServers = pServers.filter(
      (s) => ns.getServerMaxRam(s) >= 64,
    );

    // Die Flotte ist NUR bereit, wenn Home groß genug ist UND wir fähige P-Server haben
    const isFleetReady =
      hasFormulas && homeMax >= 256 && eligiblePServers.length > 0;

    // --- WORKER DEPLOYMENT ---
    for (const node of allNodes) {
      if (ns.hasRootAccess(node)) {
        if (
          node === "home" &&
          ["REP", "TRAIN", "CORP", "CRIME"].includes(state.strategy)
        ) {
          continue;
        }

        // 2. NEU: Gnadenloses Aufräumen, wenn der Dispatcher läuft.
        // Der Dispatcher (sys-dispatcher.ts) startet ab 256 GB auf Home.
        // Wenn er läuft, übernimmt er (via Batcher/Filler) die Kontrolle. Der Kernel muss schweigen.
        const isDispatcherRunning = ns.isRunning(scripts.dispatcher, "home");

        if (isDispatcherRunning && isFleetReady) {
          const procs = ns.ps(node);
          const standardScripts = [
            "tasks/work.js",
            "tasks/xp-grind.js",
            // Wir killen HIER keine Einzel-Skripte (hack/grow/weaken) mehr blind,
            // denn die werden vom Dispatcher/Batcher gesteuert!
            // Wir killen nur die alten "All-in-One"-Fallback-Skripte, falls noch welche laufen.
          ];
          for (const p of procs) {
            if (standardScripts.includes(p.filename)) {
              ns.kill(p.pid);
            }
          }
          continue; // WICHTIG: Wenn Dispatcher läuft, überspringt der Kernel das Deployment auf diesem Node.
        }

        // --- FALLBACK-MODUS (Nur wenn Home < 256GB und Dispatcher NICHT läuft) ---
        let activeScript =
          state.strategy === "XP_SPRINT" ? scripts.xpfarm : scripts.worker;

        // Da wir nur im Fallback sind, nutzen wir immer das All-in-One "work.js".
        // Die Aufspaltung in Einzel-Skripte passiert exklusiv im Dispatcher/Batcher.

        let ramBuffer = 0;
        if (node === "home") {
          if (
            ["CRIME", "REP", "TRAIN", "CORP", "XP_SPRINT"].includes(
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
      isFleetReady, // Hier isFleetReady statt homeMax >= 256 übergeben
      bnMults.ServerMaxMoney,
    );
    await ns.sleep(2000);
  }
}

function manageSuites(
  ns: NS,
  scripts: ScriptList,
  state: BotState,
  triggerBackdoor: boolean,
  bnMults: Record<string, number>,
): void {
  const homeMaxRam = ns.getServerMaxRam("home");
  const playerMoney = ns.getPlayer().money;
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  const targetHacknetScript = hasFormulas
    ? "tasks/hacknet.js"
    : "tasks/hacknet-early.js";
  const obsoleteHacknetScript = hasFormulas
    ? "tasks/hacknet-early.js"
    : "tasks/hacknet.js";

  if (ns.isRunning(obsoleteHacknetScript, "home")) {
    ns.scriptKill(obsoleteHacknetScript, "home");
  }

  const hasBrute = ns.fileExists("BruteSSH.exe", "home");

  // --- ARCHITEKTUR-ENTSCHEIDUNG HACKNET ---
  // 1. Sperre im absoluten Early-Game (unter 128GB RAM gehört jeder Dollar den Server-Upgrades / Crime)
  if (homeMaxRam < 128) {
    if (ns.isRunning(targetHacknetScript, "home")) {
      ns.print(
        "⏳ [KERNEL] Blockiere Hacknet: Fokus liegt auf 128GB RAM Upgrade.",
      );
      ns.scriptKill(targetHacknetScript, "home");
    }
  }
  // 2. Erlaubnis ab 128GB RAM, um den Netburners-Gegenwert einzufahren
  else if (!hasBrute) {
    if (ns.isRunning(targetHacknetScript, "home")) {
      ns.print(
        "⏳ [KERNEL] Blockiere Hacknet: Spare Geld für TOR / BruteSSH.exe.",
      );
      ns.scriptKill(targetHacknetScript, "home");
    }
  }
  // 3. Start-Freigabe
  else {
    if (
      ns.fileExists(targetHacknetScript, "home") &&
      !ns.isRunning(targetHacknetScript, "home")
    ) {
      // Eine elegante Injektion: Wenn Hacknet stark nerfed ist (< 40%), übergeben wir
      // dem Skript via Argumente dein gewünschtes Netburners-Hard-Cap!
      if (bnMults.HacknetNodeMoney < 0.4) {
        ns.print(
          "⚠️ [KERNEL] Hacknet-Produktion stark eingeschränkt! Starte im Netburners-Failsafe-Modus.",
        );
        // Args: MaxNodes=4, MaxLevel=100, MaxRam=8, MaxCores=4
        ns.exec(targetHacknetScript, "home", 1, 4, 100, 8, 4);
      } else {
        ns.print(`⚡ [KERNEL] Starte unlimitiertes Hacknet-Subsystem...`);
        ns.exec(targetHacknetScript, "home", 1);
      }
    }
  }

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

  if (ns.fileExists("DarkscapeNavigator.exe", "home")) {
    if (!ns.isRunning(scripts.replicator, "home")) {
      ns.tprint("🌐 DarkscapeNavigator erkannt. Starte Darknet-Master...");
      ns.exec(scripts.replicator, "home", 1);
    }

    if (
      ns.fileExists(scripts.crawler, "home") &&
      !ns.isRunning(scripts.crawler, "home")
    ) {
      ns.print("📡 [KERNEL] Starte initialen Darknet-Crawler auf home...");
      ns.exec(scripts.crawler, "home", 1);
    }
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

    if (isNoMoneyNode) {
      const cycleTime = ns.getWeakenTime(node);
      const weight = reqSkill / (Math.max(1, cycleTime) / 1000);
      if (weight > maxWeight) {
        maxWeight = weight;
        best = node;
      }
      continue;
    }

    const cycleTime = ns.getWeakenTime(node);
    if (cycleTime > 5 * 60 * 1000) continue;

    const weight = (maxMoney / (cycleTime / 1000)) * (reqSkill / 100);
    if (weight > maxWeight) {
      maxWeight = weight;
      best = node;
    }
  }
  return best;
}

function isBatchReady(ns: NS, node: string): boolean {
  // Ein Server braucht mind. 64GB, um einen vernünftigen Batch-Zyklus stabil zu hosten
  return ns.getServerMaxRam(node) >= 64;
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
    "tasks/xp-grind.js",
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
    `ENGINE-MODE: ${isFleetMode ? "DYNAMIC FLEET (>= 256GB)" : "BASIC LOOP (< 256GB)"}`,
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
