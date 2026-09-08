import { BladeburnerSkillName, NS } from "@ns";
import { BLADEBURNER_SKILL_PRIORITIES } from "/shared/constants/bladeburner";

const BLACKOP_BOOST_SKILLS: BladeburnerSkillName[] = [
  "Blade's Intuition",
  "Digital Observer",
  "Reaper",
  "Evasive System",
];

export function autoUpgradeSkills(ns: NS, isBlackOpBlocked: boolean): void {
  let availableSp = ns.bladeburner.getSkillPoints();
  if (availableSp <= 0) return;

  while (availableSp > 0) {
    let bestSkill: BladeburnerSkillName | null = null;
    let bestScore = -1;
    let bestCost = Infinity;

    for (const item of BLADEBURNER_SKILL_PRIORITIES) {
      const skillName = item.name as BladeburnerSkillName;

      // Wenn wir für eine BlackOp pushen, nur relevante Skills aufrüsten
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
      ns.print(`🆙 Skill aufgerüstet${tag}: ${bestSkill} (Lvl ${newLevel}) [-${bestCost} SP]`);
      availableSp -= bestCost;
    } else {
      break;
    }
  }
}