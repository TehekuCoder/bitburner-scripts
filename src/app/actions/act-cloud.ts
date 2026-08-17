// app/actions/act-cloud.ts
import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const action = String(ns.args[0] ?? "");
  const hostname = String(ns.args[1] ?? "");
  const ram = Number(ns.args[2] ?? 0);

  if (!hostname || ram <= 0) {
    ns.tprint(`❌ [act-cloud] Ungültige Parameter: action=${action}, host=${hostname}, ram=${ram}`);
    return;
  }

  switch (action) {
    case "cloud-buy": {
      // ns.cloud.purchaseServer gibt bei Erfolg den Hostnamen zurück, sonst ""
      const boughtHost = ns.cloud.purchaseServer(hostname, ram);

      if (boughtHost && boughtHost !== "") {
        ns.tprint(`✅ [act-cloud] Server gekauft: ${boughtHost} (${ram}GB)`);
      } else {
        ns.tprint(`❌ [act-cloud] Kauf FEHLGESCHLAGEN für ${hostname} (${ram}GB). Geld oder Limit erreicht?`);
      }
      break;
    }
    case "cloud-upgrade": {
      // ns.cloud.upgradeServer gibt boolean zurück
      const success = ns.cloud.upgradeServer(hostname, ram);

      if (success) {
        ns.tprint(`✅ [act-cloud] Server aufgerüstet: ${hostname} ➔ ${ram}GB`);
      } else {
        ns.tprint(`❌ [act-cloud] Upgrade FEHLGESCHLAGEN für ${hostname} auf ${ram}GB.`);
      }
      break;
    }
    default:
      ns.tprint(`⚠️ [act-cloud] Unbekannte Aktion: ${action}`);
  }
}