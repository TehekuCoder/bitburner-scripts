import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { loadState } from "/infrastructure/state/state";

/**
 * Stanek's Gift Manager & Continuous Charger
 */
export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  // Logger mit Standard-Tag 'stanek' initialisieren für einfaches Filtern
  const logger = new LoggerClient(
    ns,
    "StanekManager",
    undefined,
    "DEBUG",
    1,
    {},
    ["stanek"]
  );

  logger.info("⛩️ Stanek's Gift Manager gestartet.");

  // 1. Sicherheitsprüfung & Geschenk annehmen
  if (typeof ns.stanek === "undefined") {
    logger.error("❌ Stanek-API ist in diesem BitNode/Run nicht verfügbar.");
    return;
  }

  try {
    if (typeof ns.stanek.acceptGift === "function") {
      ns.stanek.acceptGift();
    }
  } catch (err) {
    logger.warn("Hinweis beim Akzeptieren von Stanek's Gift:", undefined, {
      context: { error: String(err) },
    });
  }

  let totalCharges = 0;

  // 2. Kontinuierliche Ladeschleife
  while (true) {
    const state = loadState(ns);

    // Prüfen, ob manuell deaktiviert
    if (state?.disabledModules?.includes("stanek")) {
      logger.warn("⏸️ Stanek-Modul ist deaktiviert. Warte 60s...");
      await ns.sleep(60000);
      continue;
    }

    // Aktive Fragmente abfragen
    let fragments = ns.stanek.activeFragments();

    // Falls noch keine Fragmente gesetzt sind, versuchen automatisch Standard-Layout zu setzen
    if (fragments.length === 0) {
      logger.info("📐 Keines der Fragmente ist platziert. Versuche Auto-Setup...");
      autoSetupFragments(ns, logger);
      fragments = ns.stanek.activeFragments();
    }

    if (fragments.length === 0) {
      logger.warn("⚠️ Keine Fragmente auf dem Grid platziert. Warte 30s...");
      await ns.sleep(30000);
      continue;
    }

    // 3. Fragmente reihum aufladen (Charge Loop)
    for (const fragment of fragments) {
      await ns.stanek.chargeFragment(fragment.x, fragment.y);
      totalCharges++;

      // Alle 50 Charges ein strukturiertes Debug-Log an den Zentral-Logger senden
      if (totalCharges % 50 === 0) {
        logger.debug(
          `⚡ Charging aktiv [Meilenstein: ${totalCharges} Charges]`,
          undefined,
          {
            context: {
              fragmentId: fragment.id,
              x: fragment.x,
              y: fragment.y,
              totalCharges,
            },
            tags: ["charge-cycle"],
          }
        );
      }
    }

    await ns.sleep(100);
  }
}

/**
 * Hilfsfunktion zum automatischen Platzieren von Basis-Fragmenten,
 * falls das Grid komplett leer ist.
 */
function autoSetupFragments(ns: NS, logger: LoggerClient): void {
  try {
    const width = ns.stanek.giftWidth();
    const height = ns.stanek.giftHeight();

    logger.info(`Grid-Größe erkannt: ${width}x${height}`, undefined, {
      context: { width, height },
    });

    const defaultLayout = [
      { id: 0, x: 0, y: 0, rotation: 0 },  // Hacking Skill
      { id: 1, x: 0, y: 1, rotation: 0 },  // Hacking Exp
      { id: 25, x: 1, y: 0, rotation: 0 }, // Special Fragment
    ];

    for (const f of defaultLayout) {
      if (ns.stanek.canPlaceFragment(f.x, f.y, f.rotation, f.id)) {
        ns.stanek.placeFragment(f.x, f.y, f.rotation, f.id);
        logger.success(`🧩 Fragment ${f.id} platziert bei [${f.x}, ${f.y}]`, undefined, {
          context: { fragmentId: f.id, x: f.x, y: f.y },
        });
      }
    }
  } catch (err) {
    logger.error("Fehler beim automatischen Bestücken des Stanek-Grids:", undefined, {
      context: { error: String(err) },
    });
  }
}