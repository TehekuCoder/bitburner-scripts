import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (!ns.sleeve) {
    ns.print("❌ Sleeve-API ist in diesem BitNode/Moment nicht verfügbar.");
    return;
  }

  const action = String(ns.args[0] ?? "");

  switch (action) {
    case "sleeve-purchase-aug": {
      const sleeveId = Number(ns.args[1] ?? -1);
      const augName = String(ns.args[2] ?? "");
      const totalSleeves = ns.sleeve.getNumSleeves();

      if (sleeveId < 0 || sleeveId >= totalSleeves || !augName) {
        ns.print(`❌ Ungültige Parameter: Sleeve #${sleeveId}/${totalSleeves}, Aug: '${augName}'`);
        return;
      }

      const success = ns.sleeve.purchaseSleeveAug(sleeveId, augName);
      if (success) {
        ns.toast(`Sleeve #${sleeveId}: '${augName}' gekauft!`, "success", 3000);
        ns.print(`✅ Sleeve #${sleeveId}: '${augName}' erfolgreich gekauft.`);
      } else {
        ns.print(`⚠️ Sleeve #${sleeveId}: Kauf von '${augName}' fehlgeschlagen (unzureichende Mittel oder bereits installiert).`);
      }
      break;
    }

    default:
      ns.print(`⚠️ Unbekannte Sleeve-Aktion: '${action}'`);
      break;
  }
}