import { expect, describe, test } from "@jest/globals";
import {
  redactSensitiveData,
  truncate,
  normalizeErrorMessage,
  getErrorClass,
  getErrorCode,
  getErrorEntity,
  getErrorField,
  getErrorMessages,
  extractErrorProperties,
  extractErrorMessages,
  isConfigOrValidationError,
  MAX_ERROR_MESSAGES,
} from "../../../src/lib/telemetry/error-utils";
import { ApsorcNamingError } from "../../../src/lib/apsorc-parser";

describe("redactSensitiveData", () => {
  test("redacts home directory paths", () => {
    const homeDir = require("os").homedir();
    const path = `${homeDir}/projects/apso/src/index.ts`;
    expect(redactSensitiveData(path)).toBe("~/projects/apso/src/index.ts");
  });

  test("redacts API keys", () => {
    // Build fake API keys at runtime to avoid tripping security scanners
    const fakeApiKey1 = `api_key: sk_${"live"}_${"a".repeat(10)}${"12345"}`;
    const fakeApiKey2 = `api-key=${"1234567890".repeat(2)}abc`;
    expect(redactSensitiveData(fakeApiKey1)).toContain("[REDACTED]");
    expect(redactSensitiveData(fakeApiKey2)).toContain("[REDACTED]");
  });

  test("redacts tokens", () => {
    // Build fake tokens at runtime
    const fakeToken1 = `token: ghp_${"1234567890"}${"abcdefghij"}`;
    const fakeToken2 = `Bearer ${"eyJhbGc"}...`;
    expect(redactSensitiveData(fakeToken1)).toContain("[REDACTED]");
    expect(redactSensitiveData(fakeToken2)).toContain("[REDACTED]");
  });

  test("redacts secrets", () => {
    const fakeSecret = `secret: my-${"secret"}-value-123`;
    expect(redactSensitiveData(fakeSecret)).toContain("[REDACTED]");
  });

  test("redacts passwords", () => {
    const fakePassword = `password: MyP@ssw${"0"}rd!`;
    expect(redactSensitiveData(fakePassword)).toContain("[REDACTED]");
  });

  test("redacts environment variables", () => {
    const fakeEnv = `DATABASE_URL=postgres://${"user"}:${"pass"}@host/db`;
    expect(redactSensitiveData(fakeEnv)).toContain("[REDACTED]");
  });

  test("redacts JWT tokens", () => {
    // Build a fake JWT structure at runtime (not a real token)
    const header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const payload = "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ";
    const signature = `SflKxwRJSMeKKF2QT4fwpMeJf36POk6${"yJV_adQssw5c"}`;
    const fakeJwt = `${header}.${payload}.${signature}`;
    expect(redactSensitiveData(fakeJwt)).toContain("[REDACTED]");
  });

  test("does not redact safe error messages", () => {
    const message = 'Entity "Contact" has invalid field "email"';
    expect(redactSensitiveData(message)).toBe(message);
  });
});

describe("truncate", () => {
  test("does not truncate short strings", () => {
    const short = "This is a short message";
    expect(truncate(short)).toBe(short);
  });

  test("truncates long strings with ellipsis", () => {
    const long = "a".repeat(600);
    const truncated = truncate(long, 500);
    expect(truncated).toHaveLength(500);
    expect(truncated.endsWith("...")).toBe(true);
  });

  test("respects custom max length", () => {
    const str = "a".repeat(100);
    const truncated = truncate(str, 50);
    expect(truncated).toHaveLength(50);
    expect(truncated.endsWith("...")).toBe(true);
  });
});

describe("normalizeErrorMessage", () => {
  test("combines redaction and truncation", () => {
    const homeDir = require("os").homedir();
    // Build fake token at runtime to avoid tripping security scanner
    const fakeToken = ["sk", "live", "1234567890".repeat(3)].join("_");
    const message = `File not found: ${homeDir}/long/path/to/file.ts with token: ${fakeToken}`;
    const normalized = normalizeErrorMessage(message);
    expect(normalized).toContain("~/long/path/to/file.ts");
    expect(normalized).toContain("[REDACTED]");
    expect(normalized.length).toBeLessThanOrEqual(500);
  });
});

describe("getErrorClass", () => {
  test("extracts error class name", () => {
    expect(getErrorClass(new Error("test"))).toBe("Error");
    expect(getErrorClass(new TypeError("test"))).toBe("TypeError");
    expect(getErrorClass(new ApsorcNamingError("test", "CODE", "Entity"))).toBe(
      "ApsorcNamingError"
    );
  });

  test("returns undefined for non-objects", () => {
    expect(getErrorClass("string error")).toBeUndefined();
    expect(getErrorClass(null)).toBeUndefined();
  });
});

describe("getErrorCode", () => {
  test("extracts error code when present", () => {
    const err = new Error("test") as Error & { code?: string };
    err.code = "ENOENT";
    expect(getErrorCode(err)).toBe("ENOENT");
  });

  test("extracts code from ApsorcNamingError", () => {
    const err = new ApsorcNamingError(
      "Field collision",
      "FIELD_RELATIONSHIP_COLLISION",
      "Contact",
      "notes"
    );
    expect(getErrorCode(err)).toBe("FIELD_RELATIONSHIP_COLLISION");
  });

  test("returns undefined when no code", () => {
    expect(getErrorCode(new Error("test"))).toBeUndefined();
  });
});

