import { NS } from "@ns";
import { ProvisionProfile } from "shared/types/game.js";
import { PAYLOADS } from "/shared/constants/payloads.js";

export async function provisionServer(
  ns: NS,
  serverName: string,
  profile: ProvisionProfile = "hgw",
): Promise<void> {
  if (serverName === "home") return;

  const filesToCopy = PAYLOADS[profile];
  const currentHost = ns.getHostname();
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