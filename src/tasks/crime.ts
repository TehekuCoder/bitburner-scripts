import { NS, CrimeType } from "@ns";
import { loadState, saveState } from "core/state-manager.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🥷 Crime-Worker gestartet...");

  const sing = ns.singularity;
  const MIN_SUCCESS_CHANCE = 0.7; // 70% Mindestchance

  while (true) {
    // --- 1. STATE VIA MANAGER LADEN & LOKAL CASTEN ---
    const state = loadState(ns);
    const mode = (state?.strategy || "IDLE") as string;

    // 🔥 REPARIERT: XP_SPRINT zur Whitelist hinzugefügt
    if (
      mode !== "CRIME" &&
      mode !== "MONEY" &&
      mode !== "KILLS" &&
      mode !== "XP_SPRINT"
    ) {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Crime-Worker.`);
      return;
    }

    const p = ns.getPlayer();
    let bestCrime: CrimeType = ns.enums.CrimeType.shoplift;

    // --- 2. LOGIK-WEICHE: MORD ODER GELD? ---
    if (mode === "KILLS") {
      const targetKills = (state as any)?.targetKills || 30;
      const currentKills = p.numPeopleKilled;

      if (currentKills < targetKills) {
        bestCrime = ns.enums.CrimeType.homicide;

        if (sing.getCrimeChance(ns.enums.CrimeType.homicide) < 0.1) {
          bestCrime = ns.enums.CrimeType.mug;
          ns.print(
            `[WARN] Homicide-Chance zu gering. Trainiere via 'mug' vor...`,
          );
        }
      } else {
        ns.print(
          `[INFO] Ziel von ${targetKills} Kills erreicht (Aktuell: ${currentKills}).`,
        );
        bestCrime = ns.enums.CrimeType.homicide;
      }
    }

    // --- NORMALE MATHEMATISCHE OPTIMIERUNG ---
    // 🔥 REPARIERT: XP_SPRINT fällt jetzt sauber in die Geld-Gewinn-Optimierung
    if (mode === "CRIME" || mode === "MONEY" || mode === "XP_SPRINT") {
      let maxMoneyPerSecond = 0;
      const crimes = Object.values(ns.enums.CrimeType) as CrimeType[];

      for (const crime of crimes) {
        const crimeStats = sing.getCrimeStats(crime);
        const chance = sing.getCrimeChance(crime);

        if (
          chance < MIN_SUCCESS_CHANCE &&
          crime !== ns.enums.CrimeType.shoplift
        ) {
          continue;
        }

        const durationSeconds = crimeStats.time / 1000;
        const expectedMoney = crimeStats.money * chance;
        const moneyPerSecond = expectedMoney / durationSeconds;

        if (moneyPerSecond > maxMoneyPerSecond) {
          maxMoneyPerSecond = moneyPerSecond;
          bestCrime = crime;
        }
      }
    }

    // --- 3. VERBRECHEN AUSFÜHREN ---
    const currentWork = sing.getCurrentWork();
    const isAlreadyDoingBestCrime =
      currentWork?.type === "CRIME" &&
      (currentWork as any).crimeType === bestCrime;

    if (!isAlreadyDoingBestCrime) {
      const currentChanceStr = (sing.getCrimeChance(bestCrime) * 100).toFixed(
        1,
      );
      ns.print(`[CRIME] Aktion: ${bestCrime} (${currentChanceStr}% Chance)`);
      sing.commitCrime(bestCrime);
    }

    // --- 4. HUD INTERACTION & STATE UPDATE ---
    if (state) {
      const chancePct = (sing.getCrimeChance(bestCrime) * 100).toFixed(0);

      if (mode === "KILLS") {
        const tKills = (state as any).targetKills || 30;
        state.progressBar = `🥷 Morde: ${p.numPeopleKilled}/${tKills} | ${bestCrime} (${chancePct}%)`;
      } else {
        state.progressBar = `🥷 ${bestCrime} (${chancePct}%) | Karma: ${ns.format.number(p.karma, 0)}`;
      }
      saveState(ns, state);
    }

    await ns.sleep(2000);
  }
}
