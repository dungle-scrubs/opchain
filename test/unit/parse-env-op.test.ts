import { describe, expect, test } from "bun:test";

import { listSecretReferences } from "../../src/secrets/parse-env-op.ts";

describe("listSecretReferences", () => {
  test("parses comments, blanks, quoted values, and duplicate refs", () => {
    const content = [
      "# comment",
      "",
      "OPENAI_API_KEY=op://Services/OpenAI/api-key",
      'ANTHROPIC_API_KEY="op://Models/Anthropic/api-key"',
      "export STRIPE_KEY='op://Services/Stripe/api-key'",
      "PLAIN_TEXT=value",
      "DUPLICATE=op://Services/OpenAI/api-key",
    ].join("\n");

    expect(listSecretReferences(content)).toEqual([
      "op://Services/OpenAI/api-key",
      "op://Models/Anthropic/api-key",
      "op://Services/Stripe/api-key",
    ]);
  });
});
