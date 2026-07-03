/**
 * Per-device sequence tracking → loss/duplicate/ordering metrics.
 * `seq` is monotonic per device (ingestion guarantees it). Interpreting the next seq
 * for a device:
 *   - prev+1        → in order
 *   - > prev+1      → gap: (seq − prev − 1) messages missing
 *   - == prev       → duplicate
 *   - < prev        → out of order (late/reordered)
 * The first seq seen per device only sets the baseline (ingestion may have been
 * running already), so it never counts as a gap.
 */
export interface SeqStats {
  devices: number;
  received: number;
  missing: number; // total messages inferred lost (sum of gap sizes)
  gaps: number; // number of gap events
  duplicates: number;
  outOfOrder: number;
}

export class SeqTracker {
  private readonly last = new Map<string, number>();
  private received = 0;
  private missing = 0;
  private gaps = 0;
  private duplicates = 0;
  private outOfOrder = 0;

  observe(device: string, seq: number): void {
    this.received++;
    const prev = this.last.get(device);
    if (prev === undefined) {
      this.last.set(device, seq);
      return;
    }
    if (seq === prev + 1) {
      this.last.set(device, seq);
    } else if (seq > prev + 1) {
      this.gaps++;
      this.missing += seq - prev - 1;
      this.last.set(device, seq);
    } else if (seq === prev) {
      this.duplicates++;
    } else {
      this.outOfOrder++;
    }
  }

  stats(): SeqStats {
    return {
      devices: this.last.size,
      received: this.received,
      missing: this.missing,
      gaps: this.gaps,
      duplicates: this.duplicates,
      outOfOrder: this.outOfOrder,
    };
  }
}
