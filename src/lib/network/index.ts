import { getApiBaseUrl } from "../config/index";

/**
 * Network connectivity status
 */
export enum NetworkStatus {
  ONLINE = "online",
  OFFLINE = "offline",
  UNKNOWN = "unknown",
}

/**
 * Options for network detection
 */
export interface NetworkDetectionOptions {
  /**
   * Timeout in milliseconds for connectivity check
   * @default 5000 (5 seconds)
   */
  timeout?: number;
  /**
   * URL to check connectivity against
   * @default API base URL
   */
  checkUrl?: string;
  /**
   * Whether to use cached status
   * @default true
   */
  useCache?: boolean;
  /**
   * Cache TTL in milliseconds
   * @default 30000 (30 seconds)
   */
  cacheTtl?: number;
}

/**
 * Cached network status
 */
interface CachedNetworkStatus {
  status: NetworkStatus;
  timestamp: number;
}

let cachedStatus: CachedNetworkStatus | null = null;

/**
 * Check if the system is online by attempting to reach the API base URL
 * or a specified URL.
 *
 * @param options - Network detection options
 * @returns Promise resolving to true if online, false if offline
 */
export async function isOnline(
  options: NetworkDetectionOptions = {}
): Promise<boolean> {
  const {
    timeout = 5000,
    checkUrl,
    useCache = true,
    cacheTtl = 30_000,
  } = options;

  // Check cache if enabled
  if (useCache && cachedStatus) {
    const age = Date.now() - cachedStatus.timestamp;
    if (age < cacheTtl) {
      return cachedStatus.status === NetworkStatus.ONLINE;
    }
  }

  // Determine URL to check
  const urlToCheck = checkUrl || getApiBaseUrl();

  try {
    // Use fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(urlToCheck, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeoutId);

    const online = response.ok || response.status < 500;
    const status = online ? NetworkStatus.ONLINE : NetworkStatus.OFFLINE;

    // Cache the result
    if (useCache) {
      cachedStatus = {
        status,
        timestamp: Date.now(),
      };
    }

    return online;
  } catch {
    // Network error - assume offline
    const status = NetworkStatus.OFFLINE;

    // Cache the result
    if (useCache) {
      cachedStatus = {
        status,
        timestamp: Date.now(),
      };
    }

    return false;
  }
}

/**
 * Get current network status (synchronous, uses cache if available)
 *
 * @returns Current network status
 */
export function getNetworkStatus(): NetworkStatus {
  if (cachedStatus) {
    const age = Date.now() - cachedStatus.timestamp;
    // Consider cache valid for 30 seconds
    if (age < 30_000) {
      return cachedStatus.status;
    }
  }
  return NetworkStatus.UNKNOWN;
}

/**
 * Check if currently offline (synchronous, uses cache)
 *
 * @returns true if offline, false if online or unknown
 */
export function isOffline(): boolean {
  return getNetworkStatus() === NetworkStatus.OFFLINE;
}

/**
 * Clear cached network status
 */
export function clearNetworkCache(): void {
  cachedStatus = null;
}

/**
 * Ensure network connectivity before proceeding
 *
 * @param options - Network detection options
 * @throws Error if offline
 */
export async function ensureOnline(
  options: NetworkDetectionOptions = {}
): Promise<void> {
  const online = await isOnline(options);
  if (!online) {
    throw new Error(
      "Network is offline. Please check your internet connection and try again.\n" +
        "You can use cached data with appropriate flags, or queue operations for later."
    );
  }
}

/**
 * Check network connectivity with a simple ping to a reliable endpoint
 * Falls back to checking API base URL if ping fails
 *
 * @param options - Network detection options
 * @returns Promise resolving to network status
 */
export async function checkNetworkStatus(
  options: NetworkDetectionOptions = {}
): Promise<NetworkStatus> {
  const online = await isOnline(options);
  return online ? NetworkStatus.ONLINE : NetworkStatus.OFFLINE;
}
