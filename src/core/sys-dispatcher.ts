import { NS, FactionName, CompanyName } from "@ns";
import { CITY_FACTIONS, REFRESH_INTERVALS } from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { loadState, patchState } from "/lib/state.js";
import { PATHS } from "/lib/paths.js";
import { BotStrategy } from "/lib/types/strategy.js";
import { SystemStrategyEvaluator } from "/lib/evaluators/strategy/system-strategy.js";
import { getExactBitNode } from "/lib/utils";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const currentBitnode = getExactBitNode(ns);
  const logger = new Logger(ns, "Dispatcher");

  if (ns.singularity === undefined) {
    logger.error("Kritischer Systemfehler: Singularity-API (SF4) fehlt!");
    ns.tprint(
      "🛑 [Dispatcher] Kritischer Fehler: Singularity-API (SF4) fehlt!",
    );
    return;
  }

  logger.info("🚀 Sys-Dispatcher gestartet.");

  const evaluator = new SystemStrategyEvaluator();
  let modeLockTime = 0;

  while (true) {
    const currentState = loadState(ns);
    const evalRes = evaluator.evaluate(ns, logger);

    let mode = evalRes.mode;
    let targetFaction = evalRes.targetFaction;
    let targetCompany = evalRes.targetCompany;
    let targetStat = evalRes.targetStat;

    // 🛡️ Oszillations-Schutz (Cooldown-Prüfung)
    const previousStrategy = currentState?.strategy || "MONEY";
    const now = Date.now();

    if (mode !== previousStrategy) {
      const isOscillating =
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN"].includes(mode) &&
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN"].includes(previousStrategy);

      if (
        isOscillating &&
        now - modeLockTime < REFRESH_INTERVALS.STRATEGY_COOLDOWN
      ) {
        logger.warn(
          `🔄 Oszillations-Schutz! Blockiere Wechsel zu [${mode}]. Bleibe bei [${previousStrategy}].`,
        );
        mode = previousStrategy as BotStrategy;
        targetFaction = (currentState?.targetFaction as FactionName) ?? null;
        targetCompany = (currentState?.targetCompany as CompanyName) ?? null;
        targetStat = currentState?.targetStat ?? null;
      } else {
        logger.info(
          `✅ Strategie-Wechsel freigegeben: ${previousStrategy} ➔ ${mode}`,
        );
        modeLockTime = now;
      }
    }

    // ✉️ Automatische Fraktionseinladungen verarbeiten
    handleFactionInvitations(ns, logger);

    // 📝 State-Patching
    patchState(ns, {
      currentBitNode: currentBitnode.node,
      currentBitNodeLevel: currentBitnode.level,
      strategy: mode,
      isBN2GangMode: evalRes.isBN2GangMode,
      hasGang: evalRes.hasGang,
      gangFaction: evalRes.gangFaction ?? undefined,
      targetFaction: targetFaction ?? undefined,
      isGrindingNFG: evalRes.isGrindingNFG,
      targetCompany: targetCompany ?? undefined,
      targetStat: mode === "TRAIN" ? (targetStat ?? undefined) : undefined,
      targetKills: mode === "KILLS" ? (targetStat ?? undefined) : undefined,
      progressBar: evalRes.progressBar,
      fillerConfig: evalRes.fillerConfig,
    });

    // ⚙️ Microservices steuern
    const isBatcherActive =
      currentState?.batchStrategy === "SHOTGUN_HWGW" ||
      currentState?.batchStrategy === "JIT_HWGW";

    manageMicroservices(
      ns,
      mode,
      logger,
      targetStat ?? undefined,
      isBatcherActive,
      (ns as any).heart?.break() ?? 0,
      evalRes.hasGang,
    );
    ensureUIServices(ns, logger);

    await ns.sleep(2000);
  }
}

/**
 * Steuert das Starten und Beenden der Hintergrund-Tasks (Microservices).
 */
