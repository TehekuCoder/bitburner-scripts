import { NS, GangMemberInfo, GangGenInfo } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";

export const GANG_CONFIG = {
  ASCEND_THRESHOLD: 1.2,
  WANTED_PENALTY_THRESHOLD: 0.95,
  TRAIN_STAT_TARGET: 150,

  // 💰 BUDGETING & RAM-SCHUTZ (Ohne Singularity)
  BUY_EQUIP_MONEY_BUFFER: 50, // Erst kaufen, wenn Item max. 2% des Vermögens kostet (statt 20%)
  TARGET_HOME_RAM: 512, // Ziel-RAM für Home

  // Warfare Settings
  WARFARE_WIN_THRESHOLD: 0.85,
  MIN_STAT_FOR_WARFARE: 500,
};

/**
 * Liest den HomeRAMCost-Multiplikator aus dem boot.ts-Cache (0 GB RAM Kosten).
 */
function getHomeRamMultiplier(ns: NS): number {
  try {
    const rawData = ns.read("/bn-multipliers.txt");
    if (!rawData) return 1.0;

    const mults = JSON.parse(rawData);
    return mults.HomeRAMCost ?? 1.0;
  } catch {
    return 1.0; // Fallback, falls Datei korrupt oder noch nicht geschrieben
  }
}

// Weitere Gang-Namen für den Gewinnchance-Check
const RIVAL_GANGS = [
  "Slum Snakes",
  "Tetrads",
  "Syndicate",
  "The Dark Army",
  "Speakers for the Dead",
  "NiteSec",
  "The Black Hand",
];

const GANG_NAMES: string[] = [
  "Papyrus",
  "Sans",
  "Undyne",
  "Alphys",
  "Mettaton",
  "Muffet",
  "Asgore",
  "Toriel",
  "Flowey",
  "Chara",
  "Frisk",
  "Gaster",
];

/**
 * Errechnet die exakten geschätzten Upgrade-Kosten unter Berücksichtigung des BitNodes.
 */
function getEstimatedNextHomeRamCost(ns: NS, currentRam: number): number {
  const BASE_RAM_COST_LOOKUP: Record<number, number> = {
    8: 11_000_000, // 8 -> 16 GB (~11M $ Basis)
    16: 32_000_000, // 16 -> 32 GB (~32M $ Basis)
    32: 92_000_000, // 32 -> 64 GB (~92M $ Basis)
    64: 265_000_000, // 64 -> 128 GB (~265M $ Basis)
    128: 760_000_000, // 128 -> 256 GB (~760M $ Basis)
    256: 2_190_000_000, // 256 -> 512 GB (~2.19B $ Basis)
  };

  const baseCost = BASE_RAM_COST_LOOKUP[currentRam] ?? currentRam * 8_500_000;
  const homeRamMultiplier = getHomeRamMultiplier(ns);

  // Skalierung mit dem BitNode-Multiplikator
  return baseCost * homeRamMultiplier;
}

/**
 * Gibt das maximale Budget pro Equipment-Teil basierend auf dem aktuellen Home-RAM zurück.
 * Verhindert den Kauf sündhaft teurer Augmentations bei niedrigem RAM.
 */
function getMaxEquipCostForRam(homeRam: number): number {
  if (homeRam < 32) return 1_000_000; // Max 1M $ pro Item
  if (homeRam < 64) return 3_000_000; // Max 3M $ pro Item
  if (homeRam < 128) return 10_000_000; // Max 10M $ pro Item
  if (homeRam < 256) return 25_000_000; // Max 25M $ pro Item
  if (homeRam < 512) return 50_000_000; // Max 50M $ pro Item
  return Infinity; // Ab 512 GB RAM: Unbegrenzt
}

export function manageGang(
  ns: NS,
  logger: Logger,
  addLocalLog: (msg: string) => void,
  isBatcherActive: boolean = false, // 👈 Neu
): {
  gangInfo: GangGenInfo;
  members: GangMemberInfo[];
  minWinChance: number;
} | null {
  if (!ns.gang.inGang()) {
    return null;
  }

  const gangInfo = ns.gang.getGangInformation();

  // 1. Rekrutierung
  handleRecruitment(ns, logger, addLocalLog);

  const memberNames = ns.gang.getMemberNames();
  const members = memberNames.map((name) => ns.gang.getMemberInformation(name));

  // 2. Ascension
  handleAscension(ns, members, gangInfo.isHacking, logger, addLocalLog);

  // 3. Equipment & Augmentations (mit Batcher-Flag)
  handleEquipment(ns, memberNames, logger, addLocalLog, isBatcherActive);

  // 4. Territory Warfare Logik
  const minWinChance = handleTerritoryWarfare(
    ns,
    gangInfo,
    logger,
    addLocalLog,
  );

  // 5. Task-Zuweisung
  handleTasks(ns, members, gangInfo, minWinChance);

  return { gangInfo, members, minWinChance };
}
/**
 * Steuert das An-/Ausschalten des Territory Clashs basierend auf der Gewinnchance.
 */
