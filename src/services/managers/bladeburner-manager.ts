import {
  NS,
  BladeburnerActionType,
  BladeburnerActionName,
  CityName,
  BladeburnerSkillName,
} from "@ns";
import { BLADEBURNER_SKILL_PRIORITIES } from "/shared/constants/bladeburner";

// Zentrale Konfiguration aller Schwellenwerte
const CONFIG = {
  STAMINA_RECOVERY_THRESHOLD: 0.5, // Unter 50% Stamina ➔ Regeneration
  STAMINA_FULL_THRESHOLD: 0.95, // Bis 95% Stamina regenerieren
  MIN_CHANCE_BLACKOP: 0.9, // Min. 90% Chance für BlackOps
  MIN_CHANCE_OPERATION: 0.8, // Min. 80% Chance für Operations
  MIN_CHANCE_CONTRACT_HIGH: 0.75, // Min. 75% Chance für Bounty Hunter / Retirement
  MIN_CHANCE_TRACKING: 0.65, // Min. 65% Chance für Tracking
  MAX_CHAOS: 20, // Ab 20 Chaos ➔ Stadtwechsel oder Diplomacy
};

const CITIES: CityName[] = [
  "Aevum",
  "Chongqing",
  "Sector-12",
  "New Tokyo",
  "Ishima",
  "Volhaven",
];

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  while (true) {
    // 🔴 1. Check: Bladeburner freigeschaltet / beigetreten?
    if (!ns.bladeburner.inBladeburner()) {
      const joined = ns.bladeburner.joinBladeburnerDivision();
      if (!joined) {
        ns.print("⏳ Warte auf ausreichende Combat-Stats zum Beitritt...");
        await ns.sleep(10000);
        continue;
      }
    }

    autoUpgradeSkills(ns);

    // 🟢 2. Stamina Management Check
    const [currentStamina, maxStamina] = ns.bladeburner.getStamina();
    const staminaRatio = maxStamina > 0 ? currentStamina / maxStamina : 0;
    const currentAction = ns.bladeburner.getCurrentAction();

    // Regenerationsphase aktiv
    if (
      currentAction?.name === "Hyperbolic Regeneration Chamber" &&
      staminaRatio < CONFIG.STAMINA_FULL_THRESHOLD
    ) {
      await sleepNextCycle(ns);
      continue;
    }

    // Stamina zu niedrig ➔ Hyperbolic Regeneration starten
    if (staminaRatio < CONFIG.STAMINA_RECOVERY_THRESHOLD) {
      if (currentAction?.name !== "Hyperbolic Regeneration Chamber") {
        setAction(ns, "General", "Hyperbolic Regeneration Chamber");
      }
      await sleepNextCycle(ns);
      continue;
    }

    // 🟢 3. Stadt- & Chaos-Management
    manageCityAndChaos(ns);

    // 🟢 4. Aktionsauswahl & Chaos-Erste-Hilfe
    const bestAction = findBestAction(ns);
    const currentCity = ns.bladeburner.getCity();
    const currentChaos = ns.bladeburner.getCityChaos(currentCity);

    if (bestAction) {
      if (currentAction?.name !== bestAction.name) {
        setAction(ns, bestAction.type, bestAction.name);
      }
    } else {
      // Fallback: Hohes Chaos mit Diplomacy senken oder Aufklären mit Field Analysis
      if (currentChaos > CONFIG.MAX_CHAOS) {
        if (currentAction?.name !== "Diplomacy") {
          setAction(ns, "General", "Diplomacy");
        }
      } else if (currentAction?.name !== "Field Analysis") {
        setAction(ns, "General", "Field Analysis");
      }
    }

    // Warten bis zur nächsten Evaluierung nach Ablauf des Zyklus
    await sleepNextCycle(ns);
  }
}

/**
 * Evaluiert die beste Aktion mit absteigender Wertigkeit und gestaffelten Chancen.
 */
function findBestAction(
  ns: NS,
): { type: BladeburnerActionType; name: BladeburnerActionName } | null {
  // 1. BlackOps prüfen
  const nextBlackOp = ns.bladeburner.getNextBlackOp();
  if (nextBlackOp && nextBlackOp.name) {
    const reqRank = ns.bladeburner.getBlackOpRank(nextBlackOp.name);
    if (ns.bladeburner.getRank() >= reqRank) {
      const [minChance, maxChance] =
        ns.bladeburner.getActionEstimatedSuccessChance(
          "Black Operations",
          nextBlackOp.name as BladeburnerActionName,
        );
      if ((minChance + maxChance) / 2 >= CONFIG.MIN_CHANCE_BLACKOP) {
        return {
          type: "Black Operations",
          name: nextBlackOp.name as BladeburnerActionName,
        };
      }
    }
  }

  // 2. Operations prüfen (von wertvoll zu einfach)
  const operations = ns.bladeburner.getOperationNames().slice().reverse();
  for (const op of operations) {
    if (ns.bladeburner.getActionCountRemaining("Operations", op) <= 0) continue;

    const actionName = op as BladeburnerActionName;
    const [minChance, maxChance] =
      ns.bladeburner.getActionEstimatedSuccessChance("Operations", actionName);
    const avgChance = (minChance + maxChance) / 2;

    if (avgChance >= CONFIG.MIN_CHANCE_OPERATION) {
      return { type: "Operations", name: actionName };
    }
  }

  // 3. Contracts prüfen (von wertvoll zu einfach)
  const contracts = ns.bladeburner.getContractNames().slice().reverse();
  for (const contract of contracts) {
    if (ns.bladeburner.getActionCountRemaining("Contracts", contract) <= 0)
      continue;

    const actionName = contract as BladeburnerActionName;
    const [minChance, maxChance] =
      ns.bladeburner.getActionEstimatedSuccessChance("Contracts", actionName);
    const avgChance = (minChance + maxChance) / 2;

    const reqChance =
      contract === "Tracking"
        ? CONFIG.MIN_CHANCE_TRACKING
        : CONFIG.MIN_CHANCE_CONTRACT_HIGH;

    if (avgChance >= reqChance) {
      return { type: "Contracts", name: actionName };
    }
  }

  return null;
}

