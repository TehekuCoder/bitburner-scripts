import { NS } from "@ns";
import { JitEvent } from "core/types";
import { HOME_RAM_RESERVE } from "./constants.js";

export function getNetworkMaxRam(ns: NS, servers: string[]): number {
  let total = servers
    .filter((s) => ns.hasRootAccess(s) && s !== "home")
    .reduce((sum, s) => sum + ns.getServerMaxRam(s), 0);

  total += Math.max(0, ns.getServerMaxRam("home") - HOME_RAM_RESERVE);
  return total;
}

export function getNetworkRealFreeRam(ns: NS, servers: string[]): number {
  let free = servers
    .filter((s) => ns.hasRootAccess(s) && s !== "home")
    .reduce((sum, s) => sum + (ns.getServerMaxRam(s) - ns.getServerUsedRam(s)), 0);

  free += Math.max(0, ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - HOME_RAM_RESERVE);
  return free;
}

export function getQueueRam(ns: NS, queue: JitEvent[]): number {
  return queue.reduce((sum, ev) => sum + ev.threads * ns.getScriptRam(ev.script), 0);
}