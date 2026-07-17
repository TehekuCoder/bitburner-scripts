import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string;
  if (!target) return;

  // Keine Übergabe von ns.args[1] in additionalMsec! Einfach sofort ausführen.
  await ns.weaken(target);
}