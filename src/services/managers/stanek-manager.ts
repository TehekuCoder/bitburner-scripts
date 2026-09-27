import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { loadState } from "/infrastructure/state/state";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

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

  while (true) {
    const state = loadState(ns);

    if (state?.disabledModules?.includes("stanek")) {
      logger.warn("⏸️ Stanek-Modul ist deaktiviert. Warte 60s...");
      await ns.sleep(60000);
      continue;
    }

    let fragments = ns.stanek.activeFragments();

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

    for (const fragment of fragments) {
      await ns.stanek.chargeFragment(fragment.x, fragment.y);
      totalCharges++;

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
 * Durchsucht das Stanek-Grid nach freien Plätzen und platziert universelle Fragmente.
 */
function autoSetupFragments(ns: NS, logger: LoggerClient): void {
  try {
    const width = ns.stanek.giftWidth();
    const height = ns.stanek.giftHeight();
    const definitions = ns.stanek.fragmentDefinitions();

    logger.info(`Grid-Größe erkannt: ${width}x${height}. Verarbeite Definitionen...`, undefined, {
      context: { width, height },
    });

    // Nützliche Fragment-IDs priorisieren (z.B. Hacking Skill, Exp, Hacking Power)
    // Fragment IDs in Bitburner: 0 = Hack Skill, 1 = Hack Exp, 5 = Faster Hack/Grow/Weaken, etc.
    const priorityIds = [0, 1, 5, 6, 7, 25];

    for (const id of priorityIds) {
      const def = definitions.find((d) => d.id === id);
      if (!def) continue;

      let placed = false;

      // Rastersuche über alle X, Y und Rotationen (0-3)
      for (let x = 0; x < width && !placed; x++) {
        for (let y = 0; y < height && !placed; y++) {
          for (let rotation = 0; rotation < 4; rotation++) {
            if (ns.stanek.canPlaceFragment(x, y, rotation, id)) {
              const success = ns.stanek.placeFragment(x, y, rotation, id);
              if (success) {
                logger.success(
                  `🧩 Fragment ${id} (${def.type}) platziert bei [${x}, ${y}] mit Rotation ${rotation}`,
                  undefined,
                  { context: { fragmentId: id, x, y, rotation } }
                );
                placed = true;
                break;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error("Fehler beim automatischen Bestücken des Stanek-Grids:", undefined, {
      context: { error: String(err) },
    });
  }
}