import { NS, Server } from "@ns";
// 1. ZENTRALE FUNKTIONEN IMPORTIEREN
import { getAllServers, findPathTo } from "../lib/network.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  // Wichtig: w0r1d_d43m0n beendet das aktuelle BitNode!
  const priorityTargets: string[] = [
    "CSEC",
    "avmnite-02h",
    "I.I.I.I",
    "run4theh111z",
    "fulcrumassets",
    "w0r1d_d43m0n",
  ];
  const AUTO_RAM_THRESHOLD = 128;
  const AUTO_CORES_THRESHOLD = 3;

  while (true) {
    const home: Server = ns.getServer("home") as Server;
    // 2. NUTZE DIE GENERISCHE LIB-FUNKTION
    const allServers: string[] = getAllServers(ns);
    const myHackLevel: number = ns.getHackingLevel();

    const homeRam: number = home.maxRam ?? 0;
    const homeCores: number = home.cpuCores ?? 1;

    const fullAutoMode: boolean =
      homeRam >= AUTO_RAM_THRESHOLD && homeCores >= AUTO_CORES_THRESHOLD;
    const midAutoMode: boolean = homeCores === 2;

    ns.print(`--- Scan-Zyklus: ${new Date().toLocaleTimeString()} ---`);
    ns.print(
      `Status: ${fullAutoMode ? "VOLL-AUTO" : midAutoMode ? "MID-AUTO (3-Port)" : "NUR PRIORITÄTEN"}`,
    );
    ns.print(`Hardware: ${homeCores} Cores | ${ns.format.ram(homeRam)} RAM`);

    let targetsFound = 0;

    for (const target of allServers) {
      if (
        target === "darkweb" ||
        target === "Darknet" ||
        target.startsWith("hacknet-node")
      )
        continue;
      if (!ns.serverExists(target)) continue;

      const srv: Server = ns.getServer(target) as Server;
      const isPriority: boolean = priorityTargets.includes(target);

      const openPortsReq: number = srv.numOpenPortsRequired ?? 0;
      const reqHackingSkill: number = srv.requiredHackingSkill ?? 0;

      const shouldBackdoor: boolean =
        isPriority || fullAutoMode || (midAutoMode && openPortsReq <= 3);

      if (
        shouldBackdoor &&
        !srv.backdoorInstalled &&
        !srv.purchasedByPlayer &&
        target !== "home"
      ) {
        if (!srv.hasAdminRights) continue;

        if (myHackLevel >= reqHackingSkill) {
          targetsFound++;
          ns.tprint(`[AUTO-BACKDOOR] Ziel identifiziert: ${target}`);

          // 3. SEAMLESS REPLACEMENT DER PFADFINDUNG
          const path: string[] | null = findPathTo(ns, target);
          if (path) {
            try {
              for (const node of path) ns.singularity.connect(node);

              ns.print(`Infiltriere ${target}...`);
              await ns.singularity.installBackdoor();
              ns.tprint(
                `[AUTO-BACKDOOR] ✅ ${target} erfolgreich infiltriert.`,
              );
            } catch (e: unknown) {
              ns.tprint(
                `[AUTO-BACKDOOR] ❌ Fehler bei ${target}: ${String(e)}`,
              );
            } finally {
              ns.singularity.connect("home");
            }
            await ns.sleep(1000);
          }
        }
      }
    }

    if (targetsFound === 0) {
      ns.print("Status: Alle Ziele gemäß Policy gesichert.");
    }

    await ns.sleep(30000);
  }
}
