import { NS } from "@ns";

/**
 * Solver für DeskMemo - Extrahiert und testet Zahlenmuster aus dem Text-Hinweis.
 */
export async function solveDeskMemo(
  ns: NS,
  hostname: string,
  details: any,
): Promise<string | null> {
  const hint = details.passwordHint || "";

  // 1. Strategie: Alle Ziffern zusammenschreiben (Nicht-Ziffern \D werden gelöscht)
  const combined = hint.replace(/\D/g, "");
  if (combined) {
    const resCombined = await ns.dnet.authenticate(hostname, combined);
    if (resCombined.success) {
      ns.tprint(
        `[DeskMemo] Erfolgreich authentifiziert mit kombinierter Zahl: ${combined}`,
      );
      return combined; // Passwort für das Hauptskript/Loot zurückgeben
    }
  }

  // 2. Strategie: Einzelne Zahlenblöcke nacheinander durchtesten
  const sequences = hint.match(/\d+/g) || [];
  for (const seq of sequences) {
    const resSeq = await ns.dnet.authenticate(hostname, seq);
    if (resSeq.success) {
      ns.tprint(
        `[DeskMemo] Erfolgreich authentifiziert mit Zahlenblock: ${seq}`,
      );
      return seq; // Passwort zurückgeben
    }
  }

  ns.tprint(
    `🔴 [DeskMemo] Fehlgeschlagen. Keine Zahlenkombination aus dem Hinweis war korrekt.`,
  );
  return null;
}
