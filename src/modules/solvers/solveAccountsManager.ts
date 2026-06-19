import { NS } from "@ns";

/**
 * Solver für AccountsManager - Nutzt eine binäre Suche basierend auf Heartbleed-Feedback.
 */
export async function solveAccountsManager(
  ns: NS,
  host: string,
  details: any
): Promise<string | null> {
  let low = 0;
  let high = 100; // Standard-Fallback

  ns.print(`🔢 Starte Heartbleed-gestützten High/Low-Solver für AccountsManager auf ${host}...`);

  // 1. Testschuss abgeben, um die exakten Grenzen aus der Server-Nachricht zu kitzeln
  const initResult = (await ns.dnet.authenticate(host, "0")) as any;

  if (initResult && initResult.code === 351) {
    ns.tprint(`❌ [AccountsManager] Fehler auf ${host}: Direct Connection Required!`);
    return null;
  }

  if (initResult && initResult.success) {
    return "0";
  }

  // Grenzen dynamisch extrahieren (z.B. "between 0 and 10")
  if (initResult && initResult.message) {
    const match = initResult.message.match(/between (\d+) and (\d+)/);
    if (match) {
      low = parseInt(match[1], 10);
      high = parseInt(match[2], 10);
      ns.print(`🎯 Suchbereich via Nachricht erkannt: [${low} bis ${high}]`);
    }
  }

  // 2. Binäre Suche mit Heartbleed-Abfrage
  while (low <= high) {
    const guess = Math.floor((low + high) / 2);
    ns.print(`[AccountsManager] Teste Zahl: ${guess} (Bereich: [${low}-${high}])`);

    const result = (await ns.dnet.authenticate(host, guess.toString())) as any;

    if (result && result.code === 351) {
      ns.tprint(`❌ [AccountsManager] Fehler auf ${host}: Direct Connection Required!`);
      return null;
    }

    if (result && result.success) {
      ns.print(`🎉 [AccountsManager] Erfolg! Passwort ist: ${guess}`);
      return guess.toString();
    }

    // 🔥 FIX: Jetzt ziehen wir uns das Feedback aus den Heartbleed-Logs!
    const bleedData = await ns.dnet.heartbleed(host);
    if (bleedData && bleedData.logs && bleedData.logs.length > 0) {
      // Den neuesten Log-Eintrag analysieren
      const lastLog = bleedData.logs[bleedData.logs.length - 1].toLowerCase();
      ns.print(`[AccountsManager] Heartbleed-Feedback: "${lastLog}"`);

      if (lastLog.includes("higher")) {
        low = guess + 1; // Die gesuchte Zahl ist größer
      } else if (lastLog.includes("lower")) {
        high = guess - 1; // Die gesuchte Zahl ist kleiner
      } else {
        // Fallback: Falls im Log nichts steht, prüfen wir zur Sicherheit das result.data-Objekt
        const fallbackData = (result.data || "").toLowerCase();
        if (fallbackData.includes("higher")) low = guess + 1;
        else if (fallbackData.includes("lower")) high = guess - 1;
        else low++;
      }
    } else {
      // Wenn gar keine Logs da sind, linearer Schritt als absolute Notbremse
      low++;
    }

    // Dem Spiel-Framework Zeit zum Verarbeiten geben
    await ns.asleep(20);
  }

  ns.print(`❌ [AccountsManager] Zahl im Bereich [${low}-${high}] konnte nicht ermittelt werden.`);
  return null;
}