/**
 * Bewertet alle Städte nach Synth-Population und Chaos und wechselt zur optimalen Stadt.
 */
function manageCityAndChaos(ns: NS): void {
  const currentCity = ns.bladeburner.getCity();
  const currentChaos = ns.bladeburner.getCityChaos(currentCity);
  const currentPop = ns.bladeburner.getCityEstimatedPopulation(currentCity);

  let bestCity: CityName = currentCity;
  let bestScore = calculateCityScore(currentPop, currentChaos);

  for (const city of CITIES) {
    if (city === currentCity) continue;

    const chaos = ns.bladeburner.getCityChaos(city);
    const pop = ns.bladeburner.getCityEstimatedPopulation(city);
    const score = calculateCityScore(pop, chaos);

    if (currentChaos > CONFIG.MAX_CHAOS || score > bestScore * 1.15) {
      bestScore = score;
      bestCity = city;
    }
  }

  if (bestCity !== currentCity) {
    ns.bladeburner.switchCity(bestCity);
    const newPop = ns.format.number(
      ns.bladeburner.getCityEstimatedPopulation(bestCity),
      1,
    );
    const newChaos = ns.bladeburner.getCityChaos(bestCity).toFixed(1);
    ns.print(
      `🌆 Stadt gewechselt: ${currentCity} ➔ ${bestCity} (Pop: ${newPop}, Chaos: ${newChaos})`,
    );
  }
}

function calculateCityScore(pop: number, chaos: number): number {
  if (pop <= 0) return 0;
  return pop / (chaos + 1);
}

function setAction(
  ns: NS,
  type: BladeburnerActionType,
  name: BladeburnerActionName,
): void {
  const success = ns.bladeburner.startAction(type, name);
  if (success) {
    ns.print(`▶️ Aktion gestartet: [${type}] ${name}`);
  }
}

/**
 * Wartet exakt die Dauer eines Aktionszyklus ab, damit danach im Haupt-Loop
 * die Erfolgschancen, Stamina und Stadt-Bedingungen neu bewertet werden.
 */
async function sleepNextCycle(ns: NS): Promise<void> {
  const current = ns.bladeburner.getCurrentAction();
  if (!current || current.type === "Idle") {
    await ns.sleep(1000);
    return;
  }

  const duration = ns.bladeburner.getActionTime(
    current.type as BladeburnerActionType,
    current.name as BladeburnerActionName,
  );

  // Mindestens 1 Sekunde Warten zur Absicherung
  await ns.sleep(Math.max(duration, 1000));
}

function autoUpgradeSkills(ns: NS): void {
  let availableSp = ns.bladeburner.getSkillPoints();
  if (availableSp <= 0) return;

  const nextBlackOp = ns.bladeburner.getNextBlackOp();
  let isBlackOpBlocked = false;

  if (nextBlackOp && nextBlackOp.name) {
    const reqRank = ns.bladeburner.getBlackOpRank(nextBlackOp.name);
    if (ns.bladeburner.getRank() >= reqRank) {
      const [minChance, maxChance] =
        ns.bladeburner.getActionEstimatedSuccessChance(
          "Black Operations",
          nextBlackOp.name as BladeburnerActionName,
        );
      if ((minChance + maxChance) / 2 < CONFIG.MIN_CHANCE_BLACKOP) {
        isBlackOpBlocked = true;
      }
    }
  }

  const BLACKOP_BOOST_SKILLS: BladeburnerSkillName[] = [
    "Blade's Intuition",
    "Digital Observer",
    "Reaper",
    "Evasive System",
  ];

  while (availableSp > 0) {
    let bestSkill: BladeburnerSkillName | null = null;
    let bestScore = -1;
    let bestCost = Infinity;

    for (const item of BLADEBURNER_SKILL_PRIORITIES) {
      const skillName = item.name as BladeburnerSkillName;

      if (isBlackOpBlocked && !BLACKOP_BOOST_SKILLS.includes(skillName)) {
        continue;
      }

      const currentLevel = ns.bladeburner.getSkillLevel(skillName);
      if (item.maxLevel && currentLevel >= item.maxLevel) continue;

      const cost = ns.bladeburner.getSkillUpgradeCost(skillName);
      if (cost <= 0 || cost > availableSp) continue;

      const score = Math.pow(item.weight, 2) / cost;

      if (score > bestScore) {
        bestScore = score;
        bestSkill = skillName;
        bestCost = cost;
      }
    }

    if (!bestSkill) break;

    if (ns.bladeburner.upgradeSkill(bestSkill, 1)) {
      const newLevel = ns.bladeburner.getSkillLevel(bestSkill);
      const tag = isBlackOpBlocked ? " 🎯 [BlackOp Push]" : "";
      ns.print(
        `🆙 Skill aufgerüstet${tag}: ${bestSkill} (Lvl ${newLevel}) [-${bestCost} SP]`,
      );
      availableSp -= bestCost;
    } else {
      break;
    }
  }
}
