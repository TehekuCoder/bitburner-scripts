import { NS } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, async () => {
    const action = String(ns.args[0] ?? "");
    const corpName = String(ns.args[1] ?? "Philip Matrix");

    if (action !== "corp-create") {
      ns.tprint(`⚠️ [act-corporation] Unbekannte Aktion: ${action}`);
      return false;
    }

    if (!ns.corporation) {
      ns.tprint(`❌ [act-corporation] Corporation API ist nicht freigeschaltet.`);
      return false;
    }

    if (ns.corporation.hasCorporation()) {
      ns.tprint(`ℹ️ [act-corporation] Corporation existiert bereits.`);
      return false;
    }

    const success = ns.corporation.createCorporation(corpName, true);
    if (success) {
      ns.tprint(`✅ [act-corporation] Corporation "${corpName}" erfolgreich gegründet!`);
    } else {
      ns.tprint(`❌ [act-corporation] Gründung von "${corpName}" fehlgeschlagen. (Nicht genug Kapital?)`);
    }
    return success;
  });
}