import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.dnet.setStasisLink(); // Friert den aktuellen Server ein
}