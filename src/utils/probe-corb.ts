import { NS } from "@ns";
import { patchState } from "/lib/state";

export async function main(ns: NS): Promise<void> {
  let hasCorp = false;
  try {
    hasCorp = ns.corporation.hasCorporation();
  } catch {}
  patchState(ns, { hasCorporation: hasCorp });
}