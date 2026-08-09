import { NS } from "@ns";
import { loadBatcherState, patchState } from "/lib/state.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const doc = globalThis.document;
  const addonId = "redpill-overview-addon";

  ns.atExit(() => {
    const el = doc.getElementById(addonId);
    if (el) el.remove();
  });

  const checkRedPillOwned = (): boolean => {
    try {
      const ownedAugs = ns.getResetInfo().ownedAugs;
      if (ownedAugs && "The Red Pill" in ownedAugs) return true;
    } catch {
      try {
        if (ns.singularity.getOwnedAugmentations().includes("The Red Pill")) return true;
      } catch {
        return ns.serverExists("w0r1d_d43m0n");
      }
    }
    return false;
  };

  const existing = doc.getElementById(addonId);
  if (existing) existing.remove();

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

  const addon = doc.createElement("div");
  addon.id = addonId;
  addon.style.borderTop = "1px solid #004411";
  addon.style.marginTop = "15px";
  addon.style.paddingTop = "10px";
  addon.style.textAlign = "center";
  addon.style.fontFamily = "monospace";
  addon.style.display = "none";

  addon.innerHTML = `
    <div style="color: #00ff66; font-size: 0.8rem; font-weight: bold; letter-spacing: 1px; margin-bottom: 8px;">
      💊 RED PILL PROTOCOL
    </div>
    <button id="redpill-btn" style="
      background: #051a08; 
      border: 1px solid #00ff66; 
      color: #00ff66; 
      padding: 6px 12px; 
      font-size: 0.75rem; 
      font-weight: bold;
      cursor: pointer; 
      font-family: inherit; 
      width: 90%; 
      box-shadow: 0 0 5px rgba(0,255,102,0.2);
      transition: all 0.2s;
    ">OVERRIDE: ENGAGE XP RUSH</button>
    <div id="redpill-status" style="margin-top: 6px; font-size: 0.7rem; color: #008833;">
      Status: Standby (Auto-Mode)
    </div>
  `;

  overviewContainer.appendChild(addon);

  let isXpRushActive = false;

  const btn = doc.getElementById("redpill-btn") as HTMLButtonElement | null;
  const statusEl = doc.getElementById("redpill-status");

  btn?.addEventListener("click", () => {
    isXpRushActive = !isXpRushActive;

    if (isXpRushActive) {
      // 🟢 WICHTIG: batchStrategy anstelle von strategy verwenden
      patchState(ns, { batchStrategy: "XP_GRIND" });
      ns.tprint("💊 [RED PILL] Fokus auf maximalen XP-Grind umgeschaltet! (World Daemon Rush)");
    } else {
      // Bricht das Override ab und lässt den Evaluator wieder steuern
      patchState(ns, { batchStrategy: "BOOTSTRAP" });
      ns.tprint("⏸️ [RED PILL] XP-Grind pausiert. Standard-Evaluierung wieder aktiv.");
    }
  });

  while (doc.getElementById(addonId)) {
    const hasRedPill = checkRedPillOwned();

    if (hasRedPill && addon.style.display === "none") {
      addon.style.display = "block";
      ns.toast("💊 Red Pill Protocol im Overview-Panel verfügbar!", "info", 5000);
    }

    if (hasRedPill) {
      const currentState = loadBatcherState(ns);
      if (currentState?.batchStrategy === "XP_GRIND" && !isXpRushActive) {
        isXpRushActive = true;
      } else if (currentState?.batchStrategy !== "XP_GRIND" && isXpRushActive) {
        isXpRushActive = false;
      }

      if (btn && statusEl) {
        if (isXpRushActive) {
          btn.style.background = "#0d3814";
          btn.style.borderColor = "#00ff66";
          btn.style.color = "#ffffff";
          btn.innerText = "DEFER DOMINATION (PAUSE)";
          statusEl.style.color = "#00ff66";
          statusEl.innerText = "⚡ XP_RUSH: MAX_LEVEL_GRIND";
        } else {
          btn.style.background = "#051a08";
          btn.style.borderColor = "#00aa44";
          btn.style.color = "#00ff66";
          btn.innerText = "ENGAGE XP RUSH";
          statusEl.style.color = "#008833";
          statusEl.innerText = "Status: Standby (Normalbetrieb)";
        }
      }
    }

    await ns.sleep(1000);
  }
}