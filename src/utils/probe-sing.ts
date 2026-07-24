import { NS } from "@ns";
import { patchState } from "lib/state.js";

export async function main(ns: NS): Promise<void> {
  let ownedSourceFiles: Record<number, number> = {};
  let currentBN = 1;
  let currentBNLvl = 1;

  try {
    const sfData = ns.singularity.getOwnedSourceFiles();
    for (const sf of sfData) {
      ownedSourceFiles[sf.n] = sf.lvl;
    }
    const resetInfo = ns.getResetInfo();
    currentBN = resetInfo.currentNode;
    currentBNLvl = (resetInfo as any).currentNodeLevel || 1;
  } catch {}

  patchState(ns, {
    currentBitNode: currentBN,
    currentBitNodeLevel: currentBNLvl,
    sourceFiles: ownedSourceFiles,
  });
}