import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { DnetAuthAttemptState } from "/shared/types/network.js";
import { authenticateDnet } from "/infrastructure/runtime/dnet-state.js";

/**
 * Solver für AccountsManager - Nutzt eine binäre Suche basierend auf Feedback.
 */
export async function solveAccountsManager(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient,
  authAttemptState?: DnetAuthAttemptState,
): Promise<string | null> {
  let low = 0;
  let high = 100; // Standard-Fallback

  logger?.info(`🔢 Starte High/Low-Solver für AccountsManager auf ${host}...`);

  // 1. Testschuss abgeben, um Bereich und erste Meldung zu prüfen
  const initResult = await authenticateDnet(ns, host, "0", authAttemptState);

  if (initResult?.code === 351) {
    logger?.error(`❌ [AccountsManager] Fehler auf ${host}: Direct Connection Required!`);
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
      logger?.debug(`🎯 Suchbereich via Nachricht erkannt: [${low} bis ${high}]`);
    }
  }

  if (low === 0) low = 1;

  // 2. Binäre Suche
  while (low <= high) {
    const guess = Math.floor((low + high) / 2);
    logger?.debug(`Teste Kandidat im Bereich [${low}-${high}].`);

    const result = await authenticateDnet(
      ns,
      host,
      guess.toString(),
      authAttemptState,
    );

    if (result?.code === 351) {
      logger?.error(`❌ Fehler auf ${host}: Direct Connection Required!`);
      return null;
    }

    if (result?.success) {
      logger?.success("🎉 Kandidat erfolgreich authentifiziert.");
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
      // Heartbleed fehlgeschlagen oder nicht unterstützt
    }

    feedback = feedback.toLowerCase();
    logger?.debug(`Combined Feedback: "${feedback.trim()}"`);

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
      logger?.warn(`⚠️ Keinen eindeutigen Hinweis im Feedback gefunden.`);
      return null;
    }

    await ns.asleep(20);
  }

  logger?.error(`❌ Zahl im Bereich konnte nicht ermittelt werden.`);
  return null;
}