function manageMicroservices(
  ns: NS,
  currentMode: string,
  logger: Logger,
  targetStat?: number,
  isBatcherActive?: boolean,
  currentKarma: number = 0,
  hasGang: boolean = false,
): void {
  const modeToScript: Record<string, string> = {
    REP: PATHS.tasks.faction,
    CORP: PATHS.tasks.corp,
    TRAIN: PATHS.tasks.train,
    UNI: PATHS.tasks.uni,
    CRIME: PATHS.tasks.crime,
    KILLS: PATHS.tasks.crime,
    KARMA: PATHS.tasks.crime, // Nutzt Crime-Task mit Fokus auf Homicide
    // BLADEBURNER: PATHS.tasks.bladeburner, // Skript für Bladeburner-Orchestrierung
    // CHURCH: PATHS.tasks.stanek, // Skript zum Laden des Stanek-Rasters
  };

  let targetScript: string | undefined = modeToScript[currentMode];

  if (currentMode === "MONEY") {
    // Nur pausieren, wenn SOWOHL eine Gang als auch ein echter HWGW-Batcher aktiv Geld bringen.
    // Ansonsten soll der Hauptcharakter weiter Crime-Tasks für Geld & Stats ausführen.
    if (hasGang && isBatcherActive) {
      logger.debug(
        `[MONEY] Gang & HWGW-Batcher aktiv. Pausiere manuelle Tasks.`,
      );
      targetScript = undefined;
    } else {
      logger.debug(`[MONEY] Führe Crime-Task für zusätzliches Einkommen aus.`);
      targetScript = PATHS.tasks.crime;
    }
  }

  // 🧹 Bereinigen: Beende alle Skripte, die nicht der aktuelle Target-Script sind.
  // Set verhindert doppeltes Killen (da CRIME und KILLS auf dieselbe Datei zeigen)
  const activeScriptsToStop = new Set(
    Object.values(modeToScript).filter(
      (script) => script !== targetScript && ns.isRunning(script, "home"),
    ),
  );

  for (const script of activeScriptsToStop) {
    ns.scriptKill(script, "home");
    logger.info(`⏹️ Microservice beendet: ${script}`, undefined, {
      context: { reason: "ModeMismatch", currentMode },
    });
  }

  // 🚀 Ziel-Skript prüfen und ggf. starten
  if (targetScript && ns.fileExists(targetScript, "home")) {
    const runningProc = ns.ps("home").find((p) => p.filename === targetScript);
    const isRunning = runningProc !== undefined;
    let shouldStart = !isRunning;

    const effectiveArgs: (string | number)[] =
      currentMode === "TRAIN" && targetStat !== undefined ? [targetStat] : [];

    if (isRunning && effectiveArgs.length > 0) {
      const currentRunningTarget = runningProc?.args[0];
      const expectedTarget = effectiveArgs[0];

      if (currentRunningTarget !== expectedTarget) {
        logger.info(
          `🔄 Neustart erforderlich: Parameter geändert (${currentRunningTarget} ➔ ${expectedTarget}).`,
        );
        ns.scriptKill(targetScript, "home");
        shouldStart = true;
      }
    }

    if (shouldStart) {
      const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
      const requiredRam = ns.getScriptRam(targetScript, "home");

      if (freeRam >= requiredRam) {
        const pid = ns.run(targetScript, 1, ...effectiveArgs);
        if (pid > 0) {
          logger.success(
            `▶️ Microservice gestartet: ${targetScript}`,
            undefined,
            {
              context: { mode: currentMode, args: effectiveArgs.join(",") },
            },
          );
        } else {
          logger.error(`❌ Fehler beim Starten von ${targetScript} (PID 0).`);
        }
      } else {
        logger.warn(`RAM-MANGEL! ${targetScript} pausiert.`, undefined, {
          context: { required: requiredRam, free: freeRam },
        });
      }
    }
  }
}

/**
 * Nimmt ausstehende Fraktionseinladungen automatisch an (unter Beachtung von Stadtfraktionen).
 */
function handleFactionInvitations(ns: NS, logger: Logger): void {
  const sing = ns.singularity;
  const player = ns.getPlayer();
  const invites = sing.checkFactionInvitations();
  if (invites.length === 0) return;

  const currentCity = CITY_FACTIONS.find((c) => player.factions.includes(c));

  for (const invite of invites) {
    const isCity = CITY_FACTIONS.includes(invite as FactionName);
    if (isCity && currentCity && currentCity !== invite) continue;

    if (sing.joinFaction(invite)) {
      logger.success(
        `🎉 Einladung zu Fraktion [${invite}] automatisch angenommen!`,
      );
      ns.toast(`Beigetreten: ${invite}`, "success");
    }
  }
}

/**
 * Stellt sicher, dass globale UI-Skripte und Dashboards dauerhaft laufen.
 */
function ensureUIServices(ns: NS, logger: Logger): void {
  const uiScript = "ui/roadmap.js"; // Alternativ PATHS.ui?.roadmap

  if (ns.fileExists(uiScript, "home") && !ns.isRunning(uiScript, "home")) {
    const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
    const requiredRam = ns.getScriptRam(uiScript, "home");

    if (freeRam >= requiredRam) {
      const pid = ns.run(uiScript, 1);
      if (pid > 0) {
        logger.info(`📊 UI-Dashboard gestartet: ${uiScript}`);
      }
    }
  }
}
