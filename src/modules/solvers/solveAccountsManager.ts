import { NS } from "@ns";

/**
 * Solver für AccountsManager - Nutzt eine binäre Suche basierend auf Feedback.
 */
export async function solveAccountsManager(
  ns: NS,
  host: string,
  details: any
): Promise<string | null> {
  let low = 0;
  let high = 100; // Standard-Fallback

  ns.print(`🔢 Starte High/Low-Solver für AccountsManager auf ${host}...`);

  // 1. Testschuss abgeben, um Bereich und erste Meldung zu prüfen
  const initResult = (await ns.dnet.authenticate(host, "0")) as any;

  if (initResult?.code === 351) {
    ns.print(`❌ [AccountsManager] Fehler auf ${host}: Direct Connection Required!`);
    return null;
  }

  if (initResult?.success) {
    return "0";
  }

  // Grenzen dynamisch extrahieren (z.B. "between 0 and 100")
  if (initResult?.message) {
    const match = initResult.message.match(/between (\d+) and (\d+)/i);
    if (match) {
      low = parseInt(match[1], 10);
      high = parseInt(match[2], 10);
      ns.print(`🎯 Suchbereich via Nachricht erkannt: [${low} bis ${high}]`);
    }
  }

  // Da "0" falsch war, können wir die Untergrenze mindestens auf 1 anheben
  if (low === 0) low = 1;

  // 2. Binäre Suche
  while (low <= high) {
    const guess = Math.floor((low + high) / 2);
    ns.print(`[AccountsManager] Teste Zahl: ${guess} (Bereich: [${low}-${high}])`);

    const result = (await ns.dnet.authenticate(host, guess.toString())) as any;

    if (result?.code === 351) {
      ns.print(`❌ [AccountsManager] Fehler auf ${host}: Direct Connection Required!`);
      return null;
    }

    if (result?.success) {
      ns.print(`🎉 [AccountsManager] Erfolg! Passwort ist: ${guess}`);
      return guess.toString();
    }

    // 🔍 Alle Feedback-Quellen bündeln (message, data & heartbleed)
    let feedback = "";
    if (result?.message) feedback += " " + result.message;
    if (result?.data) feedback += " " + String(result.data);

    try {
      const bleedData = await ns.dnet.heartbleed(host);
      if (bleedData?.logs?.length) {
        feedback += " " + bleedData.logs.join(" ");
      }
    } catch (_) {
      // Falls Heartbleed fehlschlägt oder nicht unterstützt wird
    }

    feedback = feedback.toLowerCase();
    ns.print(`[AccountsManager] Combined Feedback: "${feedback.trim()}"`);

    // Richtung auswerten
    if (
      feedback.includes("higher") ||
      feedback.includes("greater") ||
      feedback.includes("above")
    ) {
      low = guess + 1;
    } else if (
      feedback.includes("lower") ||
      feedback.includes("smaller") ||
      feedback.includes("below")
    ) {
      high = guess - 1;
    } else {
      ns.print(`⚠️ [AccountsManager] Keinen eindeutigen Hinweis im Feedback gefunden.`);
      return null; // Kontrollierter Abbruch statt low++
    }

    await ns.asleep(20);
  }

  ns.print(`❌ [AccountsManager] Zahl im Bereich konnte nicht ermittelt werden.`);
  return null;
}