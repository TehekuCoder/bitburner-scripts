import { NS } from "@ns";
import { patchState } from "../core/state-manager.js";

export async function main(ns: NS): Promise<void> {
  let hasCorp = false;
  try {
    hasCorp = ns.corporation.hasCorporation();
  } catch {}
  patchState(ns, { hasCorporation: hasCorp });
}