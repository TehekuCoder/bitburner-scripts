import { NS, BladeburnerActionType, BladeburnerActionName, BladeburnerBlackOpName } from "@ns";
import { manageCityAndChaos, calculateDynamicThreshold } from "/domain/bladeburner/chaos-control";
import { autoUpgradeSkills } from "/domain/bladeburner/skill-manager";

const CONFIG = {
  STAMINA_RECOVERY_THRESHOLD: 0.5,
  STAMINA_FULL_THRESHOLD: 0.95,
  MIN_CHANCE_BLACKOP: 0.9,
  MIN_CHANCE_OPERATION: 0.8,
  MIN_CHANCE_CONTRACT_HIGH: 0.75,
  MIN_CHANCE_TRACKING: 0.65,
  MIN_COMBAT_STATS: 100,
};

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  while (true) {
    if (!ns.bladeburner.inBladeburner()) {
      if (!ns.bladeburner.joinBladeburnerDivision()) {
        ns.print("⏳ Warte auf ausreichende Combat-Stats zum Beitritt...");
        await ns.sleep(10000);
        continue;
      }
    }

    // 1. BlackOp Status prüfen
    const nextBlackOp = ns.bladeburner.getNextBlackOp();
    const validBlackOpName = getValidBlackOpName(nextBlackOp);
    const isBlackOpBlocked = checkBlackOpBlocked(ns, validBlackOpName);

    // 2. Skills aufrüsten
    autoUpgradeSkills(ns, isBlackOpBlocked);

    // 3. Stamina Management
    const [currentStamina, maxStamina] = ns.bladeburner.getStamina();
    const staminaRatio = maxStamina > 0 ? currentStamina / maxStamina : 0;
    const currentAction = ns.bladeburner.getCurrentAction();

    if (currentAction?.name === "Hyperbolic Regeneration Chamber" && staminaRatio < CONFIG.STAMINA_FULL_THRESHOLD) {
      await sleepNextCycle(ns);
      continue;
    }

    if (staminaRatio < CONFIG.STAMINA_RECOVERY_THRESHOLD) {
      if (currentAction?.name !== "Hyperbolic Regeneration Chamber") {
        setAction(ns, "General", "Hyperbolic Regeneration Chamber");
      }
      await sleepNextCycle(ns);
      continue;
    }

    // 4. Stadt & Chaos
    const dynamicChaosLimit = calculateDynamicThreshold(ns);
    manageCityAndChaos(ns, dynamicChaosLimit);

    // 5. Aktionsauswahl
    const currentCity = ns.bladeburner.getCity();
    const currentChaos = ns.bladeburner.getCityChaos(currentCity);
    const bestAction = findBestAction(ns, validBlackOpName);

    if (bestAction) {
      if (currentAction?.name !== bestAction.name) {
        const success = setAction(ns, bestAction.type, bestAction.name);
        if (!success) {
          executeFallbackAction(ns, currentAction, currentChaos, dynamicChaosLimit);
        }
      }
    } else {
      executeFallbackAction(ns, currentAction, currentChaos, dynamicChaosLimit);
    }

    await sleepNextCycle(ns);
  }
}

function checkBlackOpBlocked(ns: NS, blackOpName: BladeburnerBlackOpName | null): boolean {
  if (!blackOpName) return false;
  const reqRank = ns.bladeburner.getBlackOpRank(blackOpName);
  if (ns.bladeburner.getRank() >= reqRank) {
    const [minChance, maxChance] = ns.bladeburner.getActionEstimatedSuccessChance("Black Operations", blackOpName);
    return (minChance + maxChance) / 2 < CONFIG.MIN_CHANCE_BLACKOP;
  }
  return false;
}

