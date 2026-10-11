import { describe, expect, test } from "bun:test";

import {
  describeOpCommand,
  detectRevealForm,
} from "../../src/op/reveal-guard.ts";

const CWD = "/tmp/opchain-cwd";

/**
 * Runs the guard and returns the detected form id, or null.
 *
 * @param opArgs - Arguments after the `op` marker.
 * @returns {string | null} Reveal form id or null when allowed.
 */
function form(opArgs: readonly string[]): string | null {
  const result = detectRevealForm(opArgs, CWD);
  return result === null ? null : result.form;
}

describe("detectRevealForm", () => {
  describe("guarded forms", () => {
    test("refuses op read without a valid out-file", () => {
      expect(form(["read", "op://Vault/Item/field"])).toBe("read-stdout");
    });

    test("refuses op inject without a valid out-file", () => {
      expect(form(["inject", "-i", "template.op"])).toBe("inject-stdout");
    });

    test("refuses op document get without a valid out-file", () => {
      expect(form(["document", "get", "Doc"])).toBe("document-get-stdout");
    });

    test("refuses op item get with --reveal, --otp, or --format json", () => {
      expect(form(["item", "get", "Item", "--reveal"])).toBe("item-get-reveal");
      expect(form(["item", "get", "Item", "--otp"])).toBe("item-get-reveal");
      expect(form(["item", "get", "Item", "--format", "json"])).toBe(
        "item-get-reveal",
      );
      expect(form(["item", "get", "Item", "--format=json"])).toBe(
        "item-get-reveal",
      );
      expect(form(["item", "get", "Item", "--format", "JSON"])).toBe(
        "item-get-reveal",
      );
    });

    test("refuses op item create and item edit with --reveal or --format json", () => {
      expect(form(["item", "create", "--reveal", "--category", "login"])).toBe(
        "item-write-reveal",
      );
      expect(form(["item", "create", "--format", "json"])).toBe(
        "item-write-reveal",
      );
      expect(form(["item", "edit", "Item", "--format=json"])).toBe(
        "item-write-reveal",
      );
      expect(form(["item", "edit", "Item", "--reveal"])).toBe(
        "item-write-reveal",
      );
    });

    test("refuses op run --no-masking", () => {
      expect(form(["run", "--no-masking", "--", "cmd"])).toBe("run-no-masking");
      expect(form(["run", "--no-masking=true", "--", "cmd"])).toBe(
        "run-no-masking",
      );
    });

    test("refuses op signin unconditionally", () => {
      expect(form(["signin"])).toBe("signin");
      expect(form(["signin", "--raw"])).toBe("signin");
      expect(form(["signin", "-f"])).toBe("signin");
    });

    test("refuses token-printing create commands unconditionally", () => {
      expect(form(["service-account", "create", "name"])).toBe("token-create");
      expect(form(["connect", "token", "create", "name"])).toBe("token-create");
      expect(form(["events-api", "create", "name"])).toBe("token-create");
    });
  });

  describe("confirmed aliases", () => {
    test("canonicalizes items, documents, sa, and connect tokens", () => {
      expect(form(["items", "get", "Item", "--reveal"])).toBe(
        "item-get-reveal",
      );
      expect(form(["documents", "get", "Doc"])).toBe("document-get-stdout");
      expect(form(["sa", "create", "name"])).toBe("token-create");
      expect(form(["connect", "tokens", "create", "name"])).toBe(
        "token-create",
      );
    });
  });

  describe("global flags before the command path", () => {
    test("consumes global value-flag values so they do not join the path", () => {
      expect(form(["--account", "a", "item", "get", "X", "--reveal"])).toBe(
        "item-get-reveal",
      );
      expect(form(["--format", "json", "item", "get", "X"])).toBe(
        "item-get-reveal",
      );
      expect(form(["--session", "s", "read", "ref"])).toBe("read-stdout");
      expect(form(["--account=a", "read", "ref"])).toBe("read-stdout");
    });

    test("treats global boolean flags as known single tokens", () => {
      expect(form(["--no-color", "--cache", "item", "get", "X", "--otp"])).toBe(
        "item-get-reveal",
      );
      expect(form(["--debug=true", "read", "ref"])).toBe("read-stdout");
    });
  });

  describe("-- separator handling", () => {
    test("ignores tokens after the end-of-options separator", () => {
      expect(form(["run", "--", "echo", "--reveal"])).toBeNull();
      expect(form(["item", "get", "--", "--reveal"])).toBeNull();
      expect(form(["read", "--", "op://Vault/Item/field"])).toBe("read-stdout");
    });

    test("still refuses markers before the separator", () => {
      expect(form(["run", "--no-masking", "--", "cmd"])).toBe("run-no-masking");
    });

    test("help after the separator is not a help exemption", () => {
      expect(form(["signin", "--", "--help"])).toBe("signin");
    });
  });

  describe("value flag before the -- separator", () => {
    test("refuses a value-flag spelling whose value would swallow the separator", () => {
      expect(form(["item", "get", "X", "--vault", "--", "--reveal"])).toBe(
        "unclassifiable-order",
      );
      expect(
        form(["run", "--env-file", "--", "--no-masking", "--", "cmd"]),
      ).toBe("unclassifiable-order");
      expect(form(["--account", "--", "item", "get", "X", "--reveal"])).toBe(
        "unclassifiable-order",
      );
      expect(form(["read", "-fn", "--", "op://Vault/Item/field"])).toBe(
        "unclassifiable-order",
      );
    });

    test("keeps allowing separator uses no flag value can swallow", () => {
      expect(form(["run", "--env-file", ".env", "--", "cmd"])).toBeNull();
      expect(form(["run", "--", "cmd"])).toBeNull();
      expect(
        form(["read", "-o", "f", "--", "op://Vault/Item/field"]),
      ).toBeNull();
      expect(
        form(["read", "-n", "-o", "f", "--", "op://Vault/Item/field"]),
      ).toBeNull();
    });

    test("a boolean marker directly before the separator is still a marker", () => {
      expect(form(["item", "get", "X", "--reveal", "--"])).toBe(
        "item-get-reveal",
      );
    });
  });

  describe("out-file rules", () => {
    test("allows op read and op inject with a file out-file", () => {
      expect(form(["read", "-o", "f", "ref"])).toBeNull();
      expect(form(["read", "--out-file", "f", "ref"])).toBeNull();
      expect(form(["read", "--out-file=f", "ref"])).toBeNull();
      expect(form(["read", "-o=f", "ref"])).toBeNull();
      expect(form(["read", "-of", "ref"])).toBeNull();
      expect(form(["inject", "-i", "t", "-o", "out"])).toBeNull();
      expect(form(["document", "get", "D", "--out-file", "f"])).toBeNull();
    });

    test("refuses out-files that resolve to stdout or /dev", () => {
      expect(form(["read", "-o", "/dev/stdout", "ref"])).toBe("read-stdout");
      expect(form(["read", "--out-file=-", "ref"])).toBe("read-stdout");
      expect(form(["read", "-o", "-", "ref"])).toBe("read-stdout");
      expect(form(["read", "-o=", "ref"])).toBe("read-stdout");
      expect(form(["document", "get", "D", "-o", "/dev/stderr"])).toBe(
        "document-get-stdout",
      );
    });

    test("resolves relative out-file values against cwd", () => {
      const result = detectRevealForm(
        ["read", "-o", "../../dev/stdout", "ref"],
        "/tmp/opchain-home",
      );
      expect(result?.form).toBe("read-stdout");

      expect(
        detectRevealForm(
          ["read", "-o", "../../dev/stdout", "ref"],
          "/tmp/opchain-home/deep",
        ),
      ).toBeNull();
    });
  });

  describe("help exemption", () => {
    test("-h and --help before -- are never a reveal", () => {
      expect(form(["item", "get", "X", "--reveal", "--help"])).toBeNull();
      expect(form(["signin", "-h"])).toBeNull();
      expect(form(["read", "--help", "ref"])).toBeNull();
      expect(form(["item", "get", "X", "--format", "json", "-h"])).toBeNull();
    });

    test("--help=<value> and -h=<value> never trigger the help exemption", () => {
      expect(form(["item", "get", "X", "--reveal", "--help=false"])).toBe(
        "item-get-reveal",
      );
      expect(form(["item", "get", "X", "--reveal", "-h=false"])).toBe(
        "item-get-reveal",
      );
      expect(form(["item", "get", "X", "--reveal", "--help=true"])).toBe(
        "item-get-reveal",
      );
    });
  });

  describe("unclassifiable ordering", () => {
    test("refuses unknown dash tokens while the path is a guarded prefix", () => {
      const result = detectRevealForm(
        ["item", "--vault", "V", "get", "X"],
        CWD,
      );
      expect(result?.form).toBe("unclassifiable-order");
      expect(result?.alternative).toContain("after the subcommand");

      expect(form(["--vault", "V", "item", "get", "X"])).toBe(
        "unclassifiable-order",
      );
      expect(form(["connect", "--vault", "V", "token", "create", "x"])).toBe(
        "unclassifiable-order",
      );
    });

    test("accepts global flags mid-path because op accepts them anywhere", () => {
      expect(form(["connect", "--account", "a", "token", "create", "x"])).toBe(
        "token-create",
      );
    });

    test("allows unknown dash tokens once the path is not a guarded prefix", () => {
      expect(form(["item", "list", "--vault", "V"])).toBeNull();
      expect(form(["vault", "list", "--format", "json"])).toBeNull();
    });
  });

  describe("allowed forms", () => {
    test("allows masked op run with and without --env-file", () => {
      expect(
        form(["run", "--env-file", ".env.op", "--", "npm", "start"]),
      ).toBeNull();
      expect(form(["run", "--", "npm", "start"])).toBeNull();
    });

    test("allows default human-readable item reads and writes", () => {
      expect(form(["item", "get", "X"])).toBeNull();
      expect(form(["item", "get", "X", "--vault", "V"])).toBeNull();
      expect(
        form(["item", "get", "X", "--fields", "label=username"]),
      ).toBeNull();
      expect(form(["item", "create", "--category", "login"])).toBeNull();
      expect(
        form(["item", "edit", "Stripe", "--vault", "Services"]),
      ).toBeNull();
    });

    test("allows list and status commands", () => {
      expect(form(["vault", "list"])).toBeNull();
      expect(form(["item", "list"])).toBeNull();
      expect(form(["user", "list", "--format", "json"])).toBeNull();
      expect(form(["whoami"])).toBeNull();
    });

    test("non-json formats on item get are not a reveal", () => {
      expect(form(["item", "get", "X", "--format", "csv"])).toBeNull();
    });
  });

  describe("describeOpCommand", () => {
    test("returns the command path without flag or positional values", () => {
      expect(describeOpCommand(["vault", "list"])).toBe("vault list");
      expect(
        describeOpCommand(["item", "edit", "Stripe", "--vault", "Services"]),
      ).toBe("item edit");
      expect(describeOpCommand(["read", "op://V/I/f"])).toBe("read");
      expect(describeOpCommand(["read", "-o", "out.txt", "op://V/I/f"])).toBe(
        "read",
      );
      expect(
        describeOpCommand(["run", "--env-file", ".env", "--", "cmd"]),
      ).toBe("run");
      expect(describeOpCommand(["--account", "a", "items", "get", "X"])).toBe(
        "item get",
      );
      expect(describeOpCommand(["connect", "token", "create", "t"])).toBe(
        "connect token create",
      );
    });

    test("returns unknown or a safe prefix when only values are visible", () => {
      expect(describeOpCommand(["item", "My Secret"])).toBe("item");
      expect(describeOpCommand(["--format", "json"])).toBe("unknown");
      expect(describeOpCommand([])).toBe("unknown");
      expect(describeOpCommand(["vault", "--foo", "bar", "list"])).toBe(
        "vault list",
      );
      expect(describeOpCommand(["run", "npm", "start"])).toBe("run");
      expect(describeOpCommand(["run", "--", "npm", "start"])).toBe("run");
    });
  });

  describe("alternatives name a safe path", () => {
    test("every guarded form carries a non-empty alternative without argument values", () => {
      const cases: readonly (readonly string[])[] = [
        ["read", "op://SentinelVault/SentinelItem/field"],
        ["inject", "-i", "t.op"],
        ["document", "get", "SentinelDoc"],
        ["item", "get", "SentinelItem", "--reveal"],
        ["item", "edit", "SentinelItem", "--format", "json"],
        ["run", "--no-masking", "--", "c"],
        ["signin"],
        ["service-account", "create", "SentinelName"],
      ];
      for (const opArgs of cases) {
        const result = detectRevealForm(opArgs, CWD);
        expect(result).not.toBeNull();
        expect(result?.alternative.length ?? 0).toBeGreaterThan(10);
        expect(result?.alternative).not.toContain("SentinelVault");
        expect(result?.alternative).not.toContain("SentinelItem");
        expect(result?.alternative).not.toContain("op://");
      }
    });
  });
});
