import { bytesPerSecToMbps } from "./format.ts";
import type { ProgressSnapshot, TransferPhase } from "./types.ts";

/**
 * Tracks real-time transfer throughput, EMA-smoothed speed, bandwidth utilization, and ETA.
 */
export class TransferMeter {
  private readonly startTimeMs: number;
  private lastSampleTimeMs: number;
  private lastSampleBytes = 0;
  private bytesProcessed = 0;
  private emaSpeedBytesPerSec = 0;
  private peakSpeedBytesPerSec = 0;
  private currentPart?: number;
  private totalParts?: number;

  constructor(
    private readonly phase: TransferPhase,
    private readonly totalBytes: number,
    private readonly linkSpeedMbps: number,
    private readonly emaAlpha = 0.35,
  ) {
    const now = performance.now();
    this.startTimeMs = now;
    this.lastSampleTimeMs = now;
  }

  /**
   * Advances the meter by `deltaBytes` and recomputes smoothed speed, bandwidth, and ETA.
   */
  public addBytes(deltaBytes: number, currentPart?: number, totalParts?: number): void {
    this.bytesProcessed = Math.min(this.totalBytes, Math.max(0, this.bytesProcessed + deltaBytes));
    if (currentPart !== undefined) this.currentPart = currentPart;
    if (totalParts !== undefined) this.totalParts = totalParts;
    this.sample();
  }

  /**
   * Sets the absolute byte counter (useful when a worker reports cumulative bytes).
   */
  public setBytes(totalProcessed: number, currentPart?: number, totalParts?: number): void {
    this.bytesProcessed = Math.min(this.totalBytes, Math.max(0, totalProcessed));
    if (currentPart !== undefined) this.currentPart = currentPart;
    if (totalParts !== undefined) this.totalParts = totalParts;
    this.sample();
  }

  private sample(): void {
    const now = performance.now();
    const dtMs = now - this.lastSampleTimeMs;
    const dBytes = this.bytesProcessed - this.lastSampleBytes;

    if (dtMs >= 25 && dBytes >= 0) {
      const instantSpeed = (dBytes / dtMs) * 1000;
      if (this.emaSpeedBytesPerSec === 0) {
        this.emaSpeedBytesPerSec = instantSpeed;
      } else {
        this.emaSpeedBytesPerSec =
          this.emaAlpha * instantSpeed + (1 - this.emaAlpha) * this.emaSpeedBytesPerSec;
      }
      if (instantSpeed > this.peakSpeedBytesPerSec) {
        this.peakSpeedBytesPerSec = instantSpeed;
      }
      this.lastSampleTimeMs = now;
      this.lastSampleBytes = this.bytesProcessed;
    }
  }

  /**
   * Produces a point-in-time progress snapshot for CLI or TUI rendering.
   */
  public snapshot(message?: string): ProgressSnapshot {
    const now = performance.now();
    const elapsedMs = Math.max(1, now - this.startTimeMs);
    const avgSpeedBytesPerSec = (this.bytesProcessed / elapsedMs) * 1000;
    const effectiveSpeed =
      this.emaSpeedBytesPerSec > 0 ? this.emaSpeedBytesPerSec : avgSpeedBytesPerSec;
    const peak = Math.max(this.peakSpeedBytesPerSec, avgSpeedBytesPerSec);

    const percent =
      this.totalBytes === 0 ? 100 : Math.min(100, (this.bytesProcessed / this.totalBytes) * 100);
    const bandwidthMbps = bytesPerSecToMbps(effectiveSpeed);
    const bandwidthUtilizationPct =
      this.linkSpeedMbps > 0 ? Math.min(100, (bandwidthMbps / this.linkSpeedMbps) * 100) : 0;

    const remainingBytes = Math.max(0, this.totalBytes - this.bytesProcessed);
    let etaSeconds: number | null = null;
    if (remainingBytes === 0) {
      etaSeconds = 0;
    } else if (effectiveSpeed > 0) {
      etaSeconds = remainingBytes / effectiveSpeed;
    }

    return {
      phase: this.phase,
      bytesProcessed: this.bytesProcessed,
      totalBytes: this.totalBytes,
      percent,
      speedBytesPerSec: effectiveSpeed,
      avgSpeedBytesPerSec,
      peakSpeedBytesPerSec: peak,
      bandwidthMbps,
      bandwidthUtilizationPct,
      etaSeconds,
      elapsedMs,
      currentPart: this.currentPart,
      totalParts: this.totalParts,
      message,
    };
  }
}
