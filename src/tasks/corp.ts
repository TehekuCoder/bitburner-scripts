import { NS, CompanyName, JobField } from "@ns";

interface BotState {
  strategy: string;
  targetCompany?: CompanyName; // Typensicher aus den Netscript-Definitionen
  jobField?: JobField;         // z.B. "Software", "IT", "Business"
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("💼 Corporate-Career-Worker gestartet...");

  const sing = ns.singularity;

  while (true) {
    // --- 1. STATE & STRATEGIE PRÜFEN ---
    let mode = "CORP";
    let targetCompany: CompanyName | null = null;
    let jobField: JobField = "Software"; // Standardmäßig gehen wir in die Software-Entwicklung

    if (ns.fileExists("bitos_state.txt", "home")) {
      try {
        const content = ns.read("bitos_state.txt");
        if (content) {
          const state = JSON.parse(content) as BotState;
          mode = state.strategy;
          if (state.targetCompany) targetCompany = state.targetCompany;
          if (state.jobField) jobField = state.jobField;
        }
      } catch {
        // Schutz vor Lese-/Schreibkollisionen
      }
    }

    // Wenn die Strategie nicht mehr auf CORP steht, beenden wir uns sauber
    if (mode !== "CORP") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Firmen-Worker.`);
      return;
    }

    // Ohne zugewiesene Zielfirma können wir nichts tun
    if (!targetCompany) {
      ns.print("[WARN] Modus ist CORP, aber kein 'targetCompany' in bitos_state.txt definiert.");
      await ns.sleep(5000);
      continue;
    }

    // --- 2. BEFÖRDERUNGEN ODER EINTRITT AUTOMATISCH PRÜFEN ---
    // applyToCompany versucht sowohl den Ersteintritt als auch jede höhere Beförderung!
    const currentJob = sing.applyToCompany(targetCompany, jobField);
    if (currentJob) {
      ns.print(`[PROMOTION] Aktuelle Position bei ${targetCompany}: ${currentJob}`);
    }

    // --- 3. FÜR DIE FIRMA ARBEITEN ---
    const currentWork = sing.getCurrentWork();
    const isAlreadyWorkingHere = currentWork?.type === "COMPANY" && currentWork.companyName === targetCompany;

    if (!isAlreadyWorkingHere) {
      ns.print(`[WORK] Starte Arbeit bei ${targetCompany} im Bereich ${jobField}...`);
      const success = sing.workForCompany(targetCompany, false); // false = ohne Fokus-Strafen, falls du nebenbei tippst

      if (!success) {
        ns.print(`[WARN] Konnte Arbeit bei ${targetCompany} nicht starten. Fehlen Qualifikationen?`);
      }
    }

    // Da Firmen-Ruf sich kontinuierlich aufbaut, reicht ein Check alle 10 Sekunden vollkommen aus
    await ns.sleep(10000);
  }
}