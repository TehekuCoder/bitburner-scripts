/**
 * Hilfsklasse zur Berechnung des exponentiell geglätteten Durchschnitts (EMA)
 * und der verbleibenden Zeit (ETA) für verschiedene Bot-Strategien.
 */
export class MetricTracker {
  private lastValue = 0;
  private lastTime = Date.now();
  private emaRate = 0;
  private lastMode = "";

  /**
   * Aktualisiert den Tracker mit den aktuellen Werten und berechnet die EMA-Rate neu.
   * @param mode Die aktuelle Bot-Strategie (z.B. "REP", "CORP", "TRAIN")
   * @param currentVal Der aktuelle Fortschrittswert
   * @param targetVal Das Ziel, das erreicht werden soll
   * @param onModeChange Callback-Funktion, die bei einem Strategiewechsel triggert
   */
  public update(
    mode: string,
    currentVal: number,
    targetVal: number,
    onModeChange?: (oldMode: string, newMode: string) => void
  ): void {
    const now = Date.now();

    // Bei einem Strategiewechsel setzen wir alle Berechnungen zurück
    if (mode !== this.lastMode) {
      if (onModeChange) {
        onModeChange(this.lastMode, mode);
      }
      this.lastValue = currentVal;
      this.lastTime = now;
      this.emaRate = 0;
      this.lastMode = mode;
      return;
    }

    // Berechnung nur ausführen, wenn ein valides Ziel existiert
    if (targetVal > 0) {
      const timeDiff = now - this.lastTime;
      
      // Update alle 4 Sekunden (4000ms), um Ausreißer im Loop zu dämpfen
      if (timeDiff >= 4000) {
        const valDiff = currentVal - this.lastValue;
        
        if (valDiff > 0) {
          const instantRate = valDiff / (timeDiff / 1000);
          // Exponential Moving Average (EMA): 70% alter Wert, 30% neuer Messwert
          this.emaRate =
            this.emaRate === 0
              ? instantRate
              : this.emaRate * 0.7 + instantRate * 0.3;
        }
        
        this.lastValue = currentVal;
        this.lastTime = now;
      }
    }
  }

  /**
   * Generiert einen sauber formatierten ETA-String.
   */
  public getEtaString(mode: string, currentVal: number, targetVal: number): string {
    if (targetVal === 0 && ["REP", "CORP", "TRAIN"].includes(mode)) {
      return "Fertig (Max)";
    }

    if (this.emaRate > 0) {
      const remaining = targetVal - currentVal;
      if (remaining <= 0) {
        return "Fertig";
      }

      const secondsLeft = remaining / this.emaRate;
      
      if (secondsLeft > 3600) {
        return `${Math.floor(secondsLeft / 3600)}h ${Math.floor((secondsLeft % 3600) / 60)}m`;
      } else if (secondsLeft > 60) {
        return `${Math.floor(secondsLeft / 60)}m ${Math.floor(secondsLeft % 60)}s`;
      } else {
        return `${Math.ceil(secondsLeft)}s`;
      }
    }

    return "Berechne...";
  }

  /**
   * Gibt die aktuelle EMA-Rate (Fortschritt pro Sekunde) zurück.
   */
  public getRate(): number {
    return this.emaRate;
  }
}