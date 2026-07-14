import { NS, CrimeType } from "@ns";
import { loadState, patchState } from "../core/state-manager.js"; // 🛠️ Pfad korrigiert & patchState

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🥷 Crime-Worker gestartet...");

  const sing = ns.singularity;
  const MIN_SUCCESS_CHANCE = 0.7;

  while (true) {
    const state = loadState(ns);
    const mode = (state?.strategy || "IDLE") as string;

    if (mode !== "CRIME" && mode !== "MONEY" && mode !== "KILLS" && mode !== "XP_SPRINT") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Crime-Worker.`);
      return;
    }

    const p = ns.getPlayer();
    let bestCrime: CrimeType = ns.enums.CrimeType.shoplift;

    // Logik-Weiche: Kills vs. Profit/XP
    if (mode === "KILLS") {
      const targetKills = (state as any)?.targetKills || 30;
      if (p.numPeopleKilled < targetKills) {
        bestCrime = ns.enums.CrimeType.homicide;
        if (sing.getCrimeChance(ns.enums.CrimeType.homicide) < 0.1) {
          bestCrime = ns.enums.CrimeType.mug;
        }
      } else {
        bestCrime = ns.enums.CrimeType.homicide;
      }
    } else {
      let maxMoneyPerSecond = 0;
      const crimes = Object.values(ns.enums.CrimeType) as CrimeType[];

      for (const crime of crimes) {
        const crimeStats = sing.getCrimeStats(crime);
        const chance = sing.getCrimeChance(crime);

        if (chance < MIN_SUCCESS_CHANCE && crime !== ns.enums.CrimeType.shoplift) continue;

        const durationSeconds = crimeStats.time / 1000;
        const expectedMoney = crimeStats.money * chance;
        const moneyPerSecond = expectedMoney / durationSeconds;

        if (moneyPerSecond > maxMoneyPerSecond) {
          maxMoneyPerSecond = moneyPerSecond;
          bestCrime = crime;
        }
      }
    }

    // Crime ausführen
    const currentWork = sing.getCurrentWork();
    const isAlreadyDoingBestCrime = currentWork?.type === "CRIME" && (currentWork as any).crimeType === bestCrime;

    if (!isAlreadyDoingBestCrime) {
      sing.commitCrime(bestCrime, false);
    }

    // HUD & Heartbeat Update
    const chancePct = (sing.getCrimeChance(bestCrime) * 100).toFixed(0);
    let progressStr = "";

    if (mode === "KILLS") {
      const tKills = (state as any).targetKills || 30;
      progressStr = `🥷 Kills: ${p.numPeopleKilled}/${tKills} | ${bestCrime} (${chancePct}%)`;
    } else {
      progressStr = `🥷 ${bestCrime} (${chancePct}%) | Karma: ${ns.format.number(p.karma, 0)}`;
    }

    patchState(ns, {
      progressBar: progressStr,
    });

    await ns.sleep(2000);
  }
}