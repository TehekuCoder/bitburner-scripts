import { NS, AutocompleteData } from "@ns";
import { getAllServers } from "/infrastructure/network/network";
import { PATHS } from "/infrastructure/runtime/paths";
import { patchStrategyState } from "/infrastructure/state/state";
import { BotStrategy } from "/shared/types/strategy";

// Definition aller CLI-Flags für Parsing und Terminal-Autocomplete
const FLAG_SCHEMA: [string, string | boolean | number | string[]][] = [
  ["help", false],
  ["no-sweep", false],
  ["no-boot", false],
  ["no-kernel", false],
  ["manual", false],
  ["strategy", ""],
  ["disable-gang", false],
  ["disable-sleeve", false],
  ["disable-corp", false],
  ["disable-bladeburner", false],
  ["disable-hacknet", false],
  ["disable-stock", false],
  ["disable-batcher", false],
];

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  data.flags(FLAG_SCHEMA);
  return [];
}

function printHelp(ns: NS): void {
  ns.print("=================================================");
  ns.print(" ⚡ BitOS Starter - Argumente & Optionen ");
  ns.print("=================================================");
  ns.print("BOOT-PHASEN:");
  ns.print(
    "  --no-sweep          Überspringt das Beenden von Prozessen & Network Sweep",
  );
  ns.print(
    "  --no-boot           Überspringt die Ausführung der Boot-Init-Phase",
  );
  ns.print("  --no-kernel         Überspringt das Starten des Core-Kernels");
  ns.print("");
  ns.print("STRATEGIE & MODUS:");
  ns.print("  --manual            Aktiviert den manuellen Steuerungsmodus");
  ns.print(
    "  --strategy <MODE>   Setzt Start-Strategie (MONEY, REP, KARMA, etc.)",
  );
  ns.print("");
  ns.print("MODULE DEAKTIVIEREN:");
  ns.print("  --disable-gang      Deaktiviert das Gang-Management");
  ns.print("  --disable-sleeve    Deaktiviert das Sleeve-Management");
  ns.print("  --disable-corp      Deaktiviert das Corporation-Management");
  ns.print("  --disable-bladeburner Deaktiviert Bladeburner");
  ns.print("  --disable-hacknet   Deaktiviert Hacknet-Upgrades");
  ns.print("  --disable-stock     Deaktiviert Börsen-Handel");
  ns.print("  --disable-batcher   Deaktiviert Hacking-Batcher");
  ns.print("=================================================");
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.clearLog();
  ns.ui.openTail();
  ns.ui.setTailTitle("Bootsequenz eingeleitet");
  ns.ui.resizeTail(400, 520);

  const flags = ns.flags(FLAG_SCHEMA);

  if (flags.help) {
    printHelp(ns);
    return;
  }

  ns.print("====================================");
  ns.print("    BitOS v3.0 - BOOT SEQUENCE      ");
  ns.print("====================================");
  await ns.sleep(200);

  // --- 0. STATE & CONFIGURATION SETUP ---
  const disabledModules: string[] = [];
  if (flags["disable-gang"]) disabledModules.push("gang");
  if (flags["disable-sleeve"]) disabledModules.push("sleeve");
  if (flags["disable-corp"]) disabledModules.push("corporation");
  if (flags["disable-bladeburner"]) disabledModules.push("bladeburner");
  if (flags["disable-hacknet"]) disabledModules.push("hacknet");
  if (flags["disable-stock"]) disabledModules.push("stock");
  if (flags["disable-batcher"]) disabledModules.push("batcher");

  const strategyPatch: Record<string, any> = {};

  if (disabledModules.length > 0) {
    strategyPatch.disabledModules = disabledModules;
    ns.print(`[CONFIG] Deaktivierte Module: ${disabledModules.join(", ")}`);
  }

  if (flags.manual) {
    strategyPatch.manualMode = true;
    strategyPatch.strategy = "MANUAL" as BotStrategy;
    ns.print("[CONFIG] Manueller Modus erzwungen.");
  } else if (
    typeof flags.strategy === "string" &&
    flags.strategy.trim() !== ""
  ) {
    strategyPatch.strategy = flags.strategy.toUpperCase() as BotStrategy;
    ns.print(`[CONFIG] Strategie gesetzt auf: ${strategyPatch.strategy}`);
  }

  if (Object.keys(strategyPatch).length > 0) {
    patchStrategyState(ns, strategyPatch);
  }

  // --- 1. PRE-BOOT CLEAN SWEEP ---
  if (!flags["no-sweep"]) {
    ns.print("[...] Performing Pre-Boot Clean Sweep...");

    const currentPid = ns.pid;
    const homeProcs = ns.ps("home");
    let killedHomeCount = 0;

    for (const proc of homeProcs) {
      if (proc.pid !== currentPid) {
        ns.kill(proc.pid);
        killedHomeCount++;
      }
    }
    if (killedHomeCount > 0) {
      ns.print(
        `[ OK ] Terminated ${killedHomeCount} active processes on 'home'.`,
      );
    }

    try {
      const allServers = getAllServers(ns);
      let clearedHostsCount = 0;

      for (const server of allServers) {
        if (server !== "home") {
          if (ns.killall(server)) {
            clearedHostsCount++;
          }
        }
      }
      ns.print(
        `[ OK ] Network swept clean (${clearedHostsCount} active servers stopped).`,
      );
    } catch {
      ns.print(
        "[WARN] Full network sweep failed. Falling back to purchased servers clear.",
      );
      try {
        const purchasedServers = ns.cloud.getServerNames();
        for (const server of purchasedServers) {
          ns.killall(server);
        }
        ns.print("[ OK ] Purchased server fleet cleared.");
      } catch {
        ns.print(
          "[WARN] Could not clear purchased servers during early boot stage.",
        );
      }
    }
  } else {
    ns.print("[SKIP] Pre-Boot Clean Sweep übersprungen.");
  }

  await ns.sleep(200);

  // --- 2. ENVIRONMENT LAYER ---
  if (!flags["no-boot"]) {
    ns.print("[...] Initializing Environment Layer...");
    if (ns.fileExists(PATHS.app.orchestration.boot, "home")) {
      const initPid = ns.run(PATHS.app.orchestration.boot, 1);
      if (initPid > 0) {
        while (ns.isRunning(initPid)) {
          await ns.sleep(50);
        }
        ns.print("[ OK ] BitNode environment successfully indexed.");
      } else {
        ns.print("[WARN] Initializer failed to launch. RAM shortage?");
      }
    } else {
      ns.print(
        `[WARN] ${PATHS.app.orchestration.boot} not found. Skipping init stage.`,
      );
    }
  } else {
    ns.print("[SKIP] Environment Layer übersprungen.");
  }

  await ns.sleep(200);

  // --- 3. HARDWARE-EBENE (sys-kernel) ---
  if (!flags["no-kernel"]) {
    ns.print("[...] Launching Core Kernel...");
    if (ns.fileExists(PATHS.app.orchestration.kernel, "home")) {
      const kernelPid = ns.run(PATHS.app.orchestration.kernel, 1);
      if (kernelPid > 0) {
        ns.print(
          `[ OK ] ${PATHS.app.orchestration.kernel} successfully launched.`,
        );
      } else {
        ns.print(
          `[FAIL] CRITICAL ERROR: Could not launch ${PATHS.app.orchestration.kernel}!`,
        );
      }
    } else {
      ns.alert(`CRITICAL ERROR: ${PATHS.app.orchestration.kernel} not found!`);
      return;
    }
  } else {
    ns.print("[SKIP] Core Kernel Launch übersprungen.");
  }

  await ns.sleep(200);

  ns.print("====================================");
  ns.print("     BOOT COMPLETELY DELEGATED      ");
  ns.print("====================================");
}
