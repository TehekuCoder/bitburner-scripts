import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { DnetAuthAttemptState } from "/shared/types/network.js";
import { authenticateDnet } from "/infrastructure/runtime/dnet-state.js";
import {
  getKingOfTheHillCandidateRange,
  parseKingOfTheHillAltitude,
} from "./king-of-the-hill-policy.js";

export async function solveKingOfTheHill(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient,
  authAttemptState?: DnetAuthAttemptState,
): Promise<string | null> {
  let range: { minimum: number; maximum: number };
  try {
    range = getKingOfTheHillCandidateRange(
      details?.passwordLength || 1,
      details?.passwordFormat || "numeric",
    );
  } catch (error) {
    logger?.error(`🔴 KingOfTheHill konnte nicht vorbereitet werden: ${String(error)}`);
    return null;
  }

  let candidate = Math.floor((range.minimum + range.maximum) / 2);
  let step = Math.max(1, Math.floor((range.maximum - range.minimum) / 4));
  let bestCandidate = candidate;
  let bestAltitude = Number.NEGATIVE_INFINITY;
  let previousAltitude: number | null = null;
  let direction = 1;
  const tested = new Set<number>();
  const maxAttempts = Math.min(512, (range.maximum - range.minimum) + 1);

  logger?.info(
    `⛰️ Starte KingOfTheHill-Suche auf ${host} im Bereich ${range.minimum}-${range.maximum}...`,
  );

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    candidate = Math.max(range.minimum, Math.min(range.maximum, candidate));
    if (tested.has(candidate)) {
      candidate = candidate === range.maximum ? range.minimum : candidate + 1;
      continue;
    }
    tested.add(candidate);

    const password = String(candidate);
    const result = await authenticateDnet(
      ns,
      host,
      password,
      authAttemptState,
    );
    if (result.success) {
      logger?.success(`🎉 KingOfTheHill-Passwort gefunden: ${password}`);
      return password;
    }

    const heartbeat = await ns.dnet.heartbleed(host, { peek: true });
    const feedback = parseKingOfTheHillAltitude(heartbeat.logs || []);
    if (!feedback) {
      logger?.debug(`Kein Höhenfeedback für Kandidat ${password}.`);
      step = Math.max(1, Math.floor(step / 2));
      candidate += step;
      continue;
    }

    const currentAltitude = feedback.altitude;
    if (currentAltitude > bestAltitude) {
      bestAltitude = currentAltitude;
      bestCandidate = candidate;
    }

    if (previousAltitude === null) {
      candidate += direction * step;
      previousAltitude = currentAltitude;
    } else if (currentAltitude > previousAltitude) {
      candidate += direction * step;
      previousAltitude = currentAltitude;
    } else if (currentAltitude < previousAltitude) {
      direction *= -1;
      step = Math.max(1, Math.floor(step / 2));
      candidate += direction * step;
      previousAltitude = currentAltitude;
    } else {
      step = Math.max(1, Math.floor(step / 2));
      candidate += direction * step;
    }
  }

  logger?.warn(
    `KingOfTheHill: Kein Erfolg; bester Kandidat ${bestCandidate} mit Höhe ${bestAltitude}.`,
  );
  return null;
}