function findBestAction(
  ns: NS,
  validBlackOpName: BladeburnerBlackOpName | null
): { type: BladeburnerActionType; name: BladeburnerActionName } | null {
  if (hasLowCombatStats(ns)) {
    return { type: "General", name: "Training" };
  }

  if (validBlackOpName) {
    const reqRank = ns.bladeburner.getBlackOpRank(validBlackOpName);
    if (ns.bladeburner.getRank() >= reqRank) {
      const [minChance, maxChance] = ns.bladeburner.getActionEstimatedSuccessChance("Black Operations", validBlackOpName);
      if ((minChance + maxChance) / 2 >= CONFIG.MIN_CHANCE_BLACKOP) {
        return { type: "Black Operations", name: validBlackOpName };
      }
    }
  }

  const operations = ns.bladeburner.getOperationNames().slice().reverse();
  for (const op of operations) {
    if (ns.bladeburner.getActionCountRemaining("Operations", op) < 1) continue;
    const actionName = op as BladeburnerActionName;
    const [minChance, maxChance] = ns.bladeburner.getActionEstimatedSuccessChance("Operations", actionName);
    if ((minChance + maxChance) / 2 >= CONFIG.MIN_CHANCE_OPERATION) {
      return { type: "Operations", name: actionName };
    }
  }

  const contracts = ns.bladeburner.getContractNames().slice().reverse();
  for (const contract of contracts) {
    if (ns.bladeburner.getActionCountRemaining("Contracts", contract) < 1) continue;
    const actionName = contract as BladeburnerActionName;
    const [minChance, maxChance] = ns.bladeburner.getActionEstimatedSuccessChance("Contracts", actionName);
    const reqChance = contract === "Tracking" ? CONFIG.MIN_CHANCE_TRACKING : CONFIG.MIN_CHANCE_CONTRACT_HIGH;
    if ((minChance + maxChance) / 2 >= reqChance) {
      return { type: "Contracts", name: actionName };
    }
  }

  return null;
}

function executeFallbackAction(
  ns: NS,
  currentAction: { type: string; name: string } | null,
  currentChaos: number,
  chaosLimit: number,
): void {
  if (currentChaos > chaosLimit) {
    if (currentAction?.name !== "Diplomacy") setAction(ns, "General", "Diplomacy");
  } else if (hasLowCombatStats(ns)) {
    if (currentAction?.name !== "Training") setAction(ns, "General", "Training");
  } else if (currentAction?.name !== "Field Analysis") {
    setAction(ns, "General", "Field Analysis");
  }
}

function hasLowCombatStats(ns: NS): boolean {
  const { strength, defense, dexterity, agility } = ns.getPlayer().skills;
  return (
    strength < CONFIG.MIN_COMBAT_STATS ||
    defense < CONFIG.MIN_COMBAT_STATS ||
    dexterity < CONFIG.MIN_COMBAT_STATS ||
    agility < CONFIG.MIN_COMBAT_STATS
  );
}

function setAction(ns: NS, type: BladeburnerActionType, name: BladeburnerActionName): boolean {
  const success = ns.bladeburner.startAction(type, name);
  if (success) ns.print(`▶️ Aktion gestartet: [${type}] ${name}`);
  return success;
}

function getValidBlackOpName(nextBlackOp: { name: BladeburnerBlackOpName } | null): BladeburnerBlackOpName | null {
  if (!nextBlackOp || !nextBlackOp.name) return null;
  const rawName = nextBlackOp.name as string;
  if (rawName === "" || rawName === "None") return null;
  return nextBlackOp.name;
}

async function sleepNextCycle(ns: NS): Promise<void> {
  const current = ns.bladeburner.getCurrentAction();
  if (!current || current.type === "Idle") {
    await ns.sleep(300);
    return;
  }

  const totalTime = ns.bladeburner.getActionTime(current.type as BladeburnerActionType, current.name as BladeburnerActionName);
  const currentTime = ns.bladeburner.getActionCurrentTime();
  let remainingMs = Math.max(0, totalTime - currentTime);

  if (ns.bladeburner.getBonusTime() > 0) remainingMs /= 5;

  const sleepTime = Math.min(Math.max(remainingMs, 100), 500);
  await ns.sleep(sleepTime);
}