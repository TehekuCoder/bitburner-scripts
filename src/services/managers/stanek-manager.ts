import { NS, ActiveFragment } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { loadState } from "/infrastructure/state/state";
import { hasBladeburner } from "/lib/utils";

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
      // Booster-Fragmente (Typ 18) haben keine eigene Ladung
      if (fragment.type === 18) continue;

      // Eine valide, belegte Kachel auf dem Grid finden
      const tile = getValidChargeTile(ns, fragment);

      try {
        await ns.stanek.chargeFragment(tile.x, tile.y);
        totalCharges++;
      } catch (err) {
        logger.error(`Fehler beim Laden von Fragment ${fragment.id} bei [${tile.x}, ${tile.y}]:`, undefined, {
          context: { error: String(err), fragmentId: fragment.id },
        });
      }

      if (totalCharges % 50 === 0) {
        logger.debug(
          `⚡ Charging aktiv [Meilenstein: ${totalCharges} Charges]`,
          undefined,
          {
            context: {
              fragmentId: fragment.id,
              x: tile.x,
              y: tile.y,
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
 * Ermittelt eine Koordinate, die tatsächlich vom Fragment belegt ist.
 * Verhindert Fehler, wenn die Root-Koordinate (x, y) durch Form/Rotation leer ist.
 */
function getValidChargeTile(ns: NS, fragment: ActiveFragment): { x: number; y: number } {
  const direct = ns.stanek.getFragment(fragment.x, fragment.y);
  if (direct && direct.id === fragment.id) {
    return { x: fragment.x, y: fragment.y };
  }

  // Bounding-Box absuchen, bis ein belegtes Feld des Fragments gefunden wird
  for (let dx = 0; dx < 5; dx++) {
    for (let dy = 0; dy < 5; dy++) {
      const testX = fragment.x + dx;
      const testY = fragment.y + dy;
      const placed = ns.stanek.getFragment(testX, testY);
      if (placed && placed.id === fragment.id) {
        return { x: testX, y: testY };
      }
    }
  }

  return { x: fragment.x, y: fragment.y };
}

function autoSetupFragments(ns: NS, logger: LoggerClient): void {
  try {
    const width = ns.stanek.giftWidth();
    const height = ns.stanek.giftHeight();
    const definitions = ns.stanek.fragmentDefinitions();

    const isBladeburnerActive =
      hasBladeburner(ns) &&
      (() => {
        try {
          return ns.bladeburner.inBladeburner();
        } catch {
          return false;
        }
      })();

    logger.info(
      `Grid-Größe erkannt: ${width}x${height}. Modus: ${
        isBladeburnerActive ? "⚔️ Bladeburner / Combat" : "💻 Hacking"
      }`,
      undefined,
      { context: { width, height, isBladeburnerActive } }
    );

    const priorityTypes = isBladeburnerActive
      ? [17, 7, 8, 9, 10, 18, 6, 3, 5]
      : [6, 3, 5, 18, 7, 8, 9, 10];

    const sortedDefinitions = [...definitions].sort((a, b) => {
      const indexA = priorityTypes.indexOf(a.type);
      const indexB = priorityTypes.indexOf(b.type);
      const prioA = indexA === -1 ? 999 : indexA;
      const prioB = indexB === -1 ? 999 : indexB;
      return prioA - prioB;
    });

    for (const def of sortedDefinitions) {
      let placed = false;

      for (let x = 0; x < width && !placed; x++) {
        for (let y = 0; y < height && !placed; y++) {
          for (let rotation = 0; rotation < 4; rotation++) {
            if (ns.stanek.canPlaceFragment(x, y, rotation, def.id)) {
              const success = ns.stanek.placeFragment(x, y, rotation, def.id);
              if (success) {
                logger.success(
                  `🧩 Fragment ${def.id} (Typ: ${def.type}) platziert bei [${x}, ${y}] mit Rotation ${rotation}`,
                  undefined,
                  { context: { fragmentId: def.id, type: def.type, x, y, rotation } }
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