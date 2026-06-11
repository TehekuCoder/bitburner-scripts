import { NS, CrimeType } from "@ns";
import { loadState, saveState } from "core/state-manager.js"; // Zentralen State-Manager nutzen

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🥷 Crime-Worker gestartet...");

  const sing = ns.singularity;

  while (true) {
    // --- 1. STATE & STRATEGIE VIA MANAGER LADEN ---
    const state = loadState(ns);
    const mode = state?.strategy || "IDLE";

    // BEHOBEN: Läuft jetzt, wenn das System explizit CRIME fordert ODER im Early-Game MONEY braucht
    if (mode !== "CRIME" && mode !== "MONEY") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Crime-Worker.`);
      return;
    }

    // --- 2. MATHEMATISCH OPTIMALES VERBRECHEN ERMITTELN ---
    let bestCrime: CrimeType = ns.enums.CrimeType.shoplift; // Sicherer Start-Fallback
    let maxMoneyPerSecond = 0;

    // Alle im Spiel existierenden Verbrechen abgreifen
    const crimes = Object.values(ns.enums.CrimeType) as CrimeType[];

    for (const crime of crimes) {
      const crimeStats = sing.getCrimeStats(crime);

      // GENIAL: getCrimeChance() ist nativ und braucht KEINE Formulas.exe!
      const chance = sing.getCrimeChance(crime);

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
    const isAlreadyDoingBestCrime =
      currentWork?.type === "CRIME" && currentWork.crimeType === bestCrime;

    if (!isAlreadyDoingBestCrime) {
      const currentChanceStr = (sing.getCrimeChance(bestCrime) * 100).toFixed(
        1,
      );
      ns.print(
        `[CRIME] Optimal: ${bestCrime} (${currentChanceStr}% Erfolgschance)`,
      );
      sing.commitCrime(bestCrime);
    }

    // --- 4. HUD INTERACTION & KARMA-TRACKING ---
    if (state) {
      const chancePct = (sing.getCrimeChance(bestCrime) * 100).toFixed(0);
      const currentKarma = ns.getPlayer().karma;

      // Schreibt den Status direkt ins HUD (Inklusive Karma-Fortschritt für Gangs!)
      state.progressBar = `🥷 ${bestCrime} (${chancePct}%) | Karma: ${ns.format.number(currentKarma, 0)}`;
      saveState(ns, state);
    }

    // Taktung auf 2 Sekunden belassen. Wenn das Verbrechen länger dauert,
    // sieht das Skript beim nächsten Loop, dass es noch läuft und schläft weiter.
    await ns.sleep(2000);
  }
}
