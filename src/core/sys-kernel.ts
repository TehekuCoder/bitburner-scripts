import { NS, Player } from "@ns";
import { loadState, patchState, BotState } from "./state-manager.js";
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { provisionServer } from "../utils/provision.js";

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
    weaken: "tasks/weaken.js",
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
    ns.print(
      "⚠️ [BOOT_WARN] Source-File 5 nicht aktiv. Nutze Failsafe-Matrix.",
    );
    ns.write(
      "bn-multipliers.txt",
      JSON.stringify(DEFAULT_MULTIPLIERS, null, 2),
      "w",
    );
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
    // --- 🧠 DYNAMISCHE EFFIZIENZ-MATRIX (GEWALTENTEILUNG) ---
    // ======================================================================
    const isDispatcherReady =
      homeMax >= 256 && ns.fileExists(scripts.dispatcher, "home");

    if (!isDispatcherReady) {
      // 🛡️ FALLBACK-LOGIK: Nur aktiv, wenn kein Dispatcher das Kommando hat (Early-Game)
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
        // Bleibt stabil im Crime-Modus, kein Oszillieren mehr!
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

      // State nur im Early-Game selbst patchen
      patchState(ns, {
        strategy: activeStrategy,
        progressBar: activeProgressBar,
      });
    } else {
      // 👑 DISPATCHER-MODUS: Der Dispatcher regiert. Der Kernel liest nur die Befehle.
      activeStrategy = currentState?.strategy || "MONEY";
      activeProgressBar = currentState?.progressBar || "";
    }

    const bestTarget: string = findBestTarget(ns, allNodes, player, bnMults);

    const localStateSnapshot: BotState = {
      strategy: activeStrategy,
      targetFaction: currentState?.targetFaction,
      targetCompany: currentState?.targetCompany,
      targetStat: currentState?.targetStat,
      batcherTarget: currentState?.batcherTarget, // 🌟 HIER HINZUFÜGEN: Sichert das Batcher-Ziel bei Kollisionen
      progressBar: activeProgressBar,
      lastUpdate: Date.now(),
      playerHacking: ns.getHackingLevel(),
    };

    manageSuites(ns, scripts, localStateSnapshot, triggerBackdoor, bnMults);

    // ======================================================================
    // --- 🚀 ORCHESTRIERUNG DER SUB-MANAGER ---
    // ======================================================================
    let isDispatcherRunning = ns.isRunning(scripts.dispatcher, "home");

    if (
      homeMax >= 256 &&
      ns.fileExists(scripts.dispatcher, "home") &&
      !isDispatcherRunning
    ) {
      ns.print("👑 Overlord: Starte zentralen System-Dispatcher...");
      ns.exec(scripts.dispatcher, "home", 1);
      isDispatcherRunning = true;
    }

    if (
      ns.fileExists(scripts.infra, "home") &&
      !ns.isRunning(scripts.infra, "home")
    ) {
      ns.print("🛠️ Overlord: Starte Infrastruktur-Manager...");
      ns.exec(scripts.infra, "home", 1);
    }

    // ======================================================================
    // --- 🧹 CLEANUP & 📡 WORKER DEPLOYMENT ---
    // ======================================================================
    for (const node of allNodes) {
      if (!ns.hasRootAccess(node)) continue;
      if (isDispatcherRunning) continue;

      if (
        node === "home" &&
        ["REP", "TRAIN", "CORP", "CRIME"].includes(activeStrategy)
      ) {
        continue;
      }

      let activeScript =
        activeStrategy === "XP_SPRINT" ? scripts.xpfarm : scripts.worker;

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

    // 🔥 KERNEL-UPGRADE: Formulas ist im Mid-Game kein Hard-Requirement mehr für die Fleet!
    const pServers = ns.cloud.getServerNames();
    const eligiblePServers = pServers.filter(
      (s) => ns.getServerMaxRam(s) >= 64,
    );

    // Fleet ist bereit, wenn Home genug RAM hat UND die p-Server groß genug sind
    const isFleetReady = homeMax >= 256 && eligiblePServers.length > 0;

    // ======================================================================
    // --- 📊 OPERATIONAL OS DASHBOARD UNTERSTÜTZUNG ---
    // ======================================================================
    const freshStateForDashboard = loadState(ns);

    // 🌟 REFACTORING: Keine redundanten uiTarget-Abfragen oder String-Ersetzungen mehr.
    // Das Dashboard bekommt immer die ungefilterte Wahrheit ('bestTarget') geliefert.
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
// --- 🛠️ SUBSYSTEM MANAGER ---
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

  if (homeMaxRam < 128 || !hasBrute) {
    if (ns.isRunning(targetHacknetScript, "home")) {
      ns.scriptKill(targetHacknetScript, "home");
    }
  } else {
    if (
      ns.fileExists(targetHacknetScript, "home") &&
      !ns.isRunning(targetHacknetScript, "home")
    ) {
      if (bnMults.HacknetNodeMoney < 0.4) {
        ns.print(
          "⚠️ [KERNEL] Hacknet-Produktion generft! Starte im limitierten Failsafe-Modus.",
        );
        ns.exec(targetHacknetScript, "home", 1, 4, 100, 8, 4);
      } else {
        ns.print(`⚡ [KERNEL] Starte unlimitiertes Hacknet-Subsystem...`);
        ns.exec(targetHacknetScript, "home", 1);
      }
    }
  }

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
    const baseEntryCapital =
      25_000_000_000 * (bnMults.FourSigmaMarketDataCost ?? 1.0);
    const tixApiThreshold =
      100_000_000 * (bnMults.FourSigmaMarketDataApiCost ?? 1.0);

    if (
      (homeMaxRam >= 128 && playerMoney >= baseEntryCapital) ||
      (hasTix &&
        ns.stock.purchase4SMarketDataTixApi() &&
        playerMoney >= tixApiThreshold)
    ) {
      ns.exec(scripts.trade, "home", 1);
    }
  }

  if (ns.fileExists("DarkscapeNavigator.exe", "home") && homeMaxRam >= 256) {
    if (!ns.isRunning(scripts.replicator, "home"))
      ns.exec(scripts.replicator, "home", 1);
    if (
      ns.fileExists(scripts.crawler, "home") &&
      !ns.isRunning(scripts.crawler, "home")
    ) {
      ns.exec(scripts.crawler, "home", 1);
    }
  }
}

