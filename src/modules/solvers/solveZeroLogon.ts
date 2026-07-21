import { NS } from "@ns";

export async function solveZeroLogon(
  ns: NS,
  host: string,
  details: any
): Promise<string | null> {
  const len = details?.passwordLength;
  
  // Kandidaten für ZeroLogon Bypass
  const candidates = [
    "",
    "0",
    "00000000",
    len ? "0".repeat(len) : "",
  ];

  const uniqueCandidates = [...new Set(candidates)];

  for (const guess of uniqueCandidates) {
    const result = (await ns.dnet.authenticate(host, guess)) as any;
    if (result?.success) {
      ns.print(`🎉 [ZeroLogon] Bypass erfolgreich mit: "${guess}"`);
      return guess;
    }
  }

  ns.print(`🔴 [ZeroLogon] Bypass auf ${host} fehlgeschlagen.`);
  return null;
}