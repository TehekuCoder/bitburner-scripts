import { NS } from "@ns";

export async function solvePr0verFl0(
  ns: NS,
  host: string,
  details: any
): Promise<string | null> {
  const len = details?.passwordLength || 8;

  // Typische Buffer-Overflow Testmuster
  const payloads = [
    "A".repeat(len * 2),
    "A".repeat(len + 1),
    "A".repeat(len),
    "0".repeat(len * 2),
  ];

  ns.print(`🌊 [Pr0verFl0] Sende Buffer-Overflow Payloads an ${host}...`);

  for (const payload of payloads) {
    const result = (await ns.dnet.authenticate(host, payload)) as any;
    if (result?.success) {
      ns.print(`🎉 [Pr0verFl0] Overflow erfolgreich mit Payload-Länge ${payload.length}`);
      return payload;
    }
  }

  ns.print(`🔴 [Pr0verFl0] Overflow-Versuche auf ${host} fehlgeschlagen.`);
  return null;
}