// ======================================================================
// --- 🎯 TACTICAL MATHEMATISCHES RE-WEIGHTING ---
// ======================================================================
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

// ======================================================================
// --- 📊 OPERATIONAL OS DASHBOARD (UPGRADED) ---
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
  ns.print(
    `👑 BIT-OS SYS-KERNEL v2.1 - Units: ${rootCount}/${allNodes.length}`,
  );
  ns.print(`================================================`);

  // 🏎️ Cleaner Engine-Mode Output
  ns.print(`ENGINE-MODE : ${isFleetMode ? "DYNAMIC FLEET" : "BASIC LOOP"}`);

  // 📋 Anforderungs-Checkliste: Zeilenanzahl bleibt strukturell stabil
  if (!isFleetMode) {
    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    const homeMaxRam = ns.getServerMaxRam("home");
    const pServers = ns.cloud.getServerNames();
    const hasEligiblePServer = pServers.some(
      (s) => ns.getServerMaxRam(s) >= 64,
    );

    ns.print(` 📋 UNLOCK REQS FOR DYNAMIC FLEET:`);
    ns.print(`   [${hasFormulas ? "✅" : "❌"}] Formulas.exe`);
    ns.print(
      `   [${homeMaxRam >= 256 ? "✅" : "❌"}] Home RAM >= 256GB (${ns.format.ram(homeMaxRam)})`,
    );
    ns.print(
      `   [${hasEligiblePServer ? "✅" : "❌"}] Mind. 1x p-serv >= 64GB`,
    );
  }

  ns.print(`STRATEGIE   : ${state.strategy || "MONEY"}`);

  // 🎯 FIX: Statische Zeilenanzahl für die Ziele (verhindert das Springen!)
  if (isFleetMode) {
    ns.print(
      `PRIMÄRZIEL  : ${state.batcherTarget || "Warte auf Dispatcher..."} (BATCH)`,
    );
    ns.print(`SEKUNDÄRZIEL: ${bestTarget} (FLEET)`);
  } else {
    ns.print(`ZIEL-SERVER : ${bestTarget}`);
    ns.print(`BATCH-MODUS : INAKTIV (Basic Loop läuft)`); // Platzhalter, damit die Zeilenanzahl identisch bleibt
  }

  ns.print("------------------------------------------------");
  ns.print(
    `HACK-YIELD  : ${(bnMults.ServerMaxMoney * bnMults.ScriptHackMoneyGain * 100).toFixed(0)}% Effizienz`,
  );
  ns.print(
    `WEAKEN-RATE : ${(bnMults.ServerWeakenRate * 100).toFixed(0)}% Geschwindigkeit`,
  );
  ns.print(
    `GROWTH-RATE : ${((bnMults.ServerGrowthRate ?? 1.0) * 100).toFixed(0)}% Stärke`,
  );
  ns.print(`FRAKTION    : ${state.targetFaction || "KEINE"}`);

  // 📊 PROGRESS-Zeile bleibt immer sichtbar
  ns.print("------------------------------------------------");
  ns.print(`PROGRESS    : ${state.progressBar || "Initialisiere..."}`);
  ns.print(`================================================`);
}
