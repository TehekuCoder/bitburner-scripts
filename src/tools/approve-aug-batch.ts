import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.tprint(
    "[INFO] Augmentations werden einzeln und in der Reihenfolge des Kaufplans vom Finance-Core gekauft, sobald Budget und Voraussetzungen erfüllt sind. Eine Freigabe ist nicht erforderlich.",
  );
}
