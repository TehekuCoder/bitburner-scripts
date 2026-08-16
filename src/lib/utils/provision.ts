import { NS } from "@ns";
import { ProvisionProfile, PAYLOADS } from "../constants/game";


/**
 * Kopiert profilbasierte Worker-Skripte auf den Zielserver, falls sie fehlen.
 * @param ns NS API Objekt
 * @param serverName Der Zielserver (z.B. "cloud-0" oder "darknet-node-1")
 * @param profile Profilauswahl ('hgw' | 'darknet') - Standard: 'hgw'
 */
export async function provisionServer(
  ns: NS,
  serverName: string,
  profile: ProvisionProfile = "hgw"
): Promise<void> {
  if (serverName === "home") return;

  const filesToCopy = PAYLOADS[profile];
  const currentHost = ns.getHostname();
  const sourceCandidates = ["home", currentHost];

  const missingFiles = filesToCopy.filter(
    (file) => !ns.fileExists(file, serverName)
  );

  if (missingFiles.length === 0) return;

  for (const file of missingFiles) {
    const sourceHost = sourceCandidates.find(
      (host) => host !== serverName && ns.fileExists(file, host)
    );

    if (sourceHost) {
      ns.scp(file, serverName, sourceHost);
    } else {
      ns.print(`[PROVISION] Datei fehlt: ${file} auf home & ${currentHost}`);
    }
  }
}