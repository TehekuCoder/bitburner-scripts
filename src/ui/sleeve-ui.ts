import { NS } from "@ns";

export function printSleeveDashboard(ns: NS, numSleeves: number, localLogBuffer: string[]): void {
  ns.clearLog();

  const dividerHeader = "==============================================================================";
  const dividerSub    = "------------------------------------------------------------------------------";

  ns.print(dividerHeader);
  ns.print(" 🧠 BitOS SLEEVE CONTROL SYSTEM");
  ns.print(dividerHeader);
  ns.print(" ID     | SCHOCK   | SYNC     | AKTUELLE BESCHÄFTIGUNG");
  ns.print(dividerSub);

  for (let i = 0; i < numSleeves; i++) {
    const stats = ns.sleeve.getSleeve(i);
    const task = ns.sleeve.getTask(i);

    const idStr = `#${i}`.padEnd(6);
    const shockStr = `${stats.shock.toFixed(1)}%`.padEnd(8);
    const syncStr = `${stats.sync.toFixed(1)}%`.padEnd(8);

    let taskDesc = "IDLE";
    if (task) {
      switch (task.type) {
        case "RECOVERY":
          taskDesc = "💔 Recovery (Schock abbauen)";
          break;
        case "SYNCHRO":
          taskDesc = "⚡ Synchronize (Sync erhöhen)";
          break;
        case "FACTION":
          taskDesc = `🤝 Faction: ${task.factionName}`;
          break;
        case "COMPANY":
          taskDesc = `🏢 Company: ${task.companyName}`;
          break;
        case "CRIME":
          taskDesc = `🔫 Crime: ${task.crimeType}`;
          break;
        case "BLADEBURNER":
          taskDesc = "⚔️ Bladeburner Operation";
          break;
        case "CLASS":
          taskDesc = `🎓 Class: ${task.classType} @ ${task.location}`;
          break;
        default:
          taskDesc = `⚙️ ${task.type}`;
      }
    }

    const taskStr = taskDesc.padEnd(42);
    ns.print(` ${idStr} | ${shockStr} | ${syncStr} | ${taskStr}`);
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