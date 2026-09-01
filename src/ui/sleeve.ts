import { NS, SleeveTask } from "@ns";
import { loadSleeveState } from "/infrastructure/state/state";

function visualPadEnd(str: string, targetLength: number): string {
  const actualLength = [...str].length;
  const missing = targetLength - actualLength;
  return missing > 0 ? str + " ".repeat(missing) : str;
}

function parseTaskDetails(task: SleeveTask | null): {
  icon: string;
  text: string;
} {
  if (!task) return { icon: "💤", text: "IDLE" };

  const t = task as any;
  switch (task.type) {
    case "RECOVERY":
      return { icon: "💔", text: "Recovery (Schock abbauen)" };
    case "SYNCHRO":
      return { icon: "⚡", text: "Synchronize (Sync erhöhen)" };
    case "FACTION": {
      const workType = t.factionWorkType ?? t.workType;
      const detail = workType ? ` (${workType})` : "";
      return { icon: "🤝", text: `${t.factionName}${detail}` };
    }
    case "COMPANY":
      return { icon: "🏢", text: `Company: ${t.companyName}` };
    case "CRIME":
      return { icon: "🔫", text: `Crime: ${t.crimeType ?? t.actionName}` };
    case "BLADEBURNER":
      return { icon: "⚔️", text: `Bladeburner: ${t.actionName ?? "Op"}` };
    case "CLASS":
      return { icon: "🎓", text: `${t.classType} @ ${t.location}` };
    case "INFILTRATE":
      return { icon: "🥷", text: `Infiltration: ${t.location ?? "Synthoids"}` };
    case "SUPPORT":
      return { icon: "🛡️", text: "Support Main Player" };
    default:
      return { icon: "⚙️", text: "Unbekannter Modus" };
  }
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const COLOR = {
    RESET: "\u001b[0m",
    RED: "\u001b[31m",
    GREEN: "\u001b[32m",
    YELLOW: "\u001b[33m",
    CYAN: "\u001b[36m",
    GRAY: "\u001b[90m",
    BOLD: "\u001b[1m",
  };

  if (ns.sleeve === undefined || ns.sleeve.getNumSleeves() === 0) {
    ns.tprint("⚠️ Keine Sleeve-API oder keine Sleeves vorhanden.");
    return;
  }

  ns.ui.openTail();
  ns.ui.resizeTail(880, 400);
  ns.ui.setTailTitle("BitOS - Sleeve Control Dashboard");

  const dividerHeader = `${COLOR.GRAY}==========================================================================================${COLOR.RESET}`;
  const dividerSub = `${COLOR.GRAY}------------------------------------------------------------------------------------------${COLOR.RESET}`;

  while (true) {
    ns.clearLog();

    const numSleeves = ns.sleeve.getNumSleeves();
    const sleeveState = loadSleeveState(ns);

    // Header
    ns.print(dividerHeader);
    ns.print(
      ` ${COLOR.BOLD}${COLOR.CYAN}🧠 BitOS SLEEVE CONTROL SYSTEM${COLOR.RESET}`,
    );
    ns.print(dividerHeader);

    // Globaler Modus & Manager Status
    const globalMode = sleeveState?.sleeveGlobalMode ?? "AUTO";
    const progressSummary = sleeveState?.sleeveProgress ?? "Kein Status";
    ns.print(
      ` Modus: ${COLOR.YELLOW}${globalMode}${COLOR.RESET} | Status: ${COLOR.GRAY}${progressSummary}${COLOR.RESET}`,
    );
    ns.print(dividerSub);

    // Tabelle Header
    ns.print(
      ` ${COLOR.BOLD}ID  | SCHOCK   | SYNC     | AUGS | STADT      | AKTUELLE BESCHÄFTIGUNG${COLOR.RESET}`,
    );
    ns.print(dividerSub);

    // Sleeves auflisten
    for (let i = 0; i < numSleeves; i++) {
      const stats = ns.sleeve.getSleeve(i);
      const task = ns.sleeve.getTask(i);

      let augCount = 0;
      try {
        augCount = ns.sleeve.getSleeveAugmentations(i).length;
      } catch {
        /* API eingeschränkt */
      }

      const shockVal = stats.shock;
      const shockColor =
        shockVal === 0 ? COLOR.GREEN : shockVal > 50 ? COLOR.RED : COLOR.YELLOW;
      const shockFormatted = `${shockVal.toFixed(1)}%`.padStart(6);
      const shockStr = `${shockColor}${shockFormatted}${COLOR.RESET}  `;

      const syncVal = stats.sync;
      const syncColor = syncVal === 100 ? COLOR.GREEN : COLOR.YELLOW;
      const syncFormatted = `${syncVal.toFixed(1)}%`.padStart(6);
      const syncStr = `${syncColor}${syncFormatted}${COLOR.RESET}  `;

      const idStr = `#${i}`.padEnd(3);
      const augStr = `${augCount}`.padEnd(4);
      const cityStr = stats.city.padEnd(10);

      const { icon, text } = parseTaskDetails(task);
      const taskFormatted = visualPadEnd(`${icon} ${text}`, 36);

      ns.print(
        ` ${idStr} | ${shockStr} | ${syncStr} | ${augStr} | ${cityStr} | ${taskFormatted}`,
      );
    }

    ns.print(dividerHeader);

    await ns.sleep(1000);
  }
}
