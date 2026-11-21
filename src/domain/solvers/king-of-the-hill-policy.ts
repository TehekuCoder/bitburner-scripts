export interface KingOfTheHillAltitude {
  altitude: number;
  passwordAttempted?: number;
}

export function parseKingOfTheHillAltitude(logs: unknown[]): KingOfTheHillAltitude | null {
  for (let index = logs.length - 1; index >= 0; index--) {
    const raw = logs[index];
    let text = "";
    if (typeof raw === "string") {
      text = raw;
    } else if (raw && typeof raw === "object") {
      text = JSON.stringify(raw);
    }

    const altitudeMatch = text.match(/current altitude:\s*([\d,.]+)\s*m/i)
      ?? text.match(/(?:data["']?\s*[:=]\s*["']?)([\d,.]+)/i);
    if (!altitudeMatch) continue;

    const altitude = Number(altitudeMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(altitude)) continue;

    const attemptedMatch = text.match(/passwordAttempted["']?\s*[:=]\s*["']?(\d+)/i);
    return {
      altitude,
      passwordAttempted: attemptedMatch
        ? Number(attemptedMatch[1])
        : undefined,
    };
  }
  return null;
}

export function getKingOfTheHillCandidateRange(
  passwordLength: number,
  passwordFormat: string,
): { minimum: number; maximum: number } {
  if (passwordFormat !== "numeric") {
    throw new Error(`KingOfTheHill unterstützt nur numerische Passwörter, erhalten: ${passwordFormat}`);
  }
  const length = Math.max(1, Math.floor(passwordLength || 1));
  if (length > 6) {
    throw new Error(`KingOfTheHill Passwortlänge ${length} ist für die Suche zu groß`);
  }
  return {
    minimum: length === 1 ? 0 : Math.pow(10, length - 1),
    maximum: Math.pow(10, length) - 1,
  };
}
