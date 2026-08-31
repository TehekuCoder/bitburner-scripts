// app/actions/act-bladeburner.ts
import { NS, BladeburnerSkillName, BladeburnerActionType, BladeburnerActionName } from "@ns";

export async function main(ns: NS): Promise<void> {
  const action = String(ns.args[0] ?? "");
  const param1 = String(ns.args[1] ?? "");
  const param2 = String(ns.args[2] ?? "");
  const count = Number(ns.args[3] ?? 1);

  if (!action) {
    ns.tprint(`❌ [act-bladeburner] Keine Aktion angegeben.`);
    return;
  }

  switch (action) {
    case "join": {
      const joined = ns.bladeburner.joinBladeburnerDivision();
      if (joined) {
        ns.tprint(`✅ [act-bladeburner] Bladeburner-Division erfolgreich beigetreten!`);
      } else {
        ns.tprint(`❌ [act-bladeburner] Beitritt fehlgeschlagen. Combat-Stats zu niedrig?`);
      }
      break;
    }

    case "upgrade-skill": {
      const skillName = param1 as BladeburnerSkillName;
      const success = ns.bladeburner.upgradeSkill(skillName, count);

      if (success) {
        ns.tprint(`✅ [act-bladeburner] Skill aufgerüstet: ${skillName} (+${count})`);
      } else {
        ns.tprint(`❌ [act-bladeburner] Upgrade FEHLGESCHLAGEN für ${skillName}. Unzureichende Skill Points?`);
      }
      break;
    }

    case "set-action": {
      const actionType = param1 as BladeburnerActionType;
      const actionName = param2 as BladeburnerActionName;

      const success = ns.bladeburner.startAction(actionType, actionName);
      if (success) {
        ns.tprint(`✅ [act-bladeburner] Aktion gestartet: [${actionType}] ${actionName}`);
      } else {
        ns.tprint(`❌ [act-bladeburner] Aktion konnte nicht gestartet werden: [${actionType}] ${actionName}`);
      }
      break;
    }

    default:
      ns.tprint(`⚠️ [act-bladeburner] Unbekannte Aktion: ${action}`);
  }
}