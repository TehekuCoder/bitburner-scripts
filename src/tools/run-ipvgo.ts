import { NS } from "@ns";
import { PATHS } from "/infrastructure/runtime/paths.js";

export async function main(ns: NS): Promise<void> {
  const opponent = ns.args[0] || "Netburners";
  const boardSize = ns.args[1] || 5;

  const script = "services/managers/ipvgo-manager.js";

  if (ns.isRunning(script, "home")) {
    ns.scriptKill(script, "home");
  }

  const pid = ns.run(script, 1, opponent, boardSize);
  if (pid > 0) {
    ns.tprint(`🚀 IPvGo-Manager gestartet gegen '${opponent}' (${boardSize}x${boardSize}).`);
  } else {
    ns.tprint("❌ Fehler beim Starten des IPvGo-Managers.");
  }
}