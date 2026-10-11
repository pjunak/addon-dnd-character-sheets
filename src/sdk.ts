// The host's public browser types live unchanged in src/codex/ (copied and
// checked by tools/codex-sdk.mts). This module only names them for Character
// Sheets and narrows the record context its article section reads.
import type { ContributionElementContext } from "./codex/browser-sdk.js";

export type {
  AddonContext,
  Disposable,
  ServiceHandle,
  ServiceProvider,
} from "./codex/browser-sdk.js";

export interface RecordContributionHostContext {
  readonly kind: "campaign-record";
  readonly locale: "en" | "cs";
  readonly collection: string;
  readonly key: string;
  readonly revision: number;
  readonly value: unknown;
  readonly canEdit: boolean;
}

export type ContributionContext = ContributionElementContext<RecordContributionHostContext>;
