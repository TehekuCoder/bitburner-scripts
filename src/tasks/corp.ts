import { NS, CompanyName, JobField } from "@ns";
import { loadState, saveState } from "../core/state-manager.js"; 

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("💼 Corporate-Career-Worker gestartet...");

  const sing = ns.singularity;

  while (true) {
    // --- 1. STATE & STRATEGIE VIA MANAGER LADEN & CASTEN ---
    const state = loadState(ns);
    
    // "as string" verhindert Compiler-Fehler bei der Modus-Prüfung
    const mode = (state?.strategy || "IDLE") as string; 
    
    // "as any" schützt vor TS2339, falls die Felder nicht im Basis-Interface stehen
    const targetCompany = (state as any)?.targetCompany as CompanyName || undefined;
    const jobField = (state as any)?.jobField as JobField || "Software";

    // Wenn die Strategie nicht mehr auf CORP steht, beenden wir uns sauber
    if (mode !== "CORP") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Firmen-Worker.`);
      return;
    }

    // Ohne zugewiesene Zielfirma können wir nichts tun
    if (!targetCompany) {
      ns.print("[WARN] Modus ist CORP, aber kein 'targetCompany' definiert.");
      await ns.sleep(5000);
      continue;
    }

    // --- 2. BEFÖRDERUNGEN AUTOMATISCH PRÜFEN ---
    // Versucht alle 10 Sekunden den nächsten Karriereschritt zu triggern
    const isPromoted = sing.applyToCompany(targetCompany, jobField); 
    
    const playerJobs = ns.getPlayer().jobs;
    const currentJobTitle = playerJobs[targetCompany] || "Bewerber";

    if (isPromoted) {
      ns.tprint(`🎉 [PROMOTION] Beförderung bei ${targetCompany}! Neuer Job: ${currentJobTitle}`);
    }

    // --- 3. FÜR DIE FIRMA ARBEITEN ---
    const currentWork = sing.getCurrentWork();
    const isAlreadyWorkingHere = currentWork?.type === "COMPANY" && currentWork.companyName === targetCompany;

    if (!isAlreadyWorkingHere) {
      ns.print(`[WORK] Starte Arbeit bei ${targetCompany} als ${currentJobTitle}...`);
      const success = sing.workForCompany(targetCompany, false); // false = Multitasking ohne Fokus-Malus

      if (!success) {
        ns.print(`[WARN] Konnte Arbeit nicht starten. Fehlen Qualifikationen für ${jobField}?`);
      }
    }

    // --- 4. HUD UPGRADE: REPUTATION TRACKING ---
    const currentRep = sing.getCompanyRep(targetCompany);
    
    if (state) {
      // Schickes, strukturiertes HUD-Feedback für deine UI
      state.progressBar = `💼 ${targetCompany}: ${currentJobTitle} (${ns.format.number(currentRep, 0)} Rep)`;
      saveState(ns, state);
    }

    // Da Firmen-Ruf sich kontinuierlich aufbaut, reicht ein Check alle 10 Sekunden vollkommen aus
    await ns.sleep(10000);
  }
}