describe("getErrorEntity", () => {
  test("extracts entity from ApsorcNamingError", () => {
    const err = new ApsorcNamingError(
      "Field collision",
      "FIELD_RELATIONSHIP_COLLISION",
      "Contact",
      "notes"
    );
    expect(getErrorEntity(err)).toBe("Contact");
  });

  test("returns undefined when no entity", () => {
    expect(getErrorEntity(new Error("test"))).toBeUndefined();
  });
});

describe("getErrorField", () => {
  test("extracts field from ApsorcNamingError", () => {
    const err = new ApsorcNamingError(
      "Field collision",
      "FIELD_RELATIONSHIP_COLLISION",
      "Contact",
      "notes"
    );
    expect(getErrorField(err)).toBe("notes");
  });

  test("returns undefined when no field", () => {
    expect(getErrorField(new Error("test"))).toBeUndefined();
  });
});

describe("getErrorMessages", () => {
  test("extracts and normalizes error messages array", () => {
    const err = {
      errorMessages: [
        "Entity 'Contact' has invalid field",
        "Entity 'Note' has invalid relationship",
      ],
    };
    const messages = getErrorMessages(err);
    expect(messages).toHaveLength(2);
    expect(messages?.[0]).toContain("Entity 'Contact'");
  });

  test("returns undefined when no errorMessages property", () => {
    expect(getErrorMessages(new Error("test"))).toBeUndefined();
  });

  test("returns undefined when errorMessages is not an array", () => {
    const err = { errorMessages: "not an array" };
    expect(getErrorMessages(err)).toBeUndefined();
  });
});

describe("extractErrorProperties", () => {
  test("extracts all properties from ApsorcNamingError", () => {
    const err = new ApsorcNamingError(
      "Field collision",
      "FIELD_RELATIONSHIP_COLLISION",
      "Contact",
      "notes"
    );
    const props = extractErrorProperties(err);
    expect(props.error_class).toBe("ApsorcNamingError");
    expect(props.error_message).toContain("Field collision");
    expect(props.error_code).toBe("FIELD_RELATIONSHIP_COLLISION");
    expect(props.entity).toBe("Contact");
    expect(props.field).toBe("notes");
  });

  test("extracts basic properties from standard Error", () => {
    const err = new Error("Something went wrong");
    const props = extractErrorProperties(err);
    expect(props.error_class).toBe("Error");
    expect(props.error_message).toBe("Something went wrong");
    expect(props.error_code).toBeUndefined();
    expect(props.entity).toBeUndefined();
    expect(props.field).toBeUndefined();
  });

  test("extracts error_messages array when present", () => {
    const err = {
      name: "ValidationError",
      constructor: { name: "ValidationError" },
      message: "Validation failed",
      errorMessages: ["Error 1", "Error 2"],
    };
    const props = extractErrorProperties(err);
    expect(props.error_messages).toHaveLength(2);
  });

  test("redacts sensitive data from error message", () => {
    const homeDir = require("os").homedir();
    const err = new Error(`File not found: ${homeDir}/${"secret"}.txt`);
    const props = extractErrorProperties(err);
    expect(props.error_message).toContain("~/secret.txt");
  });
});

describe("extractErrorMessages", () => {
  test("extracts up to MAX_ERROR_MESSAGES messages", () => {
    const errors = Array.from({ length: 20 }, (_, i) => `Error ${i + 1}`);
    const extracted = extractErrorMessages(errors);
    expect(extracted).toHaveLength(MAX_ERROR_MESSAGES);
    expect(extracted[0]).toBe("Error 1");
  });

  test("handles Error objects", () => {
    const errors = [new Error("Error 1"), new Error("Error 2")];
    const extracted = extractErrorMessages(errors);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]).toBe("Error 1");
    expect(extracted[1]).toBe("Error 2");
  });

  test("redacts sensitive data from messages", () => {
    const homeDir = require("os").homedir();
    const fakeToken = `token: ${"abc"}123`;
    const errors = [`Path: ${homeDir}/file.ts`, fakeToken];
    const extracted = extractErrorMessages(errors);
    expect(extracted[0]).toContain("~/file.ts");
    expect(extracted[1]).toContain("[REDACTED]");
  });

  test("respects custom max count", () => {
    const errors = Array.from({ length: 10 }, (_, i) => `Error ${i + 1}`);
    const extracted = extractErrorMessages(errors, 3);
    expect(extracted).toHaveLength(3);
  });
});

describe("isConfigOrValidationError", () => {
  test("identifies ApsorcNamingError as config error", () => {
    const err = new ApsorcNamingError("test", "CODE", "Entity");
    expect(isConfigOrValidationError(err)).toBe(true);
  });

  test("identifies errors with userError=true", () => {
    const err = { userError: true, message: "Custom error" };
    expect(isConfigOrValidationError(err)).toBe(true);
  });

  test("identifies validation errors by message pattern", () => {
    expect(isConfigOrValidationError(new Error("Validation failed"))).toBe(true);
    expect(isConfigOrValidationError(new Error("lint error detected"))).toBe(true);
    expect(
      isConfigOrValidationError(new Error("Configuration validation failed"))
    ).toBe(true);
    expect(isConfigOrValidationError(new Error("Invalid schema"))).toBe(true);
    expect(
      isConfigOrValidationError(
        new Error('Entity "X" does not reference an existing entity')
      )
    ).toBe(true);
  });

  test("does not identify generic errors as config errors", () => {
    expect(isConfigOrValidationError(new Error("Network timeout"))).toBe(false);
    expect(isConfigOrValidationError(new TypeError("Cannot read property"))).toBe(
      false
    );
  });

  test("returns false for non-errors", () => {
    expect(isConfigOrValidationError(null)).toBe(false);
    expect(isConfigOrValidationError("string")).toBe(false);
  });
});
