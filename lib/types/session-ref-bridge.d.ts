export declare const SESSION_REF_BRIDGE_PATH = "/_dsh/zen-remote/relay/v1/session-ref-bridge";
export declare const STAGED_REF_PREFIX = "zr-extref~";
export interface CompactedSessionSurface {
    session: {
        id: string;
        version: number;
        createdAt: number;
        cwd?: string;
    };
    inheritedEventCount: number;
    capturedThroughSeq: number | null;
    events: Array<Record<string, unknown>>;
}
export interface SessionCandidateItem {
    sessionId: string;
    label: string;
    displayTitle: string;
    cwd?: string;
    sameWorkspace: boolean;
    createdAt: number;
    mention: string;
    [key: string]: unknown;
}
export type CandidateRow = SessionCandidateItem;
export declare function isStagedRefId(id: unknown): id is string;
export declare function makeStagedRefId(scope: string, sessionId: string): string;
export declare function compactSurfaceSnapshot(snapshot: unknown, overrideSessionId?: string): CompactedSessionSurface;
export declare function stageReferenceSurface(key: string, snapshot: unknown, ttlMs?: number): CompactedSessionSurface;
export declare function hasStagedReferenceSurface(key: unknown): boolean;
export declare function getStagedReferenceSurface(key: unknown): CompactedSessionSurface | undefined;
export declare function escapeReferenceLabel(label: string): string;
export declare function formatSessionReferenceMention(sessionId: string, label?: string): string;
export declare function prefixHostTag(hostLabel: string, title: string): string;
export declare function stripHostQueryTokens(query: string, hostAliases?: string[]): {
    strippedQuery: string;
    matchedHostAlias: boolean;
};
export declare function matchesCandidateQuery(candidate: {
    sessionId?: string;
    cwd?: string;
    label?: string;
    displayTitle?: string;
}, query: string, extraSearchTerms?: string[]): boolean;
export declare function isUntitledSessionUuidLabel(label: unknown): boolean;
export declare function isExplicitSessionUuidQuery(query: unknown): boolean;
export declare function mayContainPlainSessionMention(text: unknown): boolean;
export declare function extractPlainMentionUuids(text: unknown): string[];
export interface UpgradePlainMentionsOptions {
    candidates?: Array<Record<string, unknown>>;
    resolveUuid?: (rawUuid: string, hostTag?: string) => {
        sessionId: string;
        label?: string;
    } | undefined;
}
export declare function upgradePlainTextSessionMentions(text: string, options?: UpgradePlainMentionsOptions): string;
export interface ListCorpusCandidatesOptions {
    query?: string;
    limit?: number;
    excludeSessionId?: string;
    isAccessible?: (sessionId: string) => boolean;
    signal?: AbortSignal;
}
export declare function listCorpusSessionCandidates(reflectGet: (name: string) => unknown, options?: ListCorpusCandidatesOptions): Promise<SessionCandidateItem[]>;
export declare function decorateCrossHostCandidate(raw: unknown, { targetSessionId, hostLabel }: {
    targetSessionId: string;
    hostLabel: string;
}): SessionCandidateItem;
export interface SessionQueryBridgeOptions {
    originalSymbol?: symbol;
    readRemoteSurface?: (serverId: string, remoteSessionId: string) => Promise<unknown>;
    log?: (format: string, ...args: unknown[]) => void;
    warn?: (format: string, ...args: unknown[]) => void;
}
export declare function installSessionQueryBridge(ctx: {
    inject: (deps: string[], cb: (subCtx: Record<string, unknown>) => void) => void;
    reflect?: {
        get: (name: string) => unknown;
    };
}, options?: SessionQueryBridgeOptions): {
    readLocalSurface: (sessionId: string) => Promise<unknown>;
};
//# sourceMappingURL=session-ref-bridge.d.ts.map