function handleTerritoryWarfare(
  ns: NS,
  gangInfo: GangGenInfo,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): number {
  // Wenn wir bereits 100% Territorium kontrollieren, deaktivieren wir Warfare zum Schutz
  if (gangInfo.territory >= 1.0) {
    if (gangInfo.territoryWarfareEngaged) {
      ns.gang.setTerritoryWarfare(false);
      const msg = "👑 100% Territorium erreicht! Warfare deaktiviert.";
      logger.success(msg);
      addLocalLog(msg);
    }
    return 1.0;
  }

  let minWinChance = 1.0;
  let otherGangsCount = 0;

  const allGangs = ns.gang.getAllGangInformation();
  const myGangFaction = ns.gang.getGangInformation().faction;

  for (const gangName in allGangs) {
    if (gangName === myGangFaction) continue; // Eigene Gang überspringen

    const rivalOtherInfo = allGangs[gangName];
    if (rivalOtherInfo && rivalOtherInfo.territory > 0) {
      const winChance = ns.gang.getChanceToWinClash(gangName);
      if (winChance < minWinChance) {
        minWinChance = winChance;
      }
      otherGangsCount++;
    }
  }

  // Keine Gegner mehr vorhanden
  if (otherGangsCount === 0) {
    if (gangInfo.territoryWarfareEngaged) ns.gang.setTerritoryWarfare(false);
    return 1.0;
  }

  // Clash aktivieren, wenn Gewinnchance über dem Schwellenwert liegt
  const shouldEngage = minWinChance >= GANG_CONFIG.WARFARE_WIN_THRESHOLD;

  if (shouldEngage && !gangInfo.territoryWarfareEngaged) {
    ns.gang.setTerritoryWarfare(true);
    const msg = `⚔️ Warfare AKTIVIERT (Min. Win-Chance: ${(minWinChance * 100).toFixed(1)}%)`;
    logger.warn(msg);
    addLocalLog(msg);
  } else if (!shouldEngage && gangInfo.territoryWarfareEngaged) {
    ns.gang.setTerritoryWarfare(false);
    const msg = `🛡️ Warfare DEAKTIVIERT (Min. Win-Chance zu gering: ${(minWinChance * 100).toFixed(1)}%)`;
    logger.info(msg);
    addLocalLog(msg);
  }

  return minWinChance;
}

function handleTasks(
  ns: NS,
  members: GangMemberInfo[],
  gangInfo: GangGenInfo,
  minWinChance: number,
): void {
  const isHacking = gangInfo.isHacking;
  const isMaxMembers = members.length >= 12;
  const isWantedPenHigh =
    gangInfo.wantedPenalty < GANG_CONFIG.WANTED_PENALTY_THRESHOLD &&
    gangInfo.wantedLevel > 1;

  const vigilanteCount = isWantedPenHigh ? Math.ceil(members.length * 0.3) : 0;

  // Wenn wir noch kein maximales Territorium haben und noch nicht sicher gewinnen,
  // stellen wir ab 12 Mitgliedern einen Teil für Power-Aufbau (Territory Warfare Task) ab.
  const needPower =
    isMaxMembers &&
    gangInfo.territory < 1.0 &&
    minWinChance < GANG_CONFIG.WARFARE_WIN_THRESHOLD;

  members.forEach((member, index) => {
    let targetTask = "";
    const primaryStat = isHacking
      ? member.hack
      : (member.str + member.def + member.dex + member.agi) / 4;

    if (index >= members.length - vigilanteCount) {
      targetTask = isHacking ? "Ethical Hacking" : "Vigilante Justice";
    } else if (primaryStat < GANG_CONFIG.TRAIN_STAT_TARGET) {
      targetTask = isHacking ? "Train Hacking" : "Train Combat";
    } else if (needPower && primaryStat >= GANG_CONFIG.MIN_STAT_FOR_WARFARE) {
      // Höhere Stats als Warfare-Trainer einteilen
      targetTask = "Territory Warfare";
    } else if (!isMaxMembers) {
      targetTask = getRespectTask(isHacking, primaryStat);
    } else {
      targetTask = getMoneyTask(isHacking, primaryStat);
    }

    if (member.task !== targetTask) {
      const success = ns.gang.setMemberTask(member.name, targetTask);
      if (!success) {
        ns.tprint(
          `⚠️ [GANG ERROR] Task '${targetTask}' konnte ${member.name} nicht zugewiesen werden!`,
        );
      }
    }
  });
}

