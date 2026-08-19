import { NS } from "@ns";
import { ProvisionProfile } from "shared/types/game.js";
import { PAYLOADS } from "/shared/constants/payloads";

/**
 * Kopiert profilbasierte Worker-Skripte auf den Zielserver, falls sie fehlen.
 */
export async function provisionServer(
  ns: NS,
  serverName: string,
  profile: ProvisionProfile = "hgw",
): Promise<void> {
  if (serverName === "home") return;

  const filesToCopy = PAYLOADS[profile];
  const currentHost = ns.getHostname();
  // Priorisiere den aktuellen Host vor home für lokale Weiterverbreitung
  const sourceCandidates = [currentHost, "home"];

  const missingFiles = filesToCopy.filter(
    (file) => !ns.fileExists(file, serverName),
  );

  if (missingFiles.length === 0) return;

  for (const file of missingFiles) {
    const sourceHost = sourceCandidates.find(
      (host) => host !== serverName && ns.fileExists(file, host),
    );

    if (sourceHost) {
      ns.scp(file, serverName, sourceHost);
    } else {
      ns.print(`[PROVISION] Datei fehlt: ${file} auf ${currentHost} & home`);
    }
  }
}
