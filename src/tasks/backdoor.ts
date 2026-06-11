import { NS, Server } from "@ns";
import { getAllServers, findPathTo } from "../lib/network.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  // --- SAFE ENVIRONMENT LAYER (Singularity Check) ---
  if (ns.singularity === undefined) {
    ns.print("🛑 [BACKDOOR] Singularity API nicht verfügbar (SF4 fehlt).");
    ns.print("               Dienst wird beendet.");
    return;
  }

  // Sicherheitsfeature: BitNode-Zerstörung nur, wenn das Skript mit dem Argument "APOCALYPSE" gestartet wurde
  const allowBitNodeExit = ns.args[0] === "APOCALYPSE";

  const priorityTargets: string[] = [
    "CSEC",         // CyberSec
    "avmnite-02h",  // NiteSec
    "I.I.I.I",      // The Black Hand
    "run4theh111z", // BitRunners
    "fulcrumassets" // Fulcrum Secret Technologies
  ];

  while (true) {
    const allServers: string[] = getAllServers(ns);
    const myHackLevel: number = ns.getHackingLevel();
    let targetsFound = 0;

    ns.print(`--- Scan-Zyklus: ${new Date().toLocaleTimeString()} ---`);
    ns.print(`Modus: ADAPTIVE INFILTRATION`);
    if (allowBitNodeExit) {
      ns.print("⚠️ [WARN] BitNode-Zerstörung (w0r1d_d43m0n) ist AKTIVIERT!");
    }

    for (const target of allServers) {
      // Ignoriere ungeeignete Ziele
      if (
        target === "darkweb" || 
        target === "Darknet" || 
        target.startsWith("hacknet-node") ||
        target === "home"
      ) continue;

      // Spezialfall: Welt-Daemon vor versehentlichem Trigger schützen
      if (target === "w0r1d_d43m0n" && !allowBitNodeExit) {
        continue;
      }

      if (!ns.serverExists(target)) continue;
      const srv: Server = ns.getServer(target);

      // STRATEGIE: Wenn wir Root-Rechte haben und das Hacking-Level reicht,
      // installieren wir IMMER das Backdoor. Keine künstlichen RAM-Sperren mehr!
      if (!srv.backdoorInstalled && !srv.purchasedByPlayer && srv.hasAdminRights) {
        const reqHackingSkill = srv.requiredHackingSkill ?? 0;

        if (myHackLevel >= reqHackingSkill) {
          targetsFound++;
          ns.tprint(`[AUTO-BACKDOOR] Starte Infiltration von: ${target}`);

          const path: string[] | null = findPathTo(ns, target);
          if (path) {
            try {
              // Pfad ablaufen
              for (const node of path) {
                ns.singularity.connect(node);
              }

              ns.print(`Installiere Backdoor auf ${target}...`);
              await ns.singularity.installBackdoor();
              ns.tprint(`[AUTO-BACKDOOR] ✅ ${target} erfolgreich infiltriert.`);
            } catch (e: unknown) {
              ns.tprint(`[AUTO-BACKDOOR] ❌ Fehler bei ${target}: ${String(e)}`);
            } finally {
              // Absolute Sicherheit: Wir springen unter allen Umständen zurück nach Hause
              ns.singularity.connect("home");
            }
            // Kurze Pause zwischen Systemeingriffen
            await ns.sleep(1000);
          }
        }
      }
    }

    if (targetsFound === 0) {
      ns.print("Status: Alle erreichbaren Systeme sind kompromittiert und gesichert.");
    }

    // 30 Sekunden schlafen bis zum nächsten Netzwerk-Scan
    await ns.sleep(30000);
  }
}