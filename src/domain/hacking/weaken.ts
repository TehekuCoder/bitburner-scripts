export const HACK_SECURITY_PER_THREAD = 0.002;
export const GROW_SECURITY_PER_THREAD = 0.004;
export const BASE_WEAKEN_EFFECT_PER_THREAD = 0.05;

export function getWeakenEffectPerThread(multiplier?: number): number {
  const validMultiplier =
    multiplier !== undefined &&
    Number.isFinite(multiplier) &&
    multiplier >= 0
      ? multiplier
      : 1;
  return BASE_WEAKEN_EFFECT_PER_THREAD * validMultiplier;
}

export function getWeakenThreadsForSecurity(
  securityIncrease: number,
  weakenEffectPerThread: number,
): number {
  if (!Number.isFinite(securityIncrease)) return Infinity;
  if (securityIncrease <= 0) return 0;
  if (!Number.isFinite(weakenEffectPerThread) || weakenEffectPerThread <= 0) {
    return Infinity;
  }
  return Math.ceil(securityIncrease / weakenEffectPerThread);
}
