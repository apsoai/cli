import { describe, test, expect } from "@jest/globals";
import { spawn } from "child_process";
import * as path from "path";

/**
 * Test the global error handlers that capture crashes.
 * These tests spawn child processes to verify:
 * - Non-zero exit codes
 * - Error output to stderr
 * - No hanging (timeout ensures termination)
 */
describe("global error handlers", () => {
  const timeout = 5000; // 5s max for crash handling

  test("uncaughtException exits non-zero and prints to stderr", (done) => {
    const script = `
      require('${path.join(__dirname, "../../../dist/lib/telemetry/telemetry.js")}').initTelemetry();
      setTimeout(() => {
        throw new Error('Test uncaught exception');
      }, 100);
    `;

    const child = spawn(process.execPath, ["-e", script], {
      timeout,
      env: { ...process.env, APSO_TELEMETRY: "0" }, // Disable actual telemetry
    });

    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      expect(code).not.toBe(0);
      expect(stderr).toContain("Test uncaught exception");
      done();
    });
  }, timeout + 1000);

  test("unhandledRejection exits non-zero and prints to stderr", (done) => {
    const script = `
      require('${path.join(__dirname, "../../../dist/lib/telemetry/telemetry.js")}').initTelemetry();
      setTimeout(() => {
        Promise.reject(new Error('Test unhandled rejection'));
      }, 100);
    `;

    const child = spawn(process.execPath, ["-e", script], {
      timeout,
      env: { ...process.env, APSO_TELEMETRY: "0" },
    });

    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      expect(code).not.toBe(0);
      expect(stderr).toContain("Test unhandled rejection");
      done();
    });
  }, timeout + 1000);

  test("crash handler does not hang when flush stalls", (done) => {
    // This test verifies the 2s timeout works - process should exit within 3s
    const script = `
      const telemetry = require('${path.join(__dirname, "../../../dist/lib/telemetry/telemetry.js")}');
      // Mock shutdownTelemetry to stall forever
      telemetry.shutdownTelemetry = () => new Promise(() => {});
      telemetry.initTelemetry();
      setTimeout(() => {
        throw new Error('Test timeout');
      }, 100);
    `;

    const startTime = Date.now();
    const child = spawn(process.execPath, ["-e", script], {
      timeout: 4000,
      env: { ...process.env, APSO_TELEMETRY: "0" },
    });

    child.on("close", (code) => {
      const elapsed = Date.now() - startTime;
      expect(code).not.toBe(0);
      expect(elapsed).toBeLessThan(3500); // Should exit within ~2.1s (100ms + 2s timeout + margin)
      done();
    });
  }, 5000);

  test("re-entry guard prevents double handling", (done) => {
    // Test that if the error handler itself throws (e.g., during telemetry capture),
    // the re-entry guard catches it and exits immediately
    const script = `
      const telemetry = require('${path.join(__dirname, "../../../dist/lib/telemetry/telemetry.js")}');
      // Monkey-patch captureException to throw, simulating error during telemetry
      const original = telemetry.captureException;
      let callCount = 0;
      telemetry.captureException = function() {
        callCount++;
        if (callCount === 1) {
          // First call throws, triggering re-entry
          throw new Error('Telemetry error');
        }
      };
      telemetry.initTelemetry();
      setTimeout(() => {
        throw new Error('Initial error');
      }, 100);
    `;

    const child = spawn(process.execPath, ["-e", script], {
      timeout,
      env: { ...process.env, APSO_TELEMETRY: "0" },
    });

    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      // Should exit non-zero (1 from re-entry guard or similar)
      expect(code).not.toBe(0);
      // Should print something to stderr
      expect(stderr.length).toBeGreaterThan(0);
      done();
    });
  }, timeout + 1000);
});
