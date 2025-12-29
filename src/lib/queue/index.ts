import * as fs from "fs";
import * as path from "path";
import { getProjectRoot } from "../project-link";

/**
 * Types of operations that can be queued
 */
export enum QueueOperationType {
  PUSH = "push",
  SYNC = "sync",
}

/**
 * Queue operation payload
 */
export interface QueueOperation {
  id: string;
  type: QueueOperationType;
  timestamp: number;
  payload: {
    // For PUSH operations
    schema?: any; // LocalApsorcSchema
    serviceId?: string;
    workspaceId?: string;
    options?: {
      generateCode?: boolean;
      gitPull?: boolean;
      force?: boolean;
    };
    // For SYNC operations
    strategy?: "local-wins" | "remote-wins" | "interactive";
  };
  retryCount?: number;
  lastError?: string;
}

/**
 * Queue metadata
 */
interface QueueMetadata {
  version: number;
  createdAt: number;
  lastUpdated: number;
  operations: QueueOperation[];
}

const QUEUE_FILE = ".apso/queue.json";
const MAX_QUEUE_SIZE = 50;
const MAX_RETRY_COUNT = 3;

/**
 * Get the queue file path
 */
function getQueuePath(): string {
  const projectRoot = getProjectRoot();
  return path.join(projectRoot, QUEUE_FILE);
}

/**
 * Ensure queue directory exists
 */
function ensureQueueDir(): void {
  const queuePath = getQueuePath();
  const queueDir = path.dirname(queuePath);
  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
  }
}

/**
 * Read the queue from disk
 */
export function readQueue(): QueueOperation[] {
  try {
    const queuePath = getQueuePath();
    if (!fs.existsSync(queuePath)) {
      return [];
    }

    const content = fs.readFileSync(queuePath);
    // eslint-disable-next-line unicorn/prefer-json-parse-buffer
    const metadata: QueueMetadata = JSON.parse(content.toString("utf8"));

    // Validate structure
    if (!Array.isArray(metadata.operations)) {
      return [];
    }

    return metadata.operations;
  } catch (error) {
    // If queue is corrupted, return empty array
    if (process.env.DEBUG || process.env.APSO_DEBUG) {
      console.log(`[DEBUG] Failed to read queue: ${(error as Error).message}`);
    }
    return [];
  }
}

/**
 * Write the queue to disk
 */
export function writeQueue(operations: QueueOperation[]): void {
  try {
    ensureQueueDir();
    const queuePath = getQueuePath();

    const metadata: QueueMetadata = {
      version: 1,
      createdAt: fs.existsSync(queuePath)
        // eslint-disable-next-line unicorn/prefer-json-parse-buffer
        ? JSON.parse(fs.readFileSync(queuePath).toString("utf8")).createdAt || Date.now()
        : Date.now(),
      lastUpdated: Date.now(),
      operations,
    };

    fs.writeFileSync(queuePath, JSON.stringify(metadata, null, 2), "utf8");
  } catch (error) {
    if (process.env.DEBUG || process.env.APSO_DEBUG) {
      console.log(`[DEBUG] Failed to write queue: ${(error as Error).message}`);
    }
    throw new Error(`Failed to write queue: ${(error as Error).message}`);
  }
}

/**
 * Add an operation to the queue
 */
export function enqueueOperation(
  operation: Omit<QueueOperation, "id" | "timestamp">
): void {
  const operations = readQueue();

  // Check queue size limit
  if (operations.length >= MAX_QUEUE_SIZE) {
    throw new Error(
      `Queue is full (${MAX_QUEUE_SIZE} operations). Please flush the queue or remove operations manually.`
    );
  }

  const newOperation: QueueOperation = {
    ...operation,
    id: `${Date.now()}-${Math.random().toString(36).slice(7)}`,
    timestamp: Date.now(),
    retryCount: 0,
  };

  operations.push(newOperation);
  writeQueue(operations);
}

/**
 * Remove an operation from the queue by ID
 */
export function dequeueOperation(operationId: string): QueueOperation | null {
  const operations = readQueue();
  const index = operations.findIndex((op) => op.id === operationId);

  if (index === -1) {
    return null;
  }

  const operation = operations[index];
  operations.splice(index, 1);
  writeQueue(operations);

  return operation;
}

/**
 * Get all queued operations
 */
export function getQueuedOperations(): QueueOperation[] {
  return readQueue();
}

