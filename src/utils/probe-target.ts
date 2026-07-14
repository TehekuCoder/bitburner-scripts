import { NS } from "@ns";
import { loadState, patchState } from "../core/state-manager.js";
import { findBestTarget } from "../lib/targeting.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  try {
    const currentState = loadState(ns);
    if (!currentState) {
      ns.print("WARN: Globaler State konnte nicht geladen werden.");
      return;
    }

    // 1. Hole die Serverliste direkt aus dem State (0 GB RAM statt ns.scan)
    const allServers = currentState.allServers || [];
    if (allServers.length === 0) {
      ns.print("WARN: Kernel hat noch keine Serverliste im State hinterlegt.");
      return;
    }

    // 2. Multiplikatoren aus deiner Datei lesen (ns.read kostet 0 GB RAM!)
    let bnMults = {};
    const filePath = "/bn-multipliers.txt";
    try {
      const fileContent = ns.read(filePath);
      if (fileContent) {
        bnMults = JSON.parse(fileContent);
      }
    } catch (err) {
      ns.print(`WARN: Konnte ${filePath} nicht lesen, nutze leeres Fallback-Objekt.`);
    }

    const player = ns.getPlayer(); // 0.50 GB RAM

    // 3. Bestes Target berechnen (ns.getServer wird in findBestTarget verwendet -> 2.00 GB RAM)
    const bestTarget = findBestTarget(ns, allServers, player, bnMults);

    if (bestTarget) {
      patchState(ns, { kernelTarget: bestTarget });
      ns.print(`SUCCESS: Bestes Target ermittelt und in State geschrieben: ${bestTarget}`);
    } else {
      ns.print("WARN: findBestTarget hat kein Ziel zurückgeliefert.");
    }
  } catch (error) {
    ns.print(`ERROR in probe-target.ts: ${error}`);
  }
}