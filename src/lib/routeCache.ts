/**
 * In-memory LRU cache for Google Maps route calculations.
 * Avoids redundant API calls when the same origin→destination pair
 * is recalculated (e.g. on re-renders, minor schedule edits).
 *
 * Cache entries expire after 30 minutes.
 */

interface CachedRoute {
  durationMinutes: number;
  distanceKm: number;
  durationText: string;
  distanceText: string;
}

interface CacheEntry {
  data: CachedRoute;
  timestamp: number;
}

const MAX_ENTRIES = 200;
const TTL_MS = 30 * 60 * 1000; // 30 minutes

class RouteCache {
  private cache = new Map<string, CacheEntry>();

  get(key: string): CachedRoute | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (LRU behavior)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data;
  }

  set(key: string, data: CachedRoute): void {
    if (this.cache.size >= MAX_ENTRIES) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// Singleton instance
export const routeCache = new RouteCache();
