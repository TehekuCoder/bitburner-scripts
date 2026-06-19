import { NS } from "@ns";

export async function solveFreshInstall(ns: NS, host: string, details: any): Promise<string | null> {
  const len = details.passwordLength;
  const isNumeric = details.isNumeric || details.passwordFormat === "numeric"; 

  if (isNumeric) {
    if (len === 4) return "0000";
    if (len === 5) return "12345";
  } else {
    if (len === 5) return "admin";
    if (len === 8) return "password";
  }
  return null;
}