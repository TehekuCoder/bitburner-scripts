import { NS } from "@ns";

/**
 * Solver für FreshInstall - Erkennt Standard-Passwörter anhand der Details.
 */
export async function solveFreshInstall(ns: NS, details: any): Promise<string | null> {
  const len = details.passwordLength;
  const isNumeric = details.isNumeric; 

  if (isNumeric) {
    if (len === 4) return "0000";
    if (len === 5) return "12345";
  } else {
    if (len === 5) return "admin";
    if (len === 8) return "password";
  }
  return null;
}