import { NS, ActiveFragment } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { loadState } from "/infrastructure/state/state.js";
import { hasBladeburner } from "/lib/utils.js";
import { getAllRootedServersIncludingPurchased } from "/infrastructure/network/network.js";
import { PATHS } from "/infrastructure/runtime/paths.js";

const CHARGE_PAYLOAD = PATHS.services.payloads.stanekCharge ?? "/services/payloads/stanek-charge.js";

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

  while (true) {
    const state = loadState(ns);

    if (state?.disabledModules?.includes("stanek")) {
      logger.warn("⏸️ Stanek-Modul ist deaktiviert. Warte 60s...");
      stopAllChargeWorkers(ns);
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

    // Valide Lade-Kacheln (ohne Booster-Fragmente Typ 18) sammeln
    const chargeTiles: { x: number; y: number; id: number }[] = [];
    for (const fragment of fragments) {
      if (fragment.type === 18) continue;
      const tile = getValidChargeTile(ns, fragment);
      chargeTiles.push({ x: tile.x, y: tile.y, id: fragment.id });
    }

    if (chargeTiles.length > 0) {
      deployStanekFleet(ns, logger, chargeTiles);
    }

    await ns.sleep(15000);
  }
}

function deployStanekFleet(
  ns: NS,
  logger: LoggerClient,
  tiles: { x: number; y: number; id: number }[]
): void {
  const payloadPath = CHARGE_PAYLOAD.endsWith(".ts")
    ? CHARGE_PAYLOAD.replace(/\.ts$/, ".js")
    : CHARGE_PAYLOAD;

  if (!ns.fileExists(payloadPath, "home")) {
    logger.error(`Payload-Skript '${payloadPath}' nicht gefunden!`);
    return;
  }

  const scriptRam = ns.getScriptRam(payloadPath, "home");
  const servers = getAllRootedServersIncludingPurchased(ns);

  let totalDeployedThreads = 0;
  let tileIndex = 0;

  for (const host of servers) {
    if (host !== "home") {
      ns.scp(payloadPath, host, "home");
    }

    const maxRam = ns.getServerMaxRam(host);
    const usedRam = ns.getServerUsedRam(host);
    // Auf 'home' reservieren wir RAM für Orchestrator/Andere Daemons
    const reservedRam = host === "home" ? 64 : 0;
    const freeRam = Math.max(0, maxRam - usedRam - reservedRam);

    const threads = Math.floor(freeRam / scriptRam);
    if (threads > 0) {
      const targetTile = tiles[tileIndex % tiles.length];
      const pid = ns.exec(payloadPath, host, threads, targetTile.x, targetTile.y);
      if (pid > 0) {
        totalDeployedThreads += threads;
        tileIndex++;
      }
    }
  }

  if (totalDeployedThreads > 0) {
    logger.debug(`⚡ Stanek-Fleet verteilt: ${totalDeployedThreads} Threads auf ${tiles.length} Ziel-Fragmente.`);
  }
}

function stopAllChargeWorkers(ns: NS): void {
  const payloadPath = CHARGE_PAYLOAD.endsWith(".ts")
    ? CHARGE_PAYLOAD.replace(/\.ts$/, ".js")
    : CHARGE_PAYLOAD;
  const scriptName = payloadPath.replace(/^.*[\\/]/, "");
  const servers = getAllRootedServersIncludingPurchased(ns);

  for (const server of servers) {
    for (const proc of ns.ps(server)) {
      if (proc.filename.endsWith(scriptName)) {
        ns.kill(proc.pid);
      }
    }
  }
}

function getValidChargeTile(ns: NS, fragment: ActiveFragment): { x: number; y: number } {
  const direct = ns.stanek.getFragment(fragment.x, fragment.y);
  if (direct && direct.id === fragment.id) {
    return { x: fragment.x, y: fragment.y };
  }

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