import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string;
  const sleepTime = (ns.args[1] as number) || 0; // Delay vor der Action
  
  if (sleepTime > 0) {
    await ns.sleep(sleepTime);
  }
  await ns.weaken(target);
}
