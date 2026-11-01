export interface SleeveShockApi {
  sleeve?: {
    getNumSleeves(): number;
    getSleeve(sleeveId: number): { shock: number };
  };
}

export function hasSleevesNeedingShockRecovery(ns: SleeveShockApi): boolean {
  if (!ns.sleeve) return false;

  for (let i = 0; i < ns.sleeve.getNumSleeves(); i++) {
    if (ns.sleeve.getSleeve(i).shock > 0) return true;
  }

  return false;
}
