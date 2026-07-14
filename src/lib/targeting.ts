import { NS, Player } from "@ns";

/**
 * Berechnet das profitabelste Hacking-Ziel im Netzwerk unter Berücksichtigung 
 * von BitNode-Multiplikatoren und Hacking-Fähigkeiten.
 */
export function findBestTarget(
  ns: NS,
  nodes: string[],
  player: Player,
  bnMults: any
): string {
  let best = "n00dles";
  let maxWeight = 0;

  const serverMaxMoneyMult = bnMults.ServerMaxMoney ?? 1.0;
  const growthMult = bnMults.ServerGrowthRate ?? 1.0;
  const isNoMoneyNode = serverMaxMoneyMult === 0;

  for (const node of nodes) {
    if (
      node === "home" ||
      node === "darkweb" ||
      node.startsWith("hacknet-node")
    ) {
      continue;
    }
    if (!ns.hasRootAccess(node)) continue;

    const srv = ns.getServer(node);
    const maxMoney = srv.moneyMax ?? 0;

    if (!isNoMoneyNode && maxMoney <= 0) continue;

    const reqSkill = srv.requiredHackingSkill || 0;
    if (reqSkill > player.skills.hacking) continue;

    const cycleTime = ns.getWeakenTime(node);

    // Spezialfall: BitNodes ohne Geld auf Servern (Fokus auf reine Hacking-XP)
    if (isNoMoneyNode) {
      const weight = reqSkill / (Math.max(1, cycleTime) / 1000);
      if (weight > maxWeight) {
        maxWeight = weight;
        best = node;
      }
      continue;
    }

    // Ignoriere Server, die länger als 5 Minuten für einen Zyklus brauchen (Early-Game Schutz)
    if (cycleTime > 5 * 60 * 1000) continue;

    // Deine bewährte Gewichtungsformel
    const weight =
      (maxMoney / (cycleTime / 1000)) * (reqSkill / 100) * growthMult;

    if (weight > maxWeight) {
      maxWeight = weight;
      best = node;
    }
  }
  return best;
}