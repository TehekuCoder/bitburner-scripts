import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const action = String(ns.args[0] ?? "");
  const corpName = String(ns.args[1] ?? "Philip Matrix");

  if (action === "corp-create") {
    if (!Boolean(ns.corporation)) {
      ns.tprint(`❌ [act-corporation] Corporation API ist nicht freigeschaltet.`);
      return;
    }

    if (ns.corporation.hasCorporation()) {
      ns.tprint(`ℹ️ [act-corporation] Corporation existiert bereits.`);
      return;
    }

    // Erstellt die Corporation (Self-Funded = true)
    const success = ns.corporation.createCorporation(corpName, true);

    if (success) {
      ns.tprint(`✅ [act-corporation] Corporation "${corpName}" erfolgreich gegründet!`);
    } else {
      ns.tprint(`❌ [act-corporation] Gründung von "${corpName}" fehlgeschlagen. (Nicht genug Kapital?)`);
    }
  } else {
    ns.tprint(`⚠️ [act-corporation] Unbekannte Aktion: ${action}`);
  }
}