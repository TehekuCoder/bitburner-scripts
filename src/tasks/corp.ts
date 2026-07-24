import { NS, CompanyName, JobField } from "@ns";
import { loadState, patchState } from "/lib/state";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("💼 Corporate-Career-Worker gestartet...");

  const sing = ns.singularity;

  while (true) {
    const state = loadState(ns);
    const mode = (state?.strategy || "IDLE") as string;
    const targetCompany = ((state as any)?.targetCompany as CompanyName) || undefined;
    const jobField = ((state as any)?.jobField as JobField) || "Software";

    if (mode !== "CORP") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Firmen-Worker.`);
      return;
    }

    if (!targetCompany) {
      ns.print("[WARN] Modus ist CORP, aber kein 'targetCompany' defined.");
      await ns.sleep(2000);
      continue;
    }

    const isPromoted = sing.applyToCompany(targetCompany, jobField);
    const playerJobs = ns.getPlayer().jobs;
    const currentJobTitle = playerJobs[targetCompany] || "Bewerber";

    if (isPromoted) {
      ns.print(`🎉 [PROMOTION] Beförderung bei ${targetCompany}! Neuer Job: ${currentJobTitle}`);
    }

    const currentWork = sing.getCurrentWork();
    // 🟢 TypeScript Type-Cast eingebaut, um strict compiler errors zu verhindern
    const isAlreadyWorkingHere =
      currentWork?.type === "COMPANY" &&
      (currentWork as any).companyName === targetCompany;

    if (!isAlreadyWorkingHere) {
      ns.print(`[WORK] Starte Arbeit bei ${targetCompany} als ${currentJobTitle}...`);
      const success = sing.workForCompany(targetCompany, false);
      if (!success) {
        ns.print(`[WARN] Konnte Arbeit nicht starten. Fehlen Qualifikationen?`);
      }
    }

    const currentRep = sing.getCompanyRep(targetCompany);
    patchState(ns, {
      progressBar: `💼 ${targetCompany}: ${currentJobTitle} (${ns.format.number(currentRep, 0)} Rep)`,
    });

    await ns.sleep(2000);
  }
}