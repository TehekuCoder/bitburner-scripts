import { NS, CrimeType } from "@ns";
import { loadState, saveState } from "core/state-manager.js"; // Zentralen State-Manager nutzen

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🥷 Crime-Worker gestartet...");

  const sing = ns.singularity;
  
  // --- TUNING: MINDESTCHANCE ---
  // Verhindert, dass das Skript bei riskanten High-End-Crimes mit 2 Minuten Laufzeit gambelt.
  const MIN_SUCCESS_CHANCE = 0.70; // 70% Mindestchance

  while (true) {
    // --- 1. STATE & STRATEGIE VIA MANAGER LADEN ---
    const state = loadState(ns);
    const mode = state?.strategy || "IDLE";

    if (mode !== "CRIME" && mode !== "MONEY") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Crime-Worker.`);
      return;
    }

    // --- 2. MATHEMATISCH OPTIMALES VERBRECHEN ERMITTELN ---
    let bestCrime: CrimeType = ns.enums.CrimeType.shoplift; // Sicherer Start-Fallback
    let maxMoneyPerSecond = 0;

    const crimes = Object.values(ns.enums.CrimeType) as CrimeType[];

    for (const crime of crimes) {
      const crimeStats = sing.getCrimeStats(crime);
      const chance = sing.getCrimeChance(crime);

      // KORREKTUR: Wenn die Chance zu gering ist, ignorieren wir das Verbrechen komplett.
      // Shoplift erlauben wir immer, damit das Skript ganz am Anfang nicht blockiert.
      if (chance < MIN_SUCCESS_CHANCE && crime !== ns.enums.CrimeType.shoplift) {
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

    // --- 3. VERBRECHEN AUSFÜHREN ---
    const currentWork = sing.getCurrentWork();
    const isAlreadyDoingBestCrime = currentWork?.type === "CRIME" && currentWork.crimeType === bestCrime;

    if (!isAlreadyDoingBestCrime) {
      const currentChanceStr = (sing.getCrimeChance(bestCrime) * 100).toFixed(1);
      ns.print(`[CRIME] Optimal: ${bestCrime} (${currentChanceStr}% Erfolgschance)`);
      sing.commitCrime(bestCrime);
    }

    // --- 4. HUD INTERACTION & KARMA-TRACKING ---
    if (state) {
      const chancePct = (sing.getCrimeChance(bestCrime) * 100).toFixed(0);
      const currentKarma = ns.getPlayer().karma;

      state.progressBar = `🥷 ${bestCrime} (${chancePct}%) | Karma: ${ns.format.number(currentKarma, 0)}`;
      saveState(ns, state);
    }

    await ns.sleep(2000);
  }
}