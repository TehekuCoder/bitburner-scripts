import { NS } from '@ns';

// Typ-Definitionen für State & Hash-Upgrades
interface TargetSummary {
  target: string;
  moneyMax: number;
  moneyAvailable: number;
  minDifficulty: number;
  hackDifficulty: number;
}

interface BatcherState {
  batcherTargetsSummary?: TargetSummary[];
}

// Gültige Hacknet Server Hash-Upgrades in Bitburner
type HashUpgradeName =
  | 'Sell for Money'
  | 'Sell for Corporation Funds'
  | 'Reduce Minimum Security'
  | 'Increase Maximum Money'
  | 'Improve Studying'
  | 'Improve Gym Training'
  | 'Exchange for Corporation Research'
  | 'Exchange for Bladeburner Rank'
  | 'Exchange for Bladeburner SP'
  | 'Generate Coding Contract';

interface UpgradePriority {
  name: HashUpgradeName;
  /** Legt fest, ob dieses Upgrade einen Zielserver (Hostnamestring) benötigt */
  requiresTarget?: boolean;
  /** Max. Level, bis zu dem gekauft werden soll (optional, undefined = unbegrenzt) */
  maxLevel?: number;
  /** Mindest-Hashes, die auf Reserve bleiben müssen (optional) */
  minReserveHashes?: number;
}

const STATE_FILE = 'batcher_state.json';

/**
 * Liest den aktuellen Zustand des Batchers ein.
 */
function loadBatcherState(ns: NS): BatcherState | null {
  if (!ns.fileExists(STATE_FILE)) return null;
  try {
    return JSON.parse(ns.read(STATE_FILE)) as BatcherState;
  } catch {
    return null;
  }
}

/**
 * Ermittelt den wertvollsten Zielserver im gesamten Netzwerk als Fallback.
 * Ignoriert Hacknet-Server, um Runtime-Errors zu vermeiden.
 */
function getHighestValueServer(ns: NS): string | null {
  const visited = new Set<string>(['home']);
  const queue: string[] = ['home'];
  let maxMoney = 0;
  let bestServer: string | null = null;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = ns.scan(current);

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);

      // 🛑 Hacknet-Server filtern (keine Geld-/Hacking-Operationen erlaubt)
      if (neighbor.startsWith('hacknet-server') || neighbor.startsWith('hacknet-node')) {
        continue;
      }

      if (ns.hasRootAccess(neighbor)) {
        const money = ns.getServerMaxMoney(neighbor);
        if (money > maxMoney) {
          maxMoney = money;
          bestServer = neighbor;
        }
      }
    }
  }
  return bestServer;
}
/**
 * Holt alle aktiven Targets des Batchers oder liefert einen Fallback-Server.
 */
function getActiveBatcherTargets(ns: NS): string[] {
  const batcherState = loadBatcherState(ns);

  if (
    batcherState?.batcherTargetsSummary &&
    batcherState.batcherTargetsSummary.length > 0
  ) {
    return batcherState.batcherTargetsSummary.map(
      (t: TargetSummary) => t.target,
    );
  }

  const fallback = getHighestValueServer(ns);
  return fallback ? [fallback] : [];
}

/**
 * Versucht ein bestimmtes Upgrade auszuführen.
 * Verwertet getActiveBatcherTargets für target-basierte Upgrades.
 */
function trySpendHashes(
  ns: NS,
  upgrade: UpgradePriority,
  targets: string[],
): boolean {
  const currentHashes = ns.hacknet.numHashes();
  const reserve = upgrade.minReserveHashes ?? 0;

  if (currentHashes <= reserve) return false;

  // Prüfen, ob maxLevel erreicht ist
  if (upgrade.maxLevel !== undefined) {
    const currentLevel = ns.hacknet.getHashUpgradeLevel(upgrade.name);
    if (currentLevel >= upgrade.maxLevel) return false;
  }

  const cost = ns.hacknet.hashCost(upgrade.name);
  if (currentHashes < cost) return false;

  // Target-basierte Upgrades (Reduce Min Sec / Increase Max Money)
  if (upgrade.requiresTarget) {
    for (const target of targets) {
      if (ns.hacknet.spendHashes(upgrade.name, target)) {
        ns.print(`[HashManager] Upgrade gekauft: ${upgrade.name} -> ${target}`);
        return true;
      }
    }
    return false;
  }

  // Globale Upgrades ohne Target (Studying, Gym, Corp, Bladeburner, Contracts, Money)
  if (ns.hacknet.spendHashes(upgrade.name)) {
    ns.print(`[HashManager] Upgrade gekauft: ${upgrade.name}`);
    return true;
  }

  return false;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog('ALL');
  ns.ui.openTail();

  // Konfiguration der Prioritäten (obenstehende Einträge werden zuerst gekauft)
  const priorityList: UpgradePriority[] = [
    // 1. Coding Contracts generieren, falls möglich
    { name: 'Generate Coding Contract' },

    // 2. Zielserver des Batchers buffen (Geld vergrößern & Sec senken)
    { name: 'Increase Maximum Money', requiresTarget: true },
    { name: 'Reduce Minimum Security', requiresTarget: true },

    // 3. Faction/Char-Booster (z. B. für Infiltration, Singularity, Stats)
    { name: 'Improve Studying' },
    { name: 'Improve Gym Training' },

    // 4. Endgame / Faction Mechanics (auskommentieren/anpassen je nach BitNode)
    // { name: 'Exchange for Corporation Research' },
    // { name: 'Exchange for Bladeburner Rank' },
    // { name: 'Exchange for Bladeburner SP' },

    // 5. Overflow / Liquiditäts-Fallback
    { name: 'Sell for Money' },
  ];

  ns.print('[HashManager] Gestartet.');

  while (true) {
    const capacity = ns.hacknet.hashCapacity();
    const currentHashes = ns.hacknet.numHashes();
    const activeTargets = getActiveBatcherTargets(ns);

    // Hashes ausgeben, wenn wir uns dem Maximum (z. B. >= 80%) nähern
    if (currentHashes >= capacity * 0.8) {
      for (const upgrade of priorityList) {
        // Solange kaufen, wie wir Hashes für diese Prioritätsstufe haben
        while (trySpendHashes(ns, upgrade, activeTargets)) {
          await ns.sleep(20);
        }
      }
    }

    await ns.sleep(2000);
  }
}