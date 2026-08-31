// services/managers/bladeburner-manager.ts
import {
  NS,
  BladeburnerActionType,
  BladeburnerActionName,
  CityName,
} from "@ns";

// Schwellenwerte für Entscheidungslogik
const STAMINA_RECOVERY_THRESHOLD = 0.5; // Unter 50% Stamina ➔ Regeneration
const STAMINA_FULL_THRESHOLD = 0.95; // Bis 95% Stamina regenerieren
const MIN_SUCCESS_CHANCE = 0.9; // Min. 90% geschätzte Chance für Aktionen
const BLACKOP_SUCCESS_CHANCE = 0.95; // Min. 95% Chance für BlackOps

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

    // 🟢 2. Chaos Management in der aktuellen Stadt
    manageCityAndChaos(ns);

    // 🟢 3. Stamina Management Check
    const [currentStamina, maxStamina] = ns.bladeburner.getStamina();
    const staminaRatio = maxStamina > 0 ? currentStamina / maxStamina : 0;

    const currentAction = ns.bladeburner.getCurrentAction();

    // Wenn wir uns gerade in der Regenerationsphase befinden
    if (
      currentAction?.name === "Hyperbolic Regeneration" &&
      staminaRatio < STAMINA_FULL_THRESHOLD
    ) {
      await sleepNextCycle(ns);
      continue;
    }

    // Stamina zu niedrig ➔ Hyperbolic Regeneration starten
    if (staminaRatio < STAMINA_RECOVERY_THRESHOLD) {
      setAction(ns, "General", "Hyperbolic Regeneration");
      await sleepNextCycle(ns);
      continue;
    }

    // 🟢 4. Aktionsauswahl (Priorität: BlackOps > Operations > Contracts > Field Analysis)
    const bestAction = findBestAction(ns);
    if (bestAction) {
      if (currentAction?.name !== bestAction.name) {
        setAction(ns, bestAction.type, bestAction.name);
      }
    } else {
      // Fallback, wenn keine Verträge/Operationen sicher genug sind
      setAction(ns, "General", "Field Analysis");
    }

    await sleepNextCycle(ns);
  }
}

/**
 * Findet die beste verfügbare Aktion basierend auf Erfolgenschance und Priorität.
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
      const [minChance] = ns.bladeburner.getActionEstimatedSuccessChance(
        blackOpType,
        nextBlackOp.name as BladeburnerActionName,
      );
      if (minChance >= BLACKOP_SUCCESS_CHANCE) {
        return { type: blackOpType, name: nextBlackOp.name };
      }
    }
  }

  // 2. Operations prüfen
  const operations = ns.bladeburner.getOperationNames();
  for (const op of operations) {
    const count = ns.bladeburner.getActionCountRemaining("Operations", op);
    if (count <= 0) continue;

    const [minChance] = ns.bladeburner.getActionEstimatedSuccessChance(
      "Operations",
      op as BladeburnerActionName,
    );
    if (minChance >= MIN_SUCCESS_CHANCE) {
      return { type: "Operations", name: op };
    }
  }

  // 3. Contracts prüfen
  const contracts = ns.bladeburner.getContractNames();
  for (const contract of contracts) {
    const count = ns.bladeburner.getActionCountRemaining("Contracts", contract);
    if (count <= 0) continue;

    const [minChance] = ns.bladeburner.getActionEstimatedSuccessChance(
      "Contracts",
      contract as BladeburnerActionName,
    );
    if (minChance >= MIN_SUCCESS_CHANCE) {
      return { type: "Contracts", name: contract };
    }
  }

  return null;
}

/**
 * Überprüft Chaos in Städten und wechselt bei Bedarf in die Stadt mit dem geringsten Chaos.
 */
function manageCityAndChaos(ns: NS): void {
  const currentCity = ns.bladeburner.getCity();
  const currentChaos = ns.bladeburner.getCityChaos(currentCity);

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
        `🌆 Stadt gewechselt nach ${bestCity} (Chaos: ${lowestChaos.toFixed(1)})`,
      );
    }
  }
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
 * Schläft für die Restdauer der aktuellen Aktion oder minimal 1 Sekunde.
 */
async function sleepNextCycle(ns: NS): Promise<void> {
  const currentAction = ns.bladeburner.getCurrentAction();

  if (!currentAction || currentAction.type === "Idle") {
    await ns.sleep(1000);
    return;
  }

  const time = ns.bladeburner.getActionTime(
    currentAction.type as BladeburnerActionType,
    currentAction.name as BladeburnerActionName,
  );

  await ns.sleep(Math.max(1000, time + 100));
}
