// services/managers/bladeburner-manager.ts
import {
  NS,
  BladeburnerActionType,
  BladeburnerActionName,
  CityName,
} from "@ns";
import { BLADEBURNER_SKILL_PRIORITIES } from "/shared/constants/bladeburner";

// Schwellenwerte für Entscheidungslogik
const STAMINA_RECOVERY_THRESHOLD = 0.5; // Unter 50% Stamina ➔ Regeneration
const STAMINA_FULL_THRESHOLD = 0.95; // Bis 95% Stamina regenerieren
const MIN_SUCCESS_CHANCE = 0.85; // Min. 85% durchschnittliche Chance für Aktionen
const BLACKOP_SUCCESS_CHANCE = 0.9; // Min. 90% Chance für BlackOps

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

    // Wenn wir uns gerade in der Regenerationsphase befinden
    if (
      currentAction?.name === "Hyperbolic Regeneration Chamber" &&
      staminaRatio < STAMINA_FULL_THRESHOLD
    ) {
      await sleepNextCycle(ns);
      continue;
    }

    // Stamina zu niedrig ➔ Hyperbolic Regeneration starten
    if (staminaRatio < STAMINA_RECOVERY_THRESHOLD) {
      if (currentAction?.name !== "Hyperbolic Regeneration Chamber") {
        setAction(ns, "General", "Hyperbolic Regeneration Chamber");
      }
      await sleepNextCycle(ns);
      continue;
    }

    // 🟢 3. Stadt- & Chaos-Management (wechselt auch, wenn Stadt leergemacht wurde)
    manageCityAndChaos(ns);

    // 🟢 4. Aktionsauswahl (Priorität: BlackOps > Operations > Contracts > Field Analysis)
    const bestAction = findBestAction(ns);
    if (bestAction) {
      if (currentAction?.name !== bestAction.name) {
        setAction(ns, bestAction.type, bestAction.name);
      }
    } else {
      // Fallback: Field Analysis nur starten, wenn es nicht bereits läuft
      if (currentAction?.name !== "Field Analysis") {
        setAction(ns, "General", "Field Analysis");
      }
    }

    await sleepNextCycle(ns);
  }
}

/**
 * Findet die beste verfügbare Aktion basierend auf Durchschnittschance und Priorität.
 */
function findBestAction(
  ns: NS,
): { type: BladeburnerActionType; name: string } | null {
  // 1. BlackOps prüfen
  const nextBlackOp = ns.bladeburner.getNextBlackOp();
  if (nextBlackOp && nextBlackOp.name) {
    const reqRank = ns.bladeburner.getBlackOpRank(nextBlackOp.name);
    const currentRank = ns.bladeburner.getRank();

    if (currentRank >= reqRank) {
      const blackOpType = "BlackOp" as BladeburnerActionType;
      const [minChance, maxChance] =
        ns.bladeburner.getActionEstimatedSuccessChance(
          blackOpType,
          nextBlackOp.name as BladeburnerActionName,
        );
      if ((minChance + maxChance) / 2 >= BLACKOP_SUCCESS_CHANCE) {
        return { type: blackOpType, name: nextBlackOp.name };
      }
    }
  }

  // 2. Operations prüfen (Durchschnittschance nutzen)
  const operations = ns.bladeburner.getOperationNames();
  for (const op of operations) {
    const count = ns.bladeburner.getActionCountRemaining("Operations", op);
    if (count <= 0) continue;

    const [minChance, maxChance] =
      ns.bladeburner.getActionEstimatedSuccessChance(
        "Operations",
        op as BladeburnerActionName,
      );
    const avgChance = (minChance + maxChance) / 2;
    if (avgChance >= MIN_SUCCESS_CHANCE) {
      return { type: "Operations", name: op };
    }
  }

  // 3. Contracts prüfen (Durchschnittschance nutzen)
  const contracts = ns.bladeburner.getContractNames();
  for (const contract of contracts) {
    const count = ns.bladeburner.getActionCountRemaining("Contracts", contract);
    if (count <= 0) continue;

    const [minChance, maxChance] =
      ns.bladeburner.getActionEstimatedSuccessChance(
        "Contracts",
        contract as BladeburnerActionName,
      );
    const avgChance = (minChance + maxChance) / 2;
    if (avgChance >= MIN_SUCCESS_CHANCE) {
      return { type: "Contracts", name: contract };
    }
  }

  return null;
}

