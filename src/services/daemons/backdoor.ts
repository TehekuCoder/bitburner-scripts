import { NS, Server } from "@ns";
import { getAllServers, findPathTo } from "/infrastructure/network/network";
import { loadState } from "/infrastructure/state/state";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new LoggerClient(ns, "BACKDOOR", undefined, "INFO");

  if (ns.singularity === undefined) {
    logger.error("Singularity API nicht verfügbar (SourceFile 4 fehlt).");
    ns.tprint("🛑 [BACKDOOR] Singularity API nicht verfügbar (SourceFile 4 fehlt).");
    return;
  }

  logger.info("Backdoor-Daemon gestartet.");
  ns.tprint("🚀 Backdoor-Daemon erfolgreich im Hintergrund verankert.");

  while (true) {
    // 🟢 Liest den State aus, falls die Apocalypse-Strategie global getriggert wurde
    const currentState = loadState(ns) as Record<string, any> | null;
    const allowBitNodeExit = ns.args[0] === "APOCALYPSE" || currentState?.strategy === "APOCALYPSE";
    
    // Netzwerk frisch einlesen, falls der Crawler neue Server gefunden hat
    const allServers: string[] = getAllServers(ns);
    
    // 🟢 WICHTIG: Level im Loop abgreifen, da es sich im laufenden Betrieb erhöht
    const myHackLevel: number = ns.getHackingLevel();
    let targetsFound = 0;
    let installedCount = 0;

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

      // Nur infiltrieren, wenn adminRights da sind, aber noch kein Backdoor existiert
      if (!srv.backdoorInstalled && !srv.purchasedByPlayer && srv.hasAdminRights) {
        const reqHackingSkill = srv.requiredHackingSkill ?? 0;

        if (myHackLevel >= reqHackingSkill) {
          targetsFound++;
          const targetLogger = logger.forTarget(target);
          targetLogger.info("Backdoor-Installation gestartet.", undefined, {
            context: { requiredHackingSkill: reqHackingSkill, myHackLevel },
          });
          ns.print(`[AUTO-BACKDOOR] Starte Infiltration von: ${target}`);

          const path: string[] | null = findPathTo(ns, target);
          if (path) {
            try {
              // Zur Sicherheit immer von 'home' aus routen
              ns.singularity.connect("home");
              
              for (const node of path) {
                ns.singularity.connect(node);
              }

              ns.print(`Installiere Backdoor auf ${target}...`);
              // Blockiert den Loop exakt so lange, wie die Installation dauert
              await ns.singularity.installBackdoor();
              installedCount++;
              targetLogger.success("Backdoor erfolgreich installiert.");
              ns.print(`[AUTO-BACKDOOR] ✅ ${target} erfolgreich infiltriert.`);
            } catch (e: unknown) {
              targetLogger.error("Backdoor-Installation fehlgeschlagen.", undefined, {
                context: { error: String(e) },
              });
              ns.print(`[AUTO-BACKDOOR] ❌ Fehler bei ${target}: ${String(e)}`);
            } finally {
              // Nach Erfolg oder Fehler bedingungslos zurück nach Hause springen
              ns.singularity.connect("home");
            }
            // Kurze Atempause zwischen zwei Installationen
            await ns.sleep(1000);
          } else {
            targetLogger.warn("Kein Netzwerkpfad zum Ziel gefunden.");
          }
        }
      }
    }

    if (installedCount > 0) {
      logger.info(`Backdoor-Durchlauf abgeschlossen: ${installedCount} System(e) gesichert.`, undefined, {
        context: { installedCount, eligibleTargets: targetsFound },
      });
      ns.print(`[${new Date().toLocaleTimeString()}] Infiltrations-Sprint beendet. ${installedCount} neue Systeme gesichert.`);
    }

    // 🟢 60 Sekunden schlafen. Hält das Skript aktiv (Kernel blockiert Spawn) 
    // und schont die CPU massiv.
    await ns.sleep(60000);
  }
}