function getRespectTask(isHacking: boolean, stat: number): string {
  if (isHacking) {
    if (stat < 300) return "Ransomware";
    if (stat < 600) return "Phishing";
    return "Cyberterrorism";
  } else {
    if (stat < 200) return "Mug People";
    if (stat < 500) return "Strongarm Civilians";
    return "Terrorism";
  }
}

function getMoneyTask(isHacking: boolean, stat: number): string {
  if (isHacking) {
    if (stat < 400) return "Phishing";
    return "Money Laundering";
  } else {
    if (stat < 300) return "Mug People";
    if (stat < 600) return "Deal Drugs"; // 👈 Korrigiert: "Deal Drugs" statt "Deals"
    return "Human Trafficking";
  }
}

function handleRecruitment(
  ns: NS,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  while (ns.gang.canRecruitMember()) {
    const existingMembers = ns.gang.getMemberNames();
    const nextName =
      GANG_NAMES.find((name) => !existingMembers.includes(name)) ??
      `Thug-${existingMembers.length + 1}`;

    if (ns.gang.recruitMember(nextName)) {
      const msg = `🟢 Neues Mitglied rekrutiert: ${nextName}`;
      logger.info(msg);
      addLocalLog(msg);
    } else {
      break;
    }
  }
}

function handleAscension(
  ns: NS,
  members: GangMemberInfo[],
  isHacking: boolean,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  for (const member of members) {
    const ascResult = ns.gang.getAscensionResult(member.name);
    if (!ascResult) continue;

    const gain = isHacking
      ? ascResult.hack
      : (ascResult.str + ascResult.def + ascResult.dex + ascResult.agi) / 4;

    if (gain >= GANG_CONFIG.ASCEND_THRESHOLD) {
      if (ns.gang.ascendMember(member.name)) {
        const bonus = ((gain - 1) * 100).toFixed(1);
        const msg = `📈 Ascension: ${member.name} (+${bonus}% Stat-Mult)`;
        logger.info(msg);
        addLocalLog(msg);
      }
    }
  }
}

export function handleEquipment(
  ns: NS,
  memberNames: string[],
  logger: Logger,
  addLocalLog: (msg: string) => void,
  isBatcherActive: boolean = false, // 👈 Neu
): void {
  const homeRam = ns.getServerMaxRam("home");
  const playerMoney = ns.getServerMoneyAvailable("home");

  // 🛡️ 1. SPARMODUS-SPERRE: Nur aktivieren, wenn KEIN Batcher läuft
  if (!isBatcherActive && homeRam < GANG_CONFIG.TARGET_HOME_RAM) {
    const nextRamCost = getEstimatedNextHomeRamCost(ns, homeRam);

    if (playerMoney >= nextRamCost * 0.4) {
      return;
    }
  }

  // Wenn der Batcher läuft, gibt es kein Limit pro Equip-Cost
  const maxAllowedEquipCost = isBatcherActive ? Infinity : getMaxEquipCostForRam(homeRam);
  const equipmentList = ns.gang.getEquipmentNames();

  for (const equip of equipmentList) {
    const cost = ns.gang.getEquipmentCost(equip);

    // 🛡️ 2. KOSTEN-DECKEL
    if (cost > maxAllowedEquipCost) {
      continue;
    }

    for (const name of memberNames) {
      const currentMoney = ns.getServerMoneyAvailable("home");

      // 🛡️ 3. PROZENTUALER BUFFER (Bei Batcher reicht 1x Kosten statt 50x Puffer)
      const requiredBuffer = isBatcherActive ? 1.0 : GANG_CONFIG.BUY_EQUIP_MONEY_BUFFER;
      if (currentMoney < cost * requiredBuffer) continue;

      const memberInfo = ns.gang.getMemberInformation(name);
      if (
        !memberInfo.upgrades.includes(equip) &&
        !memberInfo.augmentations.includes(equip)
      ) {
        if (ns.gang.purchaseEquipment(name, equip)) {
          const msg = `🛒 ${equip} gekauft für ${name} (${ns.format.number(cost, 2)}$)`;
          logger.success(msg);
          addLocalLog(msg);
        }
      }
    }
  }
}