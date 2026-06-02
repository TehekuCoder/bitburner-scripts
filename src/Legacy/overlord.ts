import { NS, Player, Server } from "@ns";

// --- INTERFACES ---
interface ScriptList {
  worker: string;
  puppet: string;
  backdoor: string;
  xpfarm: string;
  trade: string;
  hacknet: string;
}

interface BotState {
  strategy: string;
  target?: string;
  faction: string | null;
  progressBar?: string; // Korrektur: Passend zum Puppetmaster
}

export async function main(ns: NS): Promise<void> {
  const scripts: ScriptList = {
    worker: "work.js",
    puppet: "puppetmaster.js",
    backdoor: "auto-backdoor-pro.js",
    xpfarm: "xp-farm.js",
    trade: "trading-bot.js",
    hacknet: "hacknet.js",
  };

  ns.disableLog("ALL");
  ns.ui.openTail();

  // --- 1. DARKNET-SUBSYSTEM START ---
  if (ns.fileExists("DarkscapeNavigator.exe", "home")) {
    if (!ns.scriptRunning("simple-darknet-replicator.js", "home")) {
      ns.tprint("🌐 DarkscapeNavigator erkannt. Starte Darknet-Subsystem...");
      ns.run("simple-darknet-replicator.js");
    }
  }

  while (true) {
    // Standard-State falls Datei fehlt
    let state: BotState = { strategy: "MONEY", faction: null };

    if (ns.fileExists("bitos_state.txt")) {
      const content = ns.read("bitos_state.txt");
      try {
        if (content) state = JSON.parse(content) as BotState;
      } catch {
        /* JSON korrupt, behalte Default */
      }
    }

    const player: Player = ns.getPlayer();
    const allNodes: string[] = scanNetwork(ns);
    const bestTarget: string = findBestTarget(ns, allNodes, player);

    // --- SUBSYSTEME STARTEN ---
    manageSuites(ns, scripts, state);

    // Puppetmaster sicherstellen
    if (
      ns.fileExists(scripts.puppet, "home") &&
      !ns.isRunning(scripts.puppet, "home")
    ) {
      ns.exec(scripts.puppet, "home", 1);
    }

    // --- WORKER DEPLOYMENT ---
    for (const node of allNodes) {
      if (node !== "home") autoInfect(ns, node);

      if (ns.hasRootAccess(node)) {
        // Logik-Korrektur: Home nutzt im REP-Modus RAM für Share-Skripte via fill-ram.js
        if (node === "home" && state.strategy === "REP") continue;

        const activeScript =
          state.strategy === "XP_SPRINT" ? scripts.xpfarm : scripts.worker;

        // Dynamischer Puffer: 10% oder maximal 64GB, aber nur wenn wir genug RAM haben
        const homeMax = ns.getServerMaxRam("home");
        const ramBuffer = node === "home" ? Math.min(homeMax * 0.1, 64) : 0;

        deployWorker(ns, node, activeScript, bestTarget, ramBuffer);
      }
    }

    drawOverlordDashboard(ns, state, bestTarget, allNodes);
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
    ) {
      continue;
    }
    
    if (!ns.hasRootAccess(node)) continue;

    const srv = ns.getServer(node) as Server;

    if (!srv.moneyMax || srv.moneyMax <= 0) continue;

    const reqSkill = srv.requiredHackingSkill || 0;

    // 1. Harter Filter: Nur was wir auch hacken KÖNNEN
    if (reqSkill > player.skills.hacking) continue;

    // 2. Zeit-Analyse
    const cycleTime = ns.getWeakenTime(node);

    // Wenn ein Server aktuell länger als 5 Minuten braucht, im Mid-Game ignorieren
    if (cycleTime > 5 * 60 * 1000) continue;

    // 3. Reines Geld-Zeit-Verhältnis (Mid-Game-Sweetspot)
    // Wir nehmen das maximale Geld und teilen es durch die Zykluszeit in Sekunden.
    // Um extrem schwache Server (wie foodnstuff) abzustrafen, multiplizieren wir mit 
    // dem benötigten Skill – denn höhere Server geben exponentiell mehr XP und lohnen sich bei viel RAM.
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
  // Falls das Skript nicht existiert, brauchen wir gar nicht erst RAM prüfen
  if (!ns.fileExists(scriptFilename, "home")) return;

  const scriptCost = ns.getScriptRam(scriptFilename);
  const maxRam = ns.getServerMaxRam(targetNode);
  const usedRam = ns.getServerUsedRam(targetNode);
  let freedRam = 0;
  const procs = ns.ps(targetNode);
  for (const p of procs) {
    if (
      (p.filename === "work.js" || p.filename === "xp-farm.js") &&
      (p.filename !== scriptFilename || p.args[0] !== hackTarget)
    ) {
      ns.kill(p.pid);
      freedRam += ns.getScriptRam(p.filename, targetNode) * p.threads;
    }
  }

  // Jetzt haben wir den ECHTEN freien RAM für diesen Durchlauf
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

  // 1. Backdoor (Immer wenn möglich)
  if (
    ns.fileExists(scripts.backdoor) &&
    !ns.isRunning(scripts.backdoor, "home")
  ) {
    ns.exec(scripts.backdoor, "home");
  }

  // 2. Trading (Erst ab 128GB RAM und 25b Geld)
  if (ns.fileExists(scripts.trade) && !ns.isRunning(scripts.trade, "home")) {
    if (
      (homeMaxRam >= 128 && playerMoney >= 25_000_000_000) ||
      (ns.stock.purchase4SMarketDataTixApi() && playerMoney >= 100_000_000)
    )
      ns.exec(scripts.trade, "home");
  }

  // 3. Hacknet
  if (
    ns.fileExists("Formulas.exe") &&
    ns.fileExists(scripts.hacknet) &&
    !ns.isRunning(scripts.hacknet, "home")
  ) {
    ns.exec(scripts.hacknet, "home");
  }

  // 4. Rep-Farming (Widerspruch korrigiert: "REP" statt "REP_FARM")
  if (state.strategy === "REP") {
    if (
      ns.fileExists("fill-ram.js", "home") &&
      !ns.isRunning("fill-ram.js", "home")
    ) {
      ns.exec("fill-ram.js", "home");
    }
  } else {
    // Stoppe Rep-Farming wenn Strategie wechselt
    if (ns.scriptRunning("fill-ram.js", "home"))
      ns.scriptKill("fill-ram.js", "home");
    ns.ps("home").forEach((p) => {
      if (p.filename === "share.js") ns.kill(p.pid);
    });
  }
}

// Hilfsfunktion für den Netzwerkscan
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

function drawOverlordDashboard(
  ns: NS,
  state: BotState,
  bestTarget: string,
  allNodes: string[],
): void {
  ns.clearLog();
  const rootCount = allNodes.filter((n) => ns.hasRootAccess(n)).length;
  ns.print(`========================================`);
  ns.print(`👑 BIT-OS OVERLORD - Units: ${rootCount}/${allNodes.length}`);
  ns.print(`========================================`);
  ns.print(`STRATEGIE:  ${state.strategy}`);
  ns.print(`ZIEL:       ${bestTarget}`);
  if (state.faction) {
    ns.print(`----------------------------------------`);
    ns.print(`FRAKTION:   ${state.faction}`);
    ns.print(`PROGRESS:   ${state.progressBar || "Lädt..."}`);
  }
  ns.print(`========================================`);
}