/**
 * Überprüft Chaos in Städten UND wechselt die Stadt, falls in der aktuellen Stadt keine Aktionen übrig sind.
 */
function manageCityAndChaos(ns: NS): void {
  const currentCity = ns.bladeburner.getCity();
  const currentChaos = ns.bladeburner.getCityChaos(currentCity);

  // 1. Priorität: Chaos reduzieren (> 50)
  if (currentChaos > 50) {
    let bestCity: CityName = currentCity;
    let lowestChaos = currentChaos;

    for (const city of CITIES) {
      const chaos = ns.bladeburner.getCityChaos(city);
      if (chaos < lowestChaos) {
        lowestChaos = chaos;
        bestCity = city;
      }
    }

    if (bestCity !== currentCity) {
      ns.bladeburner.switchCity(bestCity);
      ns.print(
        `🌆 Stadt gewechselt nach ${bestCity} (Chaos zu hoch: ${lowestChaos.toFixed(1)})`,
      );
      return;
    }
  }

  // 2. Priorität: Wechseln, wenn in der aktuellen Stadt alle Verträge/Operationen 0 sind
  if (!hasAvailableActionsInCity(ns)) {
    for (const city of CITIES) {
      if (city === currentCity) continue;
      ns.bladeburner.switchCity(city);
      if (hasAvailableActionsInCity(ns)) {
        ns.print(
          `🌆 Stadt gewechselt nach ${city} (Keine Verträge mehr in vorheriger Stadt)`,
        );
        return;
      }
    }
    // Falls nirgendwo Verträge frei sind, zurück in Ausgangsstadt
    ns.bladeburner.switchCity(currentCity);
  }
}

/**
 * Hilfsfunktion: Prüft, ob in der aktuellen Stadt noch Verträge/Operationen übrig sind.
 */
function hasAvailableActionsInCity(ns: NS): boolean {
  const contracts = ns.bladeburner.getContractNames();
  for (const c of contracts) {
    if (ns.bladeburner.getActionCountRemaining("Contracts", c) > 0) return true;
  }
  const operations = ns.bladeburner.getOperationNames();
  for (const op of operations) {
    if (ns.bladeburner.getActionCountRemaining("Operations", op) > 0)
      return true;
  }
  return false;
}

/**
 * Helper zum Starten einer Aktion mit Logging.
 */
function setAction(ns: NS, type: BladeburnerActionType, name: string): void {
  const success = ns.bladeburner.startAction(
    type,
    name as BladeburnerActionName,
  );
  if (success) {
    ns.print(`▶️ Aktion gestartet: [${type}] ${name}`);
  }
}

/**
 * Pollt dynamisch in kurzen Abständen (200ms), bis die aktuelle Aktion fertig ist.
 * Funktioniert perfekt mit Bonus Time, Overclock & normalen Geschwindigkeiten!
 */
async function sleepNextCycle(ns: NS): Promise<void> {
  const initialAction = ns.bladeburner.getCurrentAction();
  if (!initialAction || initialAction.type === "Idle") {
    await ns.sleep(200);
    return;
  }

  while (true) {
    await ns.sleep(200);
    const current = ns.bladeburner.getCurrentAction();
    if (
      !current ||
      current.type === "Idle" ||
      current.name !== initialAction.name
    ) {
      break;
    }
  }
}

function autoUpgradeSkills(ns: NS): void {
  let availableSp = ns.bladeburner.getSkillPoints();
  if (availableSp <= 0) return;

  for (const item of BLADEBURNER_SKILL_PRIORITIES) {
    if (availableSp <= 0) break;
    const currentLevel = ns.bladeburner.getSkillLevel(item.name);
    if (item.maxLevel && currentLevel >= item.maxLevel) continue;

    const cost = ns.bladeburner.getSkillUpgradeCost(item.name);
    if (cost > 0 && availableSp >= cost) {
      if (ns.bladeburner.upgradeSkill(item.name, 1)) {
        ns.print(
          `🆙 Skill aufgerüstet: ${item.name} (Lvl ${currentLevel + 1})`,
        );
        availableSp -= cost;
      }
    }
  }
}
