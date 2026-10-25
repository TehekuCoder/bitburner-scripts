export const STATE_SCHEMA_VERSION = 1;

export type StateRecord = Record<string, unknown>;

export interface ParsedStateSnapshot<T = StateRecord> {
  revision: number;
  state: T;
}

type StateValidator<T> = (value: unknown) => value is T;

function isRecord(value: unknown): value is StateRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => isFiniteNumber(item))
  );
}

function isStringOrUndefined(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isStringNumberOrNull(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    isFiniteNumber(value)
  );
}

function isBatchPlan(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const numericFields = [
    "hackThreads",
    "weaken1Threads",
    "growThreads",
    "weaken2Threads",
    "hackTime",
    "growTime",
    "weakenTime",
    "batchRam",
  ];
  const optionalNumericFields = [
    "hackDelay",
    "weaken1Delay",
    "growDelay",
    "weaken2Delay",
    "executionTime",
    "totalRam",
    "maxBatches",
    "greed",
    "greedScore",
    "greedFactor",
  ];
  return (
    typeof value.target === "string" &&
    numericFields.every((field) => isFiniteNumber(value[field])) &&
    optionalNumericFields.every(
      (field) => !(field in value) || isFiniteNumber(value[field]),
    )
  );
}

function isAugPurchasePlan(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.createdAt) &&
    isStringArray(value.installedAugs) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.name === "string" &&
        isFiniteNumber(item.repReq) &&
        isFiniteNumber(item.basePrice) &&
        isStringArray(item.prereqs) &&
        isStringArray(item.factions),
    ) &&
    (value.gangFaction === undefined || typeof value.gangFaction === "string")
  );
}

