import { NS } from "@ns";
import { drawProgress } from "/utils/progress";

export async function solveNIL(
  ns: NS,
  hostname: string,
  details: any,
): Promise<string | null> {
  const len = details?.passwordLength || 5;
  const digits = new Array(len).fill(0);
  const locked = new Array(len).fill(false);

  let attempts = 0;
  const maxAttempts = len * 12; // Sicherheitsnetz gegen Endlosschleifen

  while (locked.includes(false) && attempts < maxAttempts) {
    attempts++;
    const guess = digits.join("");

    const currentLocked = locked.filter(Boolean).length;
    drawProgress(ns, hostname, currentLocked, len, "NIL-Locking");

    const result = (await ns.dnet.authenticate(hostname, guess)) as any;
    if (result?.success) {
      ns.print(`🎉 [NIL] Blitz-Erfolg: ${guess}`);
      return guess;
    }

    // Heartbleed-Log isolieren
    let logObj: any = null;
    for (let check = 0; check < 10; check++) {
      const bleed = (await ns.dnet.heartbleed(hostname)) as any;
      const logs: string[] = bleed?.logs || [];

      for (let i = logs.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(logs[i]);
          if (parsed && String(parsed.passwordAttempted) === guess) {
            logObj = parsed;
            break;
          }
        } catch {
          /* Ignoriere fehlerhafte Logs */
        }
      }

      if (logObj) break;
      await ns.sleep(20);
    }

    if (!logObj || !logObj.data) {
      await ns.sleep(30);
      continue;
    }

    // Feedback verarbeiten
    const feedback: string[] = Array.isArray(logObj.data)
      ? logObj.data.map((v: unknown) => String(v).trim().toLowerCase())
      : typeof logObj.data === "string"
      ? logObj.data.split(",").map((v: string) => v.trim().toLowerCase())
      : [];

    // Inkrementiere nur noch nicht gesperrte (unlocked) Ziffern
    for (let i = 0; i < len; i++) {
      const val = feedback[i];
      if (val === "yes" || val === "true" || val === "1") {
        locked[i] = true;
      } else if (!locked[i]) {
        digits[i] = (digits[i] + 1) % 10;
      }
    }

    await ns.sleep(10);
  }

  // Finaler Validierungsversuch
  const finalGuess = digits.join("");
  const finalResult = (await ns.dnet.authenticate(hostname, finalGuess)) as any;
  if (finalResult?.success) {
    ns.print(`🎉 [NIL] Erfolgreich geknackt: ${finalGuess}`);
    return finalGuess;
  }

  ns.print(`🔴 [NIL] Rekonstruiertes Passwort '${finalGuess}' wurde abgelehnt.`);
  return null;
}