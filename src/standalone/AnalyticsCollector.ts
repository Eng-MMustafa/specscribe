/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/

export interface AnalyticsEvent {
  method: string;
  path: string;
  status: number;
  /** ISO timestamp. */
  at: string;
  /** Whether the response came from the mock server rather than a real app. */
  mock?: boolean;
}

/**
 * Lightweight, in-memory analytics collector for the standalone docs server.
 * Records each proxied and mocked request and exposes a small summary.
 */
export class AnalyticsCollector {
  private events: AnalyticsEvent[] = [];

  record(event: AnalyticsEvent): void {
    this.events.push(event);
  }

  summary(): {
    total: number;
    byStatus: Record<string, number>;
    byPath: Record<string, number>;
    recent: AnalyticsEvent[];
  } {
    const byStatus: Record<string, number> = {};
    const byPath: Record<string, number> = {};
    for (const event of this.events) {
      byStatus[event.status] = (byStatus[event.status] || 0) + 1;
      byPath[event.path] = (byPath[event.path] || 0) + 1;
    }
    return {
      total: this.events.length,
      byStatus,
      byPath,
      recent: this.events.slice(-50).reverse(),
    };
  }
}
