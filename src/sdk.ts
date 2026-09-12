export interface ServiceProvider {
  readonly addonId: string;
  readonly contractVersion: string;
  readonly generation: string;
  readonly bindingRevision: number;
}

export interface ServiceHandle {
  readonly available: boolean;
  readonly providers: readonly ServiceProvider[];
  call<TResponse>(method: string, params: unknown, options?: {
    readonly providerAddonId?: string;
    readonly deadlineMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<TResponse>;
}

export interface AddonContext {
  readonly addon: { readonly id: string; readonly version: string; readonly generation: string };
  readonly signal: AbortSignal;
  readonly capabilities: { require(capability: string): void };
  readonly data: {
    subscribe(listener: (change: { readonly reason: string }) => void, options?: { readonly signal?: AbortSignal }): () => void;
  };
  readonly services: {
    connect(contract: string, options: {
      readonly range: string;
      readonly cardinality: "one" | "many";
      readonly includeOwn?: boolean;
      readonly signal?: AbortSignal;
    }): Promise<ServiceHandle>;
  };
  readonly ui: {
    bind(contributionId: string, binding: { readonly kind: "element"; readonly tag: string }): { dispose(): void };
  };
}

export interface RecordContributionHostContext {
  readonly kind: "campaign-record";
  readonly locale?: "en" | "cs";
  readonly collection: string;
  readonly key: string;
  readonly revision: number;
  readonly value: unknown;
  readonly canEdit: boolean;
}

export interface ContributionContext {
  readonly edits: { set(state: { readonly dirty: boolean; readonly saving: boolean }): void };
  readonly addon: { readonly id: string; readonly generation: string };
  readonly contribution: { readonly id: string; readonly config: Readonly<Record<string, unknown>> };
  readonly signal: AbortSignal;
  readonly host: RecordContributionHostContext;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}
