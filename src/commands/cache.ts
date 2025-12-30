import { Flags, Args } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import {
  clearCache,
  clearAllCache,
  getCacheStats,
} from "../lib/cache";

export default class Cache extends BaseCommand {
  static description = "Manage CLI cache";

  static examples = [
    `$ apso cache clear        # Clear all cached data`,
    `$ apso cache clear <key>  # Clear a specific cache entry`,
    `$ apso cache stats        # Show cache statistics`,
  ];

  static flags = {
    json: Flags.boolean({
      char: "j",
      description: "Output as JSON",
      default: false,
    }),
  };

  static args = {
    action: Args.string({
      description: "Action: clear or stats",
      required: true,
      options: ["clear", "stats"],
    }),
    key: Args.string({
      description: "Cache key (for clear action, optional - clears all if not provided)",
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Cache);
    const { action, key } = args;

    switch (action) {
      case "clear":
        await this.handleClear(key, flags.json);
        break;

      case "stats":
        await this.handleStats(flags.json);
        break;

      default:
        this.error(`Unknown action: ${action}. Use 'clear' or 'stats'`);
    }
  }

  private async handleClear(key: string | undefined, json: boolean): Promise<void> {
    if (key) {
      clearCache(key);
      if (json) {
        this.log(JSON.stringify({ success: true, message: `Cache entry "${key}" cleared` }));
      } else {
        this.log(`✓ Cache entry "${key}" cleared`);
      }
    } else {
      clearAllCache();
      if (json) {
        this.log(JSON.stringify({ success: true, message: "All cache cleared" }));
      } else {
        this.log("✓ All cache cleared");
      }
    }
  }

  private async handleStats(json: boolean): Promise<void> {
    const stats = getCacheStats();

    if (json) {
      this.log(
        JSON.stringify({
          totalEntries: stats.totalEntries,
          entries: stats.entries.map((entry) => ({
            key: entry.key,
            age: entry.age,
            ttl: entry.ttl,
            expired: entry.expired,
            ageFormatted: this.formatAge(entry.age),
            ttlFormatted: this.formatTTL(entry.ttl),
          })),
        })
      );
    } else {
      if (stats.totalEntries === 0) {
        this.log("No cache entries found.");
        return;
      }

      this.log("");
      this.log(`Total cache entries: ${stats.totalEntries}`);
      this.log("");

      for (const entry of stats.entries) {
        const status = entry.expired ? "(expired)" : "(valid)";
        this.log(`  ${entry.key} ${status}`);
        this.log(`    Age: ${this.formatAge(entry.age)}`);
        this.log(`    TTL: ${this.formatTTL(entry.ttl)}`);
        this.log("");
      }
    }
  }

  private formatAge(ageMs: number): string {
    const ageSecs = Math.floor(ageMs / 1000);
    const ageMins = Math.floor(ageSecs / 60);
    const ageHours = Math.floor(ageMins / 60);

    if (ageSecs < 60) {
      return `${ageSecs} second${ageSecs === 1 ? "" : "s"}`;
    }
    if (ageMins < 60) {
      return `${ageMins} minute${ageMins === 1 ? "" : "s"}`;
    }
    return `${ageHours} hour${ageHours === 1 ? "" : "s"}`;
  }

  private formatTTL(ttlMs: number): string {
    const ttlSecs = Math.floor(ttlMs / 1000);
    const ttlMins = Math.floor(ttlSecs / 60);

    if (ttlSecs < 60) {
      return `${ttlSecs} second${ttlSecs === 1 ? "" : "s"}`;
    }
    return `${ttlMins} minute${ttlMins === 1 ? "" : "s"}`;
  }
}

