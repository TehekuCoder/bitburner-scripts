import { NS, FactionName, CompanyName } from "@ns";
import { BotStrategy } from "/shared/types/strategy";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { SystemStrategyEvaluator } from "/domain/evaluators/strategy/system-strategy";
import { PATHS } from "/infrastructure/runtime/paths";
import { loadState, patchState } from "/infrastructure/state/state";
import { CITY_FACTIONS } from "/shared/constants/factions";
import { REFRESH_INTERVALS } from "/shared/constants/game-defaults";
import { hasSingularity, hasBladeburner } from "/lib/utils";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new LoggerClient(ns, "Dispatcher");
  const singularityAvailable = hasSingularity(ns);

  if (!singularityAvailable) {
    logger.warn(
      "Singularity-API (SF4) fehlt. Bladeburner-Only-Modus aktiv.",
    );
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
    let targetStat = evalRes.targetStat as string | number | null;

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
    if (singularityAvailable) {
      handleFactionInvitations(ns, logger);
    }

    // ⚔️ Bladeburner Division & Faction Auto-Join prüfen
    handleBladeburnerAutoJoin(ns, logger);

    // 📝 State-Patching
    patchState(ns, {
      strategy: mode,
      isDominionActive: evalRes.isDominionActive,
      isBladeburnerParallel: evalRes.isBladeburnerParallel,
      isBN2GangMode: evalRes.isBN2GangMode,
      hasGang: evalRes.hasGang,
      gangFaction: evalRes.gangFaction ?? undefined,
      targetFaction: targetFaction ?? undefined,
      isGrindingNFG: evalRes.isGrindingNFG,
      targetCompany: targetCompany ?? undefined,
      targetStat: targetStat ?? undefined,
      targetKills:
        mode === "KILLS" && targetStat != null
          ? typeof targetStat === "number"
            ? targetStat
            : Number(targetStat)
          : undefined,
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
      ns.heart.break(),
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
  logger: LoggerClient,
  targetStat?: string | number,
  isBatcherActive?: boolean,
  currentKarma: number = 0,
  hasGang: boolean = false,
): void {
  const currentState = loadState(ns);

  const modeToScript: Record<string, string> = {
    REP: PATHS.domain.tasks.faction,
    COMPANY: PATHS.domain.tasks.company,
    TRAIN: PATHS.domain.tasks.train,
    UNI: PATHS.domain.tasks.uni,
    CRIME: PATHS.domain.tasks.crime,
    KILLS: PATHS.domain.tasks.crime,
    KARMA: PATHS.domain.tasks.crime,
    DOMINION: PATHS.domain.tasks.uni,
  };

  let targetScript: string | undefined = modeToScript[currentMode];

  // 🛡️ 1. Gang & Batcher Override
  if (currentMode === "MONEY") {
    if (hasGang && isBatcherActive) {
      targetScript = undefined;
    } else {
      targetScript = PATHS.domain.tasks.crime;
    }
  }

  // 🛡️ 2. Bladeburner Override (Prüft Simulacrum)
  const isBladeburnerActive =
    hasBladeburner(ns) && ns.bladeburner.inBladeburner();

  // Prüfe, ob Simulacrum bereits installiert ist
  const hasSimulacrum =
    hasSingularity(ns) &&
    ns.singularity
      .getOwnedAugmentations(false)
      .includes("The Blade's Simulacrum");

  // ⚔️ Drei Modi:
  // 1. OHNE Bladeburner: Normale Task-Strategie
  // 2. MIT Bladeburner + OHNE Simulacrum: Bladeburner exklusiv (außer TRAIN)
  // 3. MIT Bladeburner + MIT Simulacrum: Beide parallel, normale Task-Strategie läuft daneben
  if (isBladeburnerActive && !hasSimulacrum && currentMode !== "TRAIN") {
    targetScript = undefined;
  }
  // Mit Simulacrum: Lasse targetScript normal laufen (wird parallel zu Bladeburner ausgeführt)

  // Stoppe alle nicht mehr benötigten Microservices
  const activeScriptsToStop = new Set(
    Object.values(modeToScript).filter(
      (script) => script !== targetScript && ns.isRunning(script, "home"),
    ),
  );

  for (const script of activeScriptsToStop) {
    ns.scriptKill(script, "home");
    logger.info(`⏹️ Microservice beendet: ${script}`, undefined, {
      context: { reason: "ModeMismatchOrBladeburnerOverride", currentMode },
    });
  }

  if (targetScript && ns.fileExists(targetScript, "home")) {
    const runningProc = ns.ps("home").find((p) => p.filename === targetScript);
    const isRunning = runningProc !== undefined;
    let shouldStart = !isRunning;

    // 🟢 Argumente dynamisch je nach Modus übergeben
    const effectiveArgs: (string | number)[] = [];
    if (
      ["TRAIN", "UNI", "DOMINION"].includes(currentMode) &&
      targetStat !== undefined
    ) {
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
function handleFactionInvitations(ns: NS, logger: LoggerClient): void {
  const sing = ns.singularity;
  if (!sing) return;

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
 * Prüft und übernimmt das automatische Beitreten zur Bladeburner Division
 * (Stats >= 100) sowie zur Bladeburner-Fraktion (Rank >= 25).
 */
function handleBladeburnerAutoJoin(ns: NS, logger: LoggerClient): void {
  // 1. Prüfen, ob die Bladeburner-API verfügbar ist (SF7 / BN6 / BN7)
  if (ns.bladeburner === undefined) return;

  const player = ns.getPlayer();
  const minCombatStat = Math.min(
    player.skills.strength,
    player.skills.defense,
    player.skills.dexterity,
    player.skills.agility,
  );

  // 2. Stufe 1: Der Bladeburner Division beitreten (Voraussetzung: Stats >= 100)
  if (!ns.bladeburner.inBladeburner()) {
    if (minCombatStat >= 100) {
      const joined = ns.bladeburner.joinBladeburnerDivision();
      if (joined) {
        logger.success("⚔️ Erfolgreich der Bladeburner Division beigetreten!");
        ns.toast("Bladeburner Division beigetreten!", "success");
      }
    }
    return; // Noch nicht in der Division -> Faction-Join erst im nächsten Schritt möglich
  }

  // 3. Stufe 2: Der Bladeburner-Fraktion beitreten (Voraussetzung: Rank >= 25)
  if (!player.factions.includes("Bladeburners") && ns.singularity) {
    const currentRank = ns.bladeburner.getRank();
    if (currentRank >= 25) {
      if (ns.singularity.joinFaction("Bladeburners")) {
        logger.success(
          `🎉 Der Bladeburner-Fraktion beigetreten! (Rang: ${Math.floor(currentRank)})`,
        );
        ns.toast("Bladeburner Fraktion beigetreten!", "success");
      }
    }
  }
}
