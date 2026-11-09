/**
 * In-browser pub/sub with ROS-style topics, so the UI can inspect the simulator the way
 * Foxglove inspects a robot: topic list, rates, last message, plots.
 * Every message here is produced by simulator code (joint states from the executor, TF from
 * forward kinematics, camera detections from rendered frames, plans from the planner).
 */

export interface TopicStats {
  name: string;
  type: string;
  count: number;
  /** Messages per second over the last two seconds. */
  hz: number;
  /** ms since the topic last published. */
  ageMs: number;
  last: unknown;
}

type TopicCb = (msg: unknown, stampMs: number) => void;

interface TopicState {
  type: string;
  /** Recent messages, kept only for topics registered with retain(). */
  history?: { t: number; msg: unknown }[];
  keep?: number;
  count: number;
  stamps: number[];
  last: unknown;
  lastStamp: number;
  subs: Set<TopicCb>;
}

class TopicBus {
  private topics = new Map<string, TopicState>();
  private changeListeners = new Set<() => void>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  publish(name: string, type: string, msg: unknown): void {
    const now = performance.now();
    let t = this.topics.get(name);
    if (!t) {
      t = { type, count: 0, stamps: [], last: null, lastStamp: 0, subs: new Set() };
      this.topics.set(name, t);
    }
    if (!t.type) t.type = type; // a subscriber may have created the topic before its first publish
    t.count++;
    t.last = msg;
    t.lastStamp = now;
    t.stamps.push(now);
    if (t.history && t.keep) {
      t.history.push({ t: now, msg });
      if (t.history.length > t.keep) t.history.splice(0, t.history.length - t.keep);
    }
    if (t.stamps.length > 240) t.stamps.splice(0, t.stamps.length - 240);
    t.subs.forEach((cb) => cb(msg, now));
    this.scheduleNotify();
  }

  /** Subscribe to one topic (works before the topic has published). */
  subscribe(name: string, cb: TopicCb, type = ''): () => void {
    let t = this.topics.get(name);
    if (!t) {
      t = { type, count: 0, stamps: [], last: null, lastStamp: 0, subs: new Set() };
      this.topics.set(name, t);
    }
    t.subs.add(cb);
    return () => t!.subs.delete(cb);
  }

  /** Record the last `max` messages of a topic so panels can show history from before they were opened. */
  retain(name: string, max: number): void {
    let t = this.topics.get(name);
    if (!t) {
      t = { type: '', count: 0, stamps: [], last: null, lastStamp: 0, subs: new Set() };
      this.topics.set(name, t);
    }
    t.keep = max;
    t.history = t.history ?? [];
  }

  history(name: string): { t: number; msg: unknown }[] {
    return this.topics.get(name)?.history ?? [];
  }

  latest<T = unknown>(name: string): T | null {
    return (this.topics.get(name)?.last as T) ?? null;
  }

  snapshot(): TopicStats[] {
    const now = performance.now();
    return [...this.topics.entries()]
      .filter(([, t]) => t.count > 0)
      .map(([name, t]) => {
        const recent = t.stamps.filter((s) => now - s <= 2000).length;
        return { name, type: t.type, count: t.count, hz: recent / 2, ageMs: now - t.lastStamp, last: t.last };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Called (throttled) whenever any topic publishes. */
  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  private scheduleNotify() {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.changeListeners.forEach((cb) => cb());
    }, 120);
  }
}

export const topicBus = new TopicBus();
