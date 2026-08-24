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
          if (item.faction && item.name) {
            const success = ns.singularity.purchaseAugmentation(
              item.faction,
              item.name,
            );
            if (!success) break; // Abbrechen, falls Budget oder Prereqs fehlschlagen
          }
        }
      } catch {}
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
  }
}
