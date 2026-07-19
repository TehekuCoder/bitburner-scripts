import { NS } from "@ns";
import { patchState } from "./state-manager.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const target = "w0r1d_d43m0n";
  const hasServer = ns.serverExists(target);
  const hasRoot = hasServer && ns.hasRootAccess(target);
  const reqLevel = hasServer ? (ns.getServer(target).requiredHackingSkill ?? 9999) : 9999;
  const isReadyForApocalypse = hasRoot && ns.getHackingLevel() >= reqLevel;

  const doc = globalThis.document;
  const addonId = "apocalypse-overview-addon";

  // Altes Element entfernen, falls das Skript neu gestartet wird
  const existing = doc.getElementById(addonId);
  if (existing) existing.remove();

  // 🔍 Sucht das native Overview-Panel im Bitburner-DOM
  let overviewContainer: HTMLElement | null = null;
  const elements = doc.querySelectorAll("p, span, h6");
  for (const el of elements) {
    if (el.textContent === "Overview") {
      overviewContainer = el.closest(".MuiPaper-root") || el.parentElement?.parentElement || null;
      break;
    }
  }

  if (!overviewContainer) {
    ns.tprint("🛑 [ERR] Overview-Panel konnte im DOM nicht gefunden werden.");
    return;
  }

  // Erstelle das dezente Addon-Element für die Sidebar
  const addon = doc.createElement("div");
  addon.id = addonId;
  addon.style.borderTop = "1px solid #333";
  addon.style.marginTop = "15px";
  addon.style.paddingTop = "10px";
  addon.style.textAlign = "center";
  addon.style.fontFamily = "monospace";

  addon.innerHTML = `
    <div style="color: #ff3333; font-size: 0.8rem; font-weight: bold; letter-spacing: 1px; margin-bottom: 8px;">
      💥 APOCALYPSE PROTOCOL
    </div>
    <button id="apocalypse-btn" style="
      background: #1a0505; 
      border: 1px solid #ff3333; 
      color: #ff3333; 
      padding: 6px 12px; 
      font-size: 0.75rem; 
      font-weight: bold;
      cursor: pointer; 
      font-family: inherit; 
      width: 90%; 
      box-shadow: 0 0 5px rgba(255,51,51,0.2);
      transition: all 0.2s;
    ">INITIATE OVERRIDE</button>
    <div id="apocalypse-status" style="margin-top: 6px; font-size: 0.7rem; color: #666;"> Status: Standby </div>
  `;

  overviewContainer.appendChild(addon);

  // Status-Objekt gegen das TypeScript Narrowing-Problem
  const uiState = {
    trigger: "idle" as "idle" | "countdown" | "done"
  };

  const btn = doc.getElementById("apocalypse-btn") as HTMLButtonElement | null;
  const statusEl = doc.getElementById("apocalypse-status");

  btn?.addEventListener("click", () => {
    if (uiState.trigger === "idle") {
      uiState.trigger = "countdown";
    }
  });

  // 🔄 LOOP FÜR STEUERUNG & COUNTDOWN
  let countdown = 10;
  let lastTick = Date.now();

  while (doc.getElementById(addonId)) {
    if (uiState.trigger === "countdown") {
      // Button visuell sperren
      if (btn && !btn.disabled) {
        btn.disabled = true;
        btn.style.borderColor = "#444";
        btn.style.color = "#444";
        btn.style.background = "#0a0a0a";
      }

      // ⏱️ Präziser Sekundentakt im Script-Thread
      if (Date.now() - lastTick >= 1000) {
        if (countdown >= 0) {
          if (statusEl) {
            statusEl.style.color = "#ff3333";
            statusEl.innerText = `💥 INJEKTION: 00:${countdown.toString().padStart(2, "0")}`;
          }
          countdown--;
          lastTick = Date.now();
        } else {
          uiState.trigger = "done";

          if (isReadyForApocalypse) {
            // --- 💥 ECHTER ERFOLG ---
            if (statusEl) statusEl.innerText = "SUCCESS: REDIRECTING...";
            patchState(ns, { strategy: "APOCALYPSE" as any });
            await ns.sleep(2000);
            addon.remove();
            break;
          } else {
            // --- 🛑 FALSCHER ALARM / FAKE APOCALYPSE ---
            if (statusEl) statusEl.innerText = "CRITICAL FAILURE";

            // Erstelle das temporäre Fullscreen-Overlay für den Schockmoment
            const crashOverlay = doc.createElement("div");
            Object.assign(crashOverlay.style, {
              position: "fixed",
              top: "0",
              left: "0",
              width: "100vw",
              height: "100vh",
              zIndex: "10000",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              userSelect: "none"
            });

            const randomEvent = Math.floor(Math.random() * 3);

            if (randomEvent === 0) {
              // 🔴 Event 0: Kritisches Access Denied Terminal
              crashOverlay.style.backgroundColor = "rgba(5, 5, 5, 0.98)";
              crashOverlay.style.color = "#00ff66";
              crashOverlay.style.fontFamily = "'Courier New', monospace";
              crashOverlay.innerHTML = `
                <div style="width: 600px; background: #0c0c0c; border: 1px solid #ff3333; padding: 30px; box-shadow: 0 0 20px rgba(255,51,51,0.3); border-radius: 4px;">
                  <h3 style="color: #ff3333; font-size: 1.4rem; margin-bottom: 15px; text-align: center;">⚠️ CRITICAL EXCEPTION: ACCESS DENIED ⚠️</h3>
                  <p style="color: #fff; margin-bottom: 15px;">Einbruchsversuch abgefangen. System-Parameter inkompatibel.</p>
                  <pre style="background: #050505; border: 1px solid #333; padding: 12px; color: #888; font-size: 0.85rem; line-height: 1.5;">
[SYS-LOG] Target Gateway: w0r1d_d43m0n
[SYS-LOG] Required Skill: ${reqLevel}
[SYS-LOG] Current Skill:  ${ns.getHackingLevel()}
[SYS-LOG] Root Access:    ${hasRoot ? "GRANTED" : "DENIED (NO_ROOT)"}
                  </pre>
                  <p style="color: #ff3333; margin-top: 15px; font-weight: bold; text-align: center;">[ERR] Schnittstelle permanent korrumpiert.</p>
                </div>
              `;
            } else if (randomEvent === 1) {
              // 🔵 Event 1: Bitburner OS Bluescreen
              Object.assign(crashOverlay.style, {
                backgroundColor: "#0078d7",
                color: "#ffffff",
                fontFamily: "'Segoe UI', San-Francisco, sans-serif",
                alignItems: "flex-start",
                justifyContent: "flex-start",
                padding: "10% 10%",
                boxSizing: "border-box"
              });
              crashOverlay.innerHTML = `
                <div style="max-width: 800px; text-align: left;">
                  <div style="font-size: 6rem; margin-bottom: 20px; line-height: 1;">:(</div>
                  <h1 style="font-size: 1.8rem; font-weight: 300; margin-bottom: 20px; line-height: 1.4;">
                    Ein fataler Ausnahmefehler ist aufgetreten. Das virtuelle Terminal musste angehalten werden.
                  </h1>
                  <h3 style="font-size: 1.3rem; font-weight: 300; margin-bottom: 30px;">
                    Stillstandcode: SCRIPT_KIDDIE_EXPLOIT_ATTEMPT (99% abgeschlossen)
                  </h3>
                  <p style="color: #d0d0d0; font-size: 0.9rem;">Die Verbindung zum Host-Panel wurde dauerhaft getrennt, um weitere Systemschäden zu vermeiden.</p>
                </div>
              `;
            } else {
              // ⚫ Event 2: Kernel Panic / Freeze Trace
              crashOverlay.style.backgroundColor = "#000000";
              crashOverlay.style.color = "#ff3333";
              crashOverlay.style.fontFamily = "'Courier New', monospace";
              crashOverlay.innerHTML = `
                <div style="width: 85%; font-size: 0.9rem; text-align: left; line-height: 1.5;">
                  [   0.120491] CRITICAL: Unauthorized access detected on w0r1d_d43m0n gateway.
                  <br>[   0.410294] Call Trace: bitnode_infiltrate+0x230/0x450
                  <br>[   0.410780] ERROR: PLAYER_LEVEL_INSUFFICIENT (Code 0x000000D1)
                  <br>[   0.410850] ---[ end Kernel panic - not syncing: Halted. ]---
                  <br><br><span style="background: #ff3333; color: #000; padding: 0 5px; font-weight: bold;">SYSTEM PURGED. OVERVIEW ADDON DESTROYED.</span>
                </div>
              `;
            }

            // In den DOM einhängen, damit es den ganzen Bildschirm schluckt
            doc.body.appendChild(crashOverlay);
            ns.tprint("💀 [SYS] System-Override blockiert. Addon permanent entfernt.");

            // 5 Sekunden Schock-Effekt wirken lassen
            await ns.sleep(5000);

            // 🧼 GROSSREINEMACHEN: Entfernt das Fullscreen-Overlay UND den Button unter Overview dauerhaft!
            crashOverlay.remove();
            addon.remove();
            break; // Beendet die while-Schleife, das Skript läuft sauber aus.
          }
        }
      }
    }

    await ns.sleep(50);
  }
}