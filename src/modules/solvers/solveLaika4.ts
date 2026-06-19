import { NS } from "@ns";

export async function solveLaika4(ns: NS, host: string, details: any): Promise<string[]> {
  const len = details.passwordLength;

  if (len === 3) return ["max"];
  if (len === 5) return ["rover"];
  if (len === 4) return ["fido", "spot"]; // Beide ausprobieren

  return [];
}