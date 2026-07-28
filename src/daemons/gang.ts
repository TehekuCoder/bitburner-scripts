import { NS, GangMemberInfo, GangGenInfo } from "@ns";

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  // Mindest-Multiplikator-Gewinn für Ascension (1.20 = 20% Stat-Bonus)
  ASCEND_THRESHOLD: 1.20,
  
  // Ab welcher Wanted Penalty gegengesteuert wird (0.95 = 5% Ertragsverlust)
  WANTED_PENALTY_THRESHOLD: 0.95,

  // Bis zu welchem Stat-Wert Mitglieder im Training bleiben
  TRAIN_STAT_TARGET: 150,

  // Sicherheits-Faktor für Geld: Kauft Ausrüstung erst, wenn Geld >= Item-Preis * MULTIPLIER
  BUY_EQUIP_MONEY_BUFFER: 5,

  // Loop-Intervall in Millisekunden
  LOOP_DELAY_MS: 5000,
};

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (!ns.gang.inGang()) {
    ns.tprint("🛑 [GANG] Du bist derzeit in keiner Gang! Daemon beendet.");
    return;
  }

  ns.tprint("🚀 [GANG] Gang-Daemon erfolgreich gestartet.");

  while (true) {
    const gangInfo = ns.gang.getGangInformation();
    
    // 1. Rekrutierung neuer Mitglieder
    handleRecruitment(ns);

    const memberNames = ns.gang.getMemberNames();
    const members = memberNames.map((name) => ns.gang.getMemberInformation(name));

    // 2. Automatisches Ascenden
    handleAscension(ns, members, gangInfo.isHacking);

    // 3. Automatischer Ausrüstungs- & Augmentation-Kauf
    handleEquipment(ns, memberNames);

    // 4. Intelligente Task-Zuweisung
    handleTasks(ns, members, gangInfo);

    await ns.sleep(CONFIG.LOOP_DELAY_MS);
  }
}

/**
 * Rekrutiert automatisch neue Mitglieder, sobald Plätze frei werden.
 */
// 12 festgelegte Namen für die maximal 12 Gang-Slots
const GANG_NAMES: string[] = [
  "Papyrus",   // Slot 1
  "Sans",      // Slot 2
  "Undyne",    // Slot 3
  "Alphys",    // Slot 4
  "Mettaton",  // Slot 5
  "Muffet",    // Slot 6
  "Asgore",    // Slot 7
  "Toriel",    // Slot 8
  "Flowey",    // Slot 9
  "Chara",     // Slot 10
  "Frisk",     // Slot 11
  "Gaster",    // Slot 12
];

function handleRecruitment(ns: NS): void {
  while (ns.gang.canRecruitMember()) {
    const existingMembers = ns.gang.getMemberNames();

    // Findet den ersten Namen aus der Liste, der noch nicht vergeben ist
    const nextName =
      GANG_NAMES.find((name) => !existingMembers.includes(name)) ??
      `Thug-${existingMembers.length + 1}`; // Fallback, falls die Liste zu kurz wäre

    if (ns.gang.recruitMember(nextName)) {
      ns.print(`[GANG] 🟢 Neues Mitglied rekrutiert: ${nextName}`);
    } else {
      break; // Abbrechen, falls das Rekrutieren fehlschlägt
    }
  }
}

/**
 * Ascendet Mitglieder, sobald der Stat-Multiplikator die Schwelle erreicht.
 */
function handleAscension(ns: NS, members: GangMemberInfo[], isHacking: boolean): void {
  for (const member of members) {
    const ascResult = ns.gang.getAscensionResult(member.name);
    if (!ascResult) continue;

    // Berechnung des relevanten Multiplikator-Gewinns
    const gain = isHacking
      ? ascResult.hack
      : (ascResult.str + ascResult.def + ascResult.dex + ascResult.agi) / 4;

    if (gain >= CONFIG.ASCEND_THRESHOLD) {
      if (ns.gang.ascendMember(member.name)) {
        ns.print(
          `[GANG] 📈 Ascension für ${member.name} durchgeführt (Multiplikator +${((gain - 1) * 100).toFixed(1)}%)`
        );
      }
    }
  }
}

/**
 * Kauft Ausrüstung und Bionic Upgrades, sofern genug Geld vorhanden ist.
 */
function handleEquipment(ns: NS, memberNames: string[]): void {
  const equipmentList = ns.gang.getEquipmentNames();
  const playerMoney = ns.getServerMoneyAvailable("home");

  for (const equip of equipmentList) {
    const cost = ns.gang.getEquipmentCost(equip);

    // Sicherheits-Check: Nur kaufen, wenn wir ein Vielfaches des Preises besitzen
    if (playerMoney < cost * CONFIG.BUY_EQUIP_MONEY_BUFFER) continue;

    for (const name of memberNames) {
      const memberInfo = ns.gang.getMemberInformation(name);
      // Prlocation check: Besitzt das Mitglied dieses Equipment bereits?
      if (!memberInfo.upgrades.includes(equip) && !memberInfo.augmentations.includes(equip)) {
        if (ns.gang.purchaseEquipment(name, equip)) {
          ns.print(`[GANG] 🛒 ${equip} gekauft für ${name}`);
        }
      }
    }
  }
}

/**
 * Verteilt Aufgaben basierend auf Stats, Wanted Level und Gang-Fortschritt.
 */
function handleTasks(ns: NS, members: GangMemberInfo[], gangInfo: GangGenInfo): void {
  const isHacking = gangInfo.isHacking;
  const isMaxMembers = members.length >= 12;
  const isWantedPenHigh = gangInfo.wantedPenalty < CONFIG.WANTED_PENALTY_THRESHOLD && gangInfo.wantedLevel > 1;

  // Bestimme, wie viele Mitglieder für die Reduzierung des Wanted Levels abgestellt werden
  const vigilanteCount = isWantedPenHigh ? Math.ceil(members.length * 0.3) : 0;

  members.forEach((member, index) => {
    let targetTask = "";

    const primaryStat = isHacking
      ? member.hack
      : (member.str + member.def + member.dex + member.agi) / 4;

    // PRIO 1: Wanted Level Senkung (letzte 'vigilanteCount' Mitglieder)
    if (index >= members.length - vigilanteCount) {
      targetTask = isHacking ? "Ethical Hacking" : "Vigilante Justice";
    }
    // PRIO 2: Stats trainieren, wenn Stat-Schwelle noch nicht erreicht
    else if (primaryStat < CONFIG.TRAIN_STAT_TARGET) {
      targetTask = isHacking ? "Train Hacking" : "Train Combat";
    }
    // PRIO 3: Respect farmen (solange noch keine 12 Mitglieder vorhanden sind)
    else if (!isMaxMembers) {
      targetTask = getRespectTask(isHacking, primaryStat);
    }
    // PRIO 4: Geld verdienen (bei vollem Team)
    else {
      targetTask = getMoneyTask(isHacking, primaryStat);
    }

    // Task nur ändern, wenn sie abweicht (vermeidet unnötigen Overhead)
    if (member.task !== targetTask) {
      ns.gang.setMemberTask(member.name, targetTask);
    }
  });
}

/**
 * Liefert die optimale Respect-Task basierend auf dem Stat-Level.
 */
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

/**
 * Liefert die optimale Money-Task basierend auf dem Stat-Level.
 */
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