/**
 * Get queued operations by type
 */
export function getQueuedOperationsByType(
  type: QueueOperationType
): QueueOperation[] {
  return readQueue().filter((op) => op.type === type);
}

/**
 * Clear all queued operations
 */
export function clearQueue(): void {
  writeQueue([]);
}

/**
 * Get queue statistics
 */
export function getQueueStats(): {
  total: number;
  byType: Record<QueueOperationType, number>;
  oldest: QueueOperation | null;
  newest: QueueOperation | null;
} {
  const operations = readQueue();
  const byType: Record<QueueOperationType, number> = {
    [QueueOperationType.PUSH]: 0,
    [QueueOperationType.SYNC]: 0,
  };

  for (const op of operations) {
    byType[op.type] = (byType[op.type] || 0) + 1;
  }

  return {
    total: operations.length,
    byType,
    oldest: operations.length > 0 ? operations[0] : null,
    newest: operations.length > 0 ? operations[operations.length - 1] : null,
  };
}

/**
 * Mark an operation as failed (increment retry count)
 */
export function markOperationFailed(operationId: string, error: string): void {
  const operations = readQueue();
  const operation = operations.find((op) => op.id === operationId);

  if (operation) {
    operation.retryCount = (operation.retryCount || 0) + 1;
    operation.lastError = error;
    writeQueue(operations);
  }
}

/**
 * Remove operations that have exceeded max retry count
 */
export function removeFailedOperations(): QueueOperation[] {
  const operations = readQueue();
  const failed: QueueOperation[] = [];
  const remaining: QueueOperation[] = [];

  for (const op of operations) {
    if ((op.retryCount || 0) >= MAX_RETRY_COUNT) {
      failed.push(op);
    } else {
      remaining.push(op);
    }
  }

  if (failed.length > 0) {
    writeQueue(remaining);
  }

  return failed;
}

/**
 * Consolidate queue operations (remove duplicates, keep latest)
 */
export function consolidateQueue(): {
  removed: number;
  consolidated: QueueOperation[];
} {
  const operations = readQueue();
  const seen = new Map<string, QueueOperation>();

  // Process operations in order, keeping the latest of each type
  for (const op of operations) {
    const key = `${op.type}-${JSON.stringify(op.payload)}`;
    const existing = seen.get(key);

    if (!existing || op.timestamp > existing.timestamp) {
      seen.set(key, op);
    }
  }

  const consolidated = [...seen.values()];
  const removed = operations.length - consolidated.length;

  if (removed > 0) {
    writeQueue(consolidated);
  }

  return {
    removed,
    consolidated,
  };
}

/**
 * Type aliases for queue operations (for backward compatibility)
 */
export type QueuedPushOperation = QueueOperation & {
  type: QueueOperationType.PUSH;
  schemaPath?: string;
};

export type QueuedSyncOperation = QueueOperation & {
  type: QueueOperationType.SYNC;
  strategy?: "local-wins" | "remote-wins" | "interactive";
};

export type AnyQueuedOperation = QueueOperation;

/**
 * Check if there are any queued operations
 */
export function hasQueuedOperations(): boolean {
  return readQueue().length > 0;
}

/**
 * Format queue age for display
 */
export function formatQueueAge(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  const ageSecs = Math.floor(ageMs / 1000);
  const ageMins = Math.floor(ageSecs / 60);
  const ageHours = Math.floor(ageMins / 60);
  const ageDays = Math.floor(ageHours / 24);

  if (ageSecs < 60) {
    return ageSecs + " second" + (ageSecs === 1 ? "" : "s") + " ago";
  } if (ageMins < 60) {
    return ageMins + " minute" + (ageMins === 1 ? "" : "s") + " ago";
  } if (ageHours < 24) {
    return ageHours + " hour" + (ageHours === 1 ? "" : "s") + " ago";
  } 
    return ageDays + " day" + (ageDays === 1 ? "" : "s") + " ago";
  
}

/**
 * Increment retry count for an operation
 */
export function incrementRetryCount(operationId: string): void {
  const operations = readQueue();
  const operation = operations.find((op) => op.id === operationId);

  if (operation) {
    operation.retryCount = (operation.retryCount || 0) + 1;
    writeQueue(operations);
  }
}

/**
 * Check if queue is full
 */
export function isQueueFull(): boolean {
  return readQueue().length >= MAX_QUEUE_SIZE;
}
