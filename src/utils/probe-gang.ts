import { NS } from "@ns";
import { patchState } from "lib/state.js";

export async function main(ns: NS): Promise<void> {
  let inGang = false;
  try {
    inGang = ns.gang.inGang();
  } catch {}
  patchState(ns, { hasGang: inGang });
}