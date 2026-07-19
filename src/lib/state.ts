import { NS, BitNodeMultipliers } from "@ns";
import {DEFAULT_MULTIPLIERS} from "lib/constants"


export function loadBnMults(ns: NS): Record<keyof BitNodeMultipliers, number> {
  if (ns.fileExists("bn-multipliers.txt", "home")) {
    try {
      const fileContent = ns.read("bn-multipliers.txt");
      if (fileContent) {
        return { ...DEFAULT_MULTIPLIERS, ...JSON.parse(fileContent) };
      }
    } catch {
      ns.print("⚠️ [LIB] Fehler beim Parsen der bn-multipliers.txt. Nutze harten FailSafe.");
    }
  }
  return DEFAULT_MULTIPLIERS;
}