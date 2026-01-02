import * as fs from "fs";
import * as path from "path";
import { getProjectRoot } from "../project-link";

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

export interface CacheConfig {
  defaultTtl?: number; // Default TTL in milliseconds (default: 5 minutes)
  cacheDir?: string; // Cache directory (default: .apso/cache)
}

export const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get the cache directory path
 */
function getCacheDir(): string {
  const projectRoot = getProjectRoot();
  return path.join(projectRoot, ".apso", "cache");
}

/**
 * Ensure cache directory exists
 */
function ensureCacheDir(): void {
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}

/**
 * Get cache file path for a given key
 */
function getCacheFilePath(key: string): string {
  ensureCacheDir();
  // Sanitize key to be filesystem-safe
  const safeKey = key.replace(/[^\w-]/g, "_");
  return path.join(getCacheDir(), `${safeKey}.json`);
}

/**
 * Read a cache entry
 */
export function readCache<T>(key: string): T | null {
  try {
    const cachePath = getCacheFilePath(key);
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const content = fs.readFileSync(cachePath, "utf8");
    const entry: CacheEntry<T> = JSON.parse(content);

    // Check if cache is expired
    const now = Date.now();
    const age = now - entry.timestamp;
    if (age > entry.ttl) {
      // Cache expired, delete it
      fs.unlinkSync(cachePath);
      return null;
    }

    return entry.data;
  } catch {
    // If cache is corrupted, delete it
    try {
      const cachePath = getCacheFilePath(key);
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
    } catch {
      // Ignore errors during cleanup
    }
    return null;
  }
}

/**
 * Write a cache entry
 */
export function writeCache<T>(
  key: string,
  data: T,
  ttl: number = DEFAULT_TTL
): void {
  try {
    ensureCacheDir();
    const cachePath = getCacheFilePath(key);
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
    };
    fs.writeFileSync(cachePath, JSON.stringify(entry, null, 2), "utf8");
  } catch (error) {
    // Silently fail - caching is not critical
    if (process.env.DEBUG || process.env.APSO_DEBUG) {
      console.log(`[DEBUG] Failed to write cache for key "${key}":`, error);
    }
  }
}

/**
 * Check if a cache entry exists and is valid
 */
export function hasCache(key: string): boolean {
  try {
    const cachePath = getCacheFilePath(key);
    if (!fs.existsSync(cachePath)) {
      return false;
    }

    const content = fs.readFileSync(cachePath, "utf8");
    const entry: CacheEntry<any> = JSON.parse(content);

    const now = Date.now();
    const age = now - entry.timestamp;
    return age <= entry.ttl;
  } catch {
    return false;
  }
}

/**
 * Get cache age in milliseconds
 */
export function getCacheAge(key: string): number | null {
  try {
    const cachePath = getCacheFilePath(key);
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const content = fs.readFileSync(cachePath, "utf8");
    const entry: CacheEntry<any> = JSON.parse(content);

    const now = Date.now();
    return now - entry.timestamp;
  } catch {
    return null;
  }
}

/**
 * Clear a specific cache entry
 */
export function clearCache(key: string): void {
  try {
    const cachePath = getCacheFilePath(key);
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Clear all cache entries
 */
export function clearAllCache(): void {
  try {
    const cacheDir = getCacheDir();
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          fs.unlinkSync(path.join(cacheDir, file));
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  totalEntries: number;
  entries: Array<{ key: string; age: number; ttl: number; expired: boolean }>;
} {
  try {
    const cacheDir = getCacheDir();
    if (!fs.existsSync(cacheDir)) {
      return { totalEntries: 0, entries: [] };
    }

    const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
    const entries: Array<{ key: string; age: number; ttl: number; expired: boolean }> = [];
    const now = Date.now();

    for (const file of files) {
      try {
        const cachePath = path.join(cacheDir, file);
        const content = fs.readFileSync(cachePath, "utf8");
        const entry: CacheEntry<any> = JSON.parse(content);
        const age = now - entry.timestamp;
        const expired = age > entry.ttl;

        entries.push({
          key: file.replace(".json", ""),
          age,
          ttl: entry.ttl,
          expired,
        });
      } catch {
        // Skip corrupted entries
      }
    }

    return {
      totalEntries: entries.length,
      entries,
    };
  } catch {
    return { totalEntries: 0, entries: [] };
  }
}

