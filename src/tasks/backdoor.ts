import { NS, Server } from "@ns";
import { getAllServers, findPathTo } from "../lib/network.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (ns.singularity === undefined) {
    ns.print("🛑 [BACKDOOR] Singularity API nicht verfügbar (SF4 fehlt).");
    return;
  }

  const allowBitNodeExit = ns.args[0] === "APOCALYPSE";
  const allServers: string[] = getAllServers(ns);
  const myHackLevel: number = ns.getHackingLevel();
  let targetsFound = 0;

  ns.print(`====== INFILTRATION RUN: ${new Date().toLocaleTimeString()} ======`);
  if (allowBitNodeExit) {
    ns.print("⚠️ [WARN] BitNode-Zerstörung (w0r1d_d43m0n) ist AKTIVIERT!");
  }

  for (const target of allServers) {
    if (
      target === "darkweb" ||
      target === "Darknet" ||
      target.startsWith("hacknet-node") ||
      target === "home"
    )
      continue;

    if (target === "w0r1d_d43m0n" && !allowBitNodeExit) continue;
    if (!ns.serverExists(target)) continue;
    
    const srv: Server = ns.getServer(target);

    if (!srv.backdoorInstalled && !srv.purchasedByPlayer && srv.hasAdminRights) {
      const reqHackingSkill = srv.requiredHackingSkill ?? 0;

      if (myHackLevel >= reqHackingSkill) {
        targetsFound++;
        ns.print(`[AUTO-BACKDOOR] Starte Infiltration von: ${target}`);

        const path: string[] | null = findPathTo(ns, target);
        if (path) {
          try {
            // 🟢 Zuerst immer nach Hause springen, um eine valide Routing-Basis zu haben!
            ns.singularity.connect("home");
            
            for (const node of path) {
              ns.singularity.connect(node);
            }

            ns.print(`Installiere Backdoor auf ${target}...`);
            await ns.singularity.installBackdoor();
            ns.print(`[AUTO-BACKDOOR] ✅ ${target} erfolgreich infiltriert.`);
          } catch (e: unknown) {
            ns.print(`[AUTO-BACKDOOR] ❌ Fehler bei ${target}: ${String(e)}`);
          } finally {
            ns.singularity.connect("home");
          }
          await ns.sleep(500);
        }
      }
    }
  }

  if (targetsFound === 0) {
    ns.print("Status: Keine neuen infiltrierbaren Systeme gefunden.");
  } else {
    ns.print(`Status: Infiltrations-Sprint beendet. ${targetsFound} Systeme gesichert.`);
  }
}