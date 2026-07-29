import { NS, GangGenInfo, GangMemberInfo } from "@ns";

export function printGangDashboard(
  ns: NS,
  gangInfo: GangGenInfo,
  members: GangMemberInfo[],
  minWinChance: number,
  localLogBuffer: string[],
): void {
  ns.clearLog();

  const dividerHeader =
    "==============================================================================";
  const dividerSub =
    "------------------------------------------------------------------------------";

  const penaltyPct = ((1 - gangInfo.wantedPenalty) * 100).toFixed(1);
  const territoryPct = (gangInfo.territory * 100).toFixed(2);
  const warfareStatus = gangInfo.territoryWarfareEngaged
    ? "⚔️ ENGAGED"
    : "🛡️ IDLE";
  const winChancePct = (minWinChance * 100).toFixed(1);

  ns.print(dividerHeader);
  ns.print(` 👥 BitOS GANG SYSTEM | ${gangInfo.faction}`);
  ns.print(dividerHeader);
  ns.print(
    ` Respect: ${ns.format.number(gangInfo.respect, 2)} | ` +
      `Wanted Lvl: ${gangInfo.wantedLevel.toFixed(1)} (-${penaltyPct}%) | ` +
      `Members: ${members.length}/12`,
  );
  ns.print(
    ` Territory: ${territoryPct}% | ` +
      `Power: ${ns.format.number(gangInfo.power, 2)} | ` +
      `Clash: ${warfareStatus} (Min Win: ${winChancePct}%)`,
  );
  ns.print(dividerSub);
  ns.print(
    " NAME       | TASK                      | STATS (AVG)  | ASC MULT | EQUI/AUG",
  );
  ns.print(dividerSub);

  for (const member of members) {
    const nameStr = member.name.padEnd(10);
    const taskStr = (member.task || "IDLE").padEnd(25);

    const avgStat = gangInfo.isHacking
      ? member.hack
      : Math.floor((member.str + member.def + member.dex + member.agi) / 4);
    const statStr = ns.format.number(avgStat, 0).padEnd(12);

    const mult = gangInfo.isHacking
      ? member.hack_asc_mult
      : (member.str_asc_mult +
          member.def_asc_mult +
          member.dex_asc_mult +
          member.agi_asc_mult) /
        4;
    const multStr = `${mult.toFixed(1)}x`.padEnd(8);

    const equipCount = `${member.upgrades.length}/${member.augmentations.length}`;

    ns.print(
      ` ${nameStr} | ${taskStr} | ${statStr} | ${multStr} | ${equipCount}`,
    );
  }

  ns.print(dividerHeader);

  if (localLogBuffer.length > 0) {
    ns.print(" LETZTE AKTIONEN:");
    for (const logLine of localLogBuffer) {
      ns.print(`   ${logLine}`);
    }
    ns.print(dividerSub);
  }
}
