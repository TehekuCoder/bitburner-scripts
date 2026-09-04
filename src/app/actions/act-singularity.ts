import { NS, ProgramName, FactionName } from "@ns";

export async function main(ns: NS): Promise<void> {
  if (!ns.singularity) return;
  const action = String(ns.args[0] ?? "");

  switch (action) {
    case "home-upgrade-ram":
      ns.singularity.upgradeHomeRam();
      break;

    case "home-upgrade-cores":
      ns.singularity.upgradeHomeCores();
      break;

    case "program-purchase-tor":
      ns.singularity.purchaseTor();
      break;

    case "program-purchase": {
      const prog = String(ns.args[1] ?? "") as ProgramName;
      if (prog) ns.singularity.purchaseProgram(prog);
      break;
    }

    case "player-purchase-aug": {
      const faction = String(ns.args[1] ?? "") as FactionName;
      const aug = String(ns.args[2] ?? "");
      if (faction && aug) ns.singularity.purchaseAugmentation(faction, aug);
      break;
    }

    case "player-purchase-aug-batch": {
      try {
        const batch = JSON.parse(String(ns.args[1] ?? "[]")) as {
          faction: FactionName;
          name: string;
        }[];

        for (const item of batch) {
          if (!item.faction || !item.name) continue;

          const currentMoney = ns.getServerMoneyAvailable("home");
          const currentPrice = ns.singularity.getAugmentationPrice(item.name);

          // Budget-Absicherung vor jedem Kauf
          if (currentMoney < currentPrice) {
            ns.tprint(
              `[WARN] Batch abgebrochen für ${item.name}: Zu wenig Geld.`,
            );
            break;
          }

          const success = ns.singularity.purchaseAugmentation(
            item.faction,
            item.name,
          );
          if (!success) {
            ns.tprint(`[ERROR] Kauf fehlgeschlagen für: ${item.name}`);
            break;
          }

          ns.print(`[SUCCESS] Gekauft: ${item.name}`);
        }
      } catch (e) {
        ns.tprint(`[ERROR] Fehler beim Parsen des Augment-Batches: ${e}`);
      }
      break;
    }

    case "player-purchase-nfg": {
      const faction = String(ns.args[1] ?? "") as FactionName;
      if (faction) {
        while (
          ns.singularity.purchaseAugmentation(faction, "NeuroFlux Governor")
        ) {}
      }
      break;
    }
    case "player-install-augs": {
      const startScript = (ns.args[1] as string) || "init.js";
      ns.singularity.installAugmentations(startScript);
      break;
    }
  }
}
