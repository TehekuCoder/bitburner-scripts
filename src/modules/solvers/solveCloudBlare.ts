import { NS } from "@ns";

/**
 * Solver für CloudBlare(tm) - Filtert Ziffern direkt aus den Daten,
 * mit Heartbleed-Fallback falls nötig.
 */
export async function solveCloudBlare(
  ns: NS,
  host: string,
  details: any
): Promise<string | null> {
  // 1. FAST PATH: Direkt alle Ziffern aus details.data filtern
  const rawData = String(details?.data || "").trim();
  const numericOnly = rawData.replace(/\D/g, "");

  if (numericOnly) {
    const res = (await ns.dnet.authenticate(host, numericOnly)) as any;
    if (res?.success) {
      ns.print(`☁️ [CloudBlare] Erfolgreich via Data-Ziffern geknackt: ${numericOnly}`);
      return numericOnly;
    }
  }

  // 2. FALLBACK: Falls details.data leer war oder abgelehnt wurde -> Heartbleed prüfen
  ns.print(`ℹ️ [CloudBlare] Fast-Path ohne Erfolg, starte Heartbleed-Fallback für ${host}...`);
  
  for (let i = 0; i < 3; i++) {
    const bleed = (await ns.dnet.heartbleed(host)) as any;
    const bleedStr = typeof bleed === "string" ? bleed : JSON.stringify(bleed || {});
    const bleedDigits = bleedStr.replace(/\D/g, "");

    if (bleedDigits) {
      const res = (await ns.dnet.authenticate(host, bleedDigits)) as any;
      if (res?.success) {
        ns.print(`🎉 [CloudBlare] Erfolgreich via Heartbleed-Ziffern geknackt: ${bleedDigits}`);
        return bleedDigits;
      }
    }
    await ns.sleep(50);
  }

  ns.print(`🔴 [CloudBlare] Keine gültigen Ziffern für ${host} gefunden.`);
  return null;
}