export function isBotStateShape(value: unknown): value is StateRecord {
  if (!isRecord(value)) return false;

  const requiredStrings = [
    "batcherProgress",
    "traderProgress",
    "financeProgress",
    "hacknetProgress",
    "gangPhase",
    "gangProgress",
    "stage",
    "kernelTarget",
  ];
  const requiredNumbers = [
    "lastUpdate",
    "currentBitNode",
    "currentBitNodeLevel",
    "gangMembersCount",
    "gangRespect",
    "gangWantedPenalty",
    "minWinChance",
    "funds",
    "revenue",
    "expenses",
    "investmentOffer",
  ];
  const requiredBooleans = [
    "hasGang",
    "hasCorp",
    "hasDarkScapeNavigator",
    "hasTorRouter",
    "hasCorporation",
    "hasBladeburner",
  ];
  const requiredStringArrays = ["divisions", "corpRecentLogs", "recentLogs"];

  if (
    !requiredStrings.every((key) => typeof value[key] === "string") ||
    !requiredNumbers.every((key) => isFiniteNumber(value[key])) ||
    !requiredBooleans.every((key) => typeof value[key] === "boolean") ||
    !requiredStringArrays.every((key) => isStringArray(value[key])) ||
    !isNumberRecord(value.sourceFiles)
  ) {
    return false;
  }

  const optionalChecks: Record<string, (item: unknown) => boolean> = {
    playerHacking: (item) => item === undefined || isFiniteNumber(item),
    totalNodes: (item) => item === undefined || isFiniteNumber(item),
    allServers: (item) => item === undefined || isStringArray(item),
    sources: (item) =>
      item === undefined ||
      (isRecord(item) &&
        Object.values(item).every((source) => typeof source === "string")),
    batchStrategy: (item) =>
      item === undefined ||
      ["WORKER", "BOOTSTRAP", "XP_GRIND", "PREP", "PROTO_BATCH", "SHOTGUN_HWGW", "JIT_HWGW"].includes(
        item as string,
      ),
    batcherPhase: isStringOrUndefined,
    batcherTarget: (item) =>
      item === undefined || item === null || typeof item === "string",
    batcherActive: (item) => item === undefined || typeof item === "boolean",
    batcherActiveBatches: (item) =>
      item === undefined || isFiniteNumber(item),
    batcherTargetsSummary: (item) =>
      item === undefined ||
      (Array.isArray(item) &&
        item.every(
          (summary) =>
            isRecord(summary) &&
            typeof summary.target === "string" &&
            (summary.mode === "PREP" || summary.mode === "HWGW") &&
            ["activeBatches", "maxBatches", "prepEndTime", "greed"].every(
              (key) => isFiniteNumber(summary[key]),
            ) &&
            (summary.batchRam === undefined ||
              isFiniteNumber(summary.batchRam)),
        )),
    batcherPlan: (item) => item === undefined || isBatchPlan(item),
    batcherDynamicMaxBatches: (item) =>
      item === undefined || isFiniteNumber(item),
    batcherRamNeeded: (item) => item === undefined || isFiniteNumber(item),
    progressBar: isStringOrUndefined,
    strategy: (item) =>
      item === undefined ||
      [
        "MANUAL", "MONEY", "REP", "COMPANY", "TRAIN", "KILLS", "CRIME",
        "UNI", "KARMA", "BLADEBURNER", "CHURCH", "DOMINION",
      ].includes(item as string),
    targetFaction: isNullableString,
    targetCompany: isNullableString,
    targetStat: isStringNumberOrNull,
    targetKills: (item) => item === undefined || isFiniteNumber(item),
    manualMode: (item) => item === undefined || typeof item === "boolean",
    isGrindingNFG: (item) => item === undefined || typeof item === "boolean",
    isDominionActive: (item) =>
      item === undefined || typeof item === "boolean",
    moneyReserve: (item) => item === undefined || isFiniteNumber(item),
    isHomePrioritized: (item) =>
      item === undefined || typeof item === "boolean",
    isRushModeActive: (item) =>
      item === undefined || typeof item === "boolean",
    homeCores: (item) => item === undefined || isFiniteNumber(item),
    traderMode: isStringOrUndefined,
    sleeveGlobalMode: isStringOrUndefined,
    sleeveProgress: isStringOrUndefined,
    autoBuyAugs: (item) => item === undefined || typeof item === "boolean",
    targetBladeburnerAction: (item) =>
      item === undefined || item === null || typeof item === "string",
    targetBladeburnerType: (item) =>
      item === undefined || item === null || typeof item === "string",
    augRoadMap: (item) =>
      item === undefined ||
      (Array.isArray(item) &&
        item.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.faction === "string" &&
            typeof entry.augmentation === "string" &&
            isFiniteNumber(entry.repRequired) &&
            isFiniteNumber(entry.cost) &&
            isStringArray(entry.prereqs) &&
            isStringArray(entry.factions) &&
            typeof entry.bestFaction === "string",
        )),
    augPurchasePlan: (item) =>
      item === undefined || isAugPurchasePlan(item),
    isBN2GangMode: (item) => item === undefined || typeof item === "boolean",
    factionCurrentReps: (item) => item === undefined || isNumberRecord(item),
    fillerConfig: (item) =>
      item === undefined ||
      item === null ||
      (isRecord(item) &&
        isFiniteNumber(item.shareMaxRamPercent) &&
        isFiniteNumber(item.maxXpLevel)),
    bitnodePhaseInfo: (item) =>
      item === undefined ||
      (isRecord(item) &&
        isFiniteNumber(item.phaseIndex) &&
        typeof item.phaseName === "string" &&
        isFiniteNumber(item.progressPercent) &&
        typeof item.detail === "string"),
    gangFaction: isStringOrUndefined,
    isHackingGang: (item) => item === undefined || typeof item === "boolean",
    gangPhase: (item) => typeof item === "string",
    gangProgress: (item) => typeof item === "string",
    recentLogs: isStringArray,
    minWinChance: isFiniteNumber,
    corpName: isStringOrUndefined,
    corpRecentLogs: isStringArray,
    stanekLayoutProfile: (item) =>
      item === undefined || item === "HACKING" || item === "BLADEBURNER",
    isBladeburnerParallel: (item) =>
      item === undefined || typeof item === "boolean",
    disabledModules: (item) => item === undefined || isStringArray(item),
  };

  return Object.entries(optionalChecks).every(
    ([key, validator]) => !(key in value) || validator(value[key]),
  );
}

export function parseStoredState<T>(
  value: unknown,
  defaults: StateRecord,
  validateState: StateValidator<T>,
): ParsedStateSnapshot<T> | null {
  if (!isRecord(value)) return null;

  let revision = 0;
  let schemaVersion = 0;
  let state: StateRecord;

  if ("state" in value) {
    if (
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 0 ||
      !isRecord(value.state)
    ) {
      return null;
    }
    revision = value.revision as number;
    schemaVersion = value.schemaVersion === undefined ? 0 : value.schemaVersion as number;
    state = value.state;
  } else if (typeof value.lastUpdate === "number") {
    state = value;
  } else {
    return null;
  }

  if (
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < 0 ||
    schemaVersion > STATE_SCHEMA_VERSION
  ) {
    return null;
  }
  const normalizedState =
    schemaVersion === 0 ? { ...defaults, ...state } : state;
  if (!validateState(normalizedState)) return null;

  return { revision, state: normalizedState };
}
