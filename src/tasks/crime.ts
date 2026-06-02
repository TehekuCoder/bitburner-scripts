import { NS, CrimeType } from "@ns";

interface BotState {
  strategy: string;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🥷 Crime-Worker gestartet...");

  const sing = ns.singularity;

  while (true) {
    let mode = "MONEY";

    if (ns.fileExists("bitos_state.txt", "home")) {
      try {
        const content = ns.read("bitos_state.txt");
        if (content) {
          const state = JSON.parse(content) as BotState;
          mode = state.strategy;
        }
      } catch {
        // Schutz vor Lese-/Schreibkollisionen
      }
    }

    if (mode !== "MONEY") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Crime-Worker.`);
      return;
    }

    const p = ns.getPlayer();
    let bestCrime: CrimeType = ns.enums.CrimeType.homicide;

    // Wenn Formulas.exe existiert, berechnen wir die mathematisch profitabelste Option
    if (ns.fileExists("Formulas.exe", "home")) {
      let maxMoneyPerSecond = 0;
      const crimes = Object.values(ns.enums.CrimeType) as CrimeType[];

      for (const crime of crimes) {
        const crimeStats = sing.getCrimeStats(crime);
        const chance = ns.formulas.work.crimeSuccessChance(p, crime);

        const durationSeconds = crimeStats.time / 1000;
        const expectedMoney = crimeStats.money * chance;
        const moneyPerSecond = expectedMoney / durationSeconds;

        if (moneyPerSecond > maxMoneyPerSecond) {
          maxMoneyPerSecond = moneyPerSecond;
          bestCrime = crime;
        }
      }
    }

    const currentWork = sing.getCurrentWork();
    const isAlreadyDoingBestCrime = currentWork?.type === "CRIME" && currentWork.crimeType === bestCrime;

    if (!isAlreadyDoingBestCrime) {
      ns.print(`[CRIME] Berechnetes optimales Verbrechen: ${bestCrime}`);
      sing.commitCrime(bestCrime);
    }

    // Da Verbrechen eine feste Laufzeit haben, reicht ein fixer Check alle 2 Sekunden vollkommen aus
    await ns.sleep(2000);
  }
}