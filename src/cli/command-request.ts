import type { CliOptions } from "./options.ts";

export type CommandRequest =
  | {
      readonly identityName: string;
      readonly kind: "identity";
      readonly options: CliOptions;
      readonly trailingArgs: readonly string[];
    }
  | {
      readonly kind: "top";
      readonly options: CliOptions;
      readonly trailingArgs: readonly string[];
    };
