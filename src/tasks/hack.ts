import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const target = ns.args[0] as string;
  const delay = (ns.args[1] as number) ?? 0;
  const batchId = (ns.args[2] as string) ?? "LEGACY";

  // delay wird direkt als Option an die Spiel-Engine übergeben
  await ns.hack(target, { additionalMsec: delay });
}
