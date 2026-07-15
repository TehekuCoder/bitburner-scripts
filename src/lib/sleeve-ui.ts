import { NS } from "@ns";

export function printSleeveDashboard(ns: NS, numSleeves: number, localLogBuffer: string[]): void {
  ns.clearLog();
  ns.print("╔════════╤═════════╤═════════╤════════════════════════════════════════════════╗");
  ns.print("║ Sleeve │ Schock  │ Sync    │ Aktuelle Beschäftigung                         ║");
  ns.print("╠════════╪═════════╪═════════╪════════════════════════════════════════════════╣");

  for (let i = 0; i < numSleeves; i++) {
    const stats = ns.sleeve.getSleeve(i);
    const task = ns.sleeve.getTask(i);

    const idStr = `#${i}`.padEnd(6);
    const shockStr = `${stats.shock.toFixed(1)}%`.padEnd(7);
    const syncStr = `${stats.sync.toFixed(1)}%`.padEnd(7);

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

    const taskStr = taskDesc.padEnd(46);
    ns.print(`║ ${idStr} │ ${shockStr} │ ${syncStr} │ ${taskStr} ║`);
  }

  ns.print("╚════════╧═════════╧═════════╧════════════════════════════════════════════════╝");

  if (localLogBuffer.length > 0) {
    ns.print("\n Letzte Aktionen:");
    for (const logLine of localLogBuffer) {
      ns.print(`  ${logLine}`);
    }
  }
}