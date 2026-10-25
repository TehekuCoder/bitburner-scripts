export interface OrchestratorPolicyState {
  disabledModules?: unknown;
  manualMode?: unknown;
  strategy?: unknown;
}

export function isModuleDisabled(
  state: OrchestratorPolicyState | null | undefined,
  moduleName: string | readonly string[],
): boolean {
  const disabledModules = state?.disabledModules;
  if (!Array.isArray(disabledModules)) return false;
  const names = typeof moduleName === "string" ? [moduleName] : moduleName;
  return names.some((name) => disabledModules.includes(name));
}

export function isManualMode(
  state: OrchestratorPolicyState | null | undefined,
): boolean {
  return Boolean(state?.manualMode || state?.strategy === "MANUAL");
}
