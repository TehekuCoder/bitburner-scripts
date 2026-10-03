// app/actions/act-cloud.ts
import { NS } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, async () => {
    const action = String(ns.args[0] ?? "");
    const hostname = String(ns.args[1] ?? "");
    const ram = Number(ns.args[2] ?? 0);

    if (!hostname || ram <= 0) {
      ns.tprint(`❌ [act-cloud] Ungültige Parameter: action=${action}, host=${hostname}, ram=${ram}`);
      return false;
    }

    switch (action) {
      case "cloud-buy": {
        const boughtHost = ns.cloud.purchaseServer(hostname, ram);

        if (boughtHost && boughtHost !== "") {
          ns.tprint(`✅ [act-cloud] Server gekauft: ${boughtHost} (${ram}GB)`);
          return true;
        }
        ns.tprint(`❌ [act-cloud] Kauf FEHLGESCHLAGEN für ${hostname} (${ram}GB). Geld oder Limit erreicht?`);
        return false;
      }
      case "cloud-upgrade": {
        const success = ns.cloud.upgradeServer(hostname, ram);

        if (success) {
          ns.tprint(`✅ [act-cloud] Server aufgerüstet: ${hostname} ➔ ${ram}GB`);
        } else {
          ns.tprint(`❌ [act-cloud] Upgrade FEHLGESCHLAGEN für ${hostname} auf ${ram}GB.`);
        }
        return success;
      }
      default:
        ns.tprint(`⚠️ [act-cloud] Unbekannte Aktion: ${action}`);
        return false;
    }
  });
}