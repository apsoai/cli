import { expect, describe, test, beforeEach, afterEach } from "@jest/globals";
import { detectInternal, getEmailDomain } from "../../../src/lib/telemetry/internal-detection";

describe("detectInternal", () => {
  const saved = {
    APSO_INTERNAL: process.env.APSO_INTERNAL,
    GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
    GITHUB_REPOSITORY_OWNER: process.env.GITHUB_REPOSITORY_OWNER,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
  };

  beforeEach(() => {
    delete process.env.APSO_INTERNAL;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.GITHUB_REPOSITORY_OWNER;
    delete process.env.GITHUB_REPOSITORY;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe("explicit env var APSO_INTERNAL", () => {
    test("APSO_INTERNAL=1 marks as internal", () => {
      process.env.APSO_INTERNAL = "1";
      const result = detectInternal({});
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("env");
    });

    test("APSO_INTERNAL=true marks as internal", () => {
      process.env.APSO_INTERNAL = "true";
      const result = detectInternal({});
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("env");
    });

    test("APSO_INTERNAL=0 forces false (override)", () => {
      process.env.APSO_INTERNAL = "0";
      // Even with other internal indicators
      const result = detectInternal({
        configInternal: true,
        userEmail: "user@apso.ai",
        workspaceSlug: "apso",
      });
      expect(result.internal).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    test("APSO_INTERNAL=false forces false (override)", () => {
      process.env.APSO_INTERNAL = "false";
      const result = detectInternal({ configInternal: true });
      expect(result.internal).toBe(false);
      expect(result.reason).toBeUndefined();
    });
  });

  describe("GitHub Actions auto-detection", () => {
    test("GITHUB_ACTIONS=true + GITHUB_REPOSITORY_OWNER=apsoai marks as internal", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REPOSITORY_OWNER = "apsoai";
      const result = detectInternal({});
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("github_owner");
    });

    test("detects apsoai from GITHUB_REPOSITORY when GITHUB_REPOSITORY_OWNER is missing", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REPOSITORY = "apsoai/cli";
      const result = detectInternal({});
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("github_owner");
    });

    test("case-insensitive owner matching", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REPOSITORY_OWNER = "ApsOAi";
      const result = detectInternal({});
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("github_owner");
    });

    test("non-apsoai owner is not internal", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REPOSITORY_OWNER = "external-org";
      const result = detectInternal({});
      expect(result.internal).toBe(false);
    });

    test("GITHUB_ACTIONS not set is not internal", () => {
      process.env.GITHUB_REPOSITORY_OWNER = "apsoai";
      const result = detectInternal({});
      expect(result.internal).toBe(false);
    });
  });

  describe("config flag: apso config set internal true", () => {
    test("configInternal=true marks as internal", () => {
      const result = detectInternal({ configInternal: true });
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("config");
    });

    test("configInternal=false is not internal", () => {
      const result = detectInternal({ configInternal: false });
      expect(result.internal).toBe(false);
    });
  });

  describe("account-based: email domain", () => {
    test("apso.ai email marks as internal", () => {
      const result = detectInternal({ userEmail: "matt@apso.ai" });
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("account");
    });

    test("mavrictech.com email marks as internal", () => {
      const result = detectInternal({ userEmail: "user@mavrictech.com" });
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("account");
    });

    test("case-insensitive domain matching", () => {
      const result = detectInternal({ userEmail: "user@Apso.AI" });
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("account");
    });

    test("external email domain is not internal", () => {
      const result = detectInternal({ userEmail: "user@example.com" });
      expect(result.internal).toBe(false);
    });

    test("missing @ in email is not internal", () => {
      const result = detectInternal({ userEmail: "notanemail" });
      expect(result.internal).toBe(false);
    });
  });

  describe("account-based: workspace", () => {
    test("apso workspace slug marks as internal", () => {
      const result = detectInternal({ workspaceSlug: "apso" });
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("workspace");
    });

    test("apso-team workspace slug marks as internal", () => {
      const result = detectInternal({ workspaceSlug: "apso-team" });
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("workspace");
    });

    test("mavric workspace slug marks as internal", () => {
      const result = detectInternal({ workspaceSlug: "mavric" });
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("workspace");
    });

    test("case-insensitive workspace matching", () => {
      const result = detectInternal({ workspaceSlug: "APSO" });
      expect(result.internal).toBe(true);
      expect(result.reason).toBe("workspace");
    });

    test("external workspace is not internal", () => {
      const result = detectInternal({ workspaceSlug: "acme-corp" });
      expect(result.internal).toBe(false);
    });
  });

  describe("precedence and combinations", () => {
    test("env var takes precedence over config", () => {
      process.env.APSO_INTERNAL = "1";
      const result = detectInternal({ configInternal: true });
      expect(result.reason).toBe("env");
    });

    test("override env var takes precedence over everything", () => {
      process.env.APSO_INTERNAL = "0";
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REPOSITORY_OWNER = "apsoai";
      const result = detectInternal({
        configInternal: true,
        userEmail: "user@apso.ai",
        workspaceSlug: "apso",
      });
      expect(result.internal).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    test("GitHub auto-detection takes precedence over config", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REPOSITORY_OWNER = "apsoai";
      const result = detectInternal({ configInternal: true });
      expect(result.reason).toBe("github_owner");
    });

    test("config takes precedence over account", () => {
      const result = detectInternal({
        configInternal: true,
        userEmail: "user@apso.ai",
      });
      expect(result.reason).toBe("config");
    });

    test("account email takes precedence over workspace", () => {
      const result = detectInternal({
        userEmail: "user@apso.ai",
        workspaceSlug: "external",
      });
      expect(result.reason).toBe("account");
    });

    test("first internal signal wins", () => {
      const result = detectInternal({
        userEmail: "user@apso.ai",
        workspaceSlug: "apso",
      });
      // Email is checked before workspace
      expect(result.reason).toBe("account");
    });
  });

  describe("no internal indicators", () => {
    test("returns false with no reason when nothing matches", () => {
      const result = detectInternal({
        userEmail: "user@example.com",
        workspaceSlug: "acme",
      });
      expect(result.internal).toBe(false);
      expect(result.reason).toBeUndefined();
    });
  });
});

describe("getEmailDomain", () => {
  test("extracts domain from email", () => {
    expect(getEmailDomain("user@apso.ai")).toBe("apso.ai");
    expect(getEmailDomain("admin@mavrictech.com")).toBe("mavrictech.com");
  });

  test("returns lowercase domain", () => {
    expect(getEmailDomain("user@Apso.AI")).toBe("apso.ai");
  });

  test("returns undefined for invalid email", () => {
    expect(getEmailDomain("notanemail")).toBeUndefined();
    expect(getEmailDomain("@domain.com")).toBe("domain.com");
    expect(getEmailDomain("user@")).toBe("");
  });
});
