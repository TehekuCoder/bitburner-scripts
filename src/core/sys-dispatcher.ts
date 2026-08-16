import { NS, FactionName, CompanyName } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { loadState, patchState } from "/lib/state.js";
import { PATHS } from "/lib/paths.js";
import { BotStrategy } from "/shared/types/strategy.js";
import { SystemStrategyEvaluator } from "/lib/evaluators/strategy/system-strategy.js";
import {
  getExactBitNode,
  hasSleeve,
  hasGang,
  hasCorporation,
} from "/lib/utils.js";
import { CITY_FACTIONS } from "../shared/constants/factions";
import { REFRESH_INTERVALS } from "../shared/constants/game-defaults";

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
        ["MONEY", "CRIME", "REP", "COMPANY", "TRAIN"].includes(mode) &&
        ["MONEY", "CRIME", "REP", "COMPANY", "TRAIN"].includes(
          previousStrategy,
        );

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
      isDominionActive: evalRes.isDominionActive,
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

    // ⚙️ Einmalige/Wechselnde Microservices steuern
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

    await ns.sleep(2000);
  }
}

/**
 * Steuert das Starten und Beenden von modi-abhängigen Hintergrund-Tasks.
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
  const currentState = loadState(ns);

  const modeToScript: Record<string, string> = {
    REP: PATHS.tasks.faction,
    COMPANY: PATHS.tasks.company,
    TRAIN: PATHS.tasks.train,
    UNI: PATHS.tasks.uni,
    CRIME: PATHS.tasks.crime,
    KILLS: PATHS.tasks.crime,
    KARMA: PATHS.tasks.crime,
    DOMINION: PATHS.tasks.uni,
  };

  let targetScript: string | undefined = modeToScript[currentMode];

  if (currentMode === "MONEY") {
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

  if (targetScript && ns.fileExists(targetScript, "home")) {
    const runningProc = ns.ps("home").find((p) => p.filename === targetScript);
    const isRunning = runningProc !== undefined;
    let shouldStart = !isRunning;

    // 🟢 Argumente dynamisch je nach Modus übergeben
    const effectiveArgs: (string | number)[] = [];
    if (currentMode === "TRAIN" && targetStat !== undefined) {
      effectiveArgs.push(targetStat);
    } else if (currentMode === "COMPANY" && currentState?.targetCompany) {
      effectiveArgs.push(currentState.targetCompany);
    }

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
 * Nimmt ausstehende Fraktionseinladungen automatisch an.
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
