import { NS, GangMemberInfo, GangGenInfo } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";

export const GANG_CONFIG = {
  ASCEND_THRESHOLD: 1.2,
  WANTED_PENALTY_THRESHOLD: 0.95,
  TRAIN_STAT_TARGET: 150,
  BUY_EQUIP_MONEY_BUFFER: 5,
  // Warfare Settings
  WARFARE_WIN_THRESHOLD: 0.85, // Erst ab 85% Gewinnchance Clash aktivieren
  MIN_STAT_FOR_WARFARE: 500,
};

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

export function manageGang(
  ns: NS,
  logger: Logger,
  addLocalLog: (msg: string) => void,
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

  // 3. Equipment & Augmentations
  handleEquipment(ns, memberNames, logger, addLocalLog);

  // 4. Territory Warfare Logik
  const minWinChance = handleTerritoryWarfare(
    ns,
    gangInfo,
    logger,
    addLocalLog,
  );

  // 5. Task-Zuweisung (inkl. Warfare-Unterstützung)
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
      ns.gang.setMemberTask(member.name, targetTask);
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
    if (stat < 600) return "Deals";
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

function handleEquipment(
  ns: NS,
  memberNames: string[],
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  const equipmentList = ns.gang.getEquipmentNames();

  for (const equip of equipmentList) {
    const cost = ns.gang.getEquipmentCost(equip);

    for (const name of memberNames) {
      // Geld direkt vor dem Kauf abfragen:
      const playerMoney = ns.getServerMoneyAvailable("home");
      if (playerMoney < cost * GANG_CONFIG.BUY_EQUIP_MONEY_BUFFER) continue;

      const memberInfo = ns.gang.getMemberInformation(name);
      if (
        !memberInfo.upgrades.includes(equip) &&
        !memberInfo.augmentations.includes(equip)
      ) {
        if (ns.gang.purchaseEquipment(name, equip)) {
          const msg = `🛒 ${equip} gekauft für ${name}`;
          logger.success(msg);
          addLocalLog(msg);
        }
      }
    }
  }
}