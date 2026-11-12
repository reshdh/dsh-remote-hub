/**
 * Cross-host `@` session reference bridge (`dsh-session:` URI discovery +
 * read-only surface staging/fetching across paired DSH instances).
 */
import { createHash } from 'node:crypto';
import { encodeSessionReferenceUri } from './session-reference.js';
import { fromVirtual, isVirtual } from './virtual-id.js';
export const SESSION_REF_BRIDGE_PATH = '/_dsh/zen-remote/relay/v1/session-ref-bridge';
export const STAGED_REF_PREFIX = 'zr-extref~';
const DEFAULT_STAGE_TTL_MS = 60 * 60_000;
const MAX_STAGED_SURFACES = 96;
const stagedSurfaces = new Map();
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isStagedRefId(id) {
    return (typeof id === 'string' &&
        id.startsWith(STAGED_REF_PREFIX) &&
        id.length > STAGED_REF_PREFIX.length &&
        id.length <= 256 &&
        /^[A-Za-z0-9_~.:-]+$/.test(id));
}
export function makeStagedRefId(scope, sessionId) {
    const safeScope = /^[A-Za-z0-9_.-]{1,32}$/.test(String(scope))
        ? String(scope)
        : createHash('sha256').update(String(scope)).digest('hex').slice(0, 12);
    const rawId = String(sessionId);
    const safeId = /^[A-Za-z0-9_.:-]{1,160}$/.test(rawId)
        ? rawId
        : createHash('sha256').update(rawId).digest('hex').slice(0, 32);
    return `${STAGED_REF_PREFIX}${safeScope}~${safeId}`;
}
function pruneStagedSurfaces(now = Date.now()) {
    for (const [key, entry] of stagedSurfaces) {
        if (entry.expiresAt <= now) {
            stagedSurfaces.delete(key);
        }
    }
}
function compactTextBlocks(blocks) {
    if (!Array.isArray(blocks))
        return [];
    const out = [];
    for (const block of blocks) {
        if (isPlainObject(block) && block.type === 'text' && typeof block.text === 'string') {
            out.push({ type: 'text', text: block.text });
        }
    }
    return out;
}
export function compactSurfaceSnapshot(snapshot, overrideSessionId) {
    if (!isPlainObject(snapshot) || !isPlainObject(snapshot.session)) {
        throw new TypeError('invalid session surface snapshot');
    }
    const rawSession = snapshot.session;
    const id = typeof overrideSessionId === 'string' && overrideSessionId !== ''
        ? overrideSessionId
        : (typeof rawSession.id === 'string' ? rawSession.id : '');
    if (id === '') {
        throw new TypeError('surface snapshot is missing session.id');
    }
    const session = {
        id,
        version: typeof rawSession.version === 'number' && Number.isFinite(rawSession.version)
            ? rawSession.version
            : 1,
        createdAt: typeof rawSession.createdAt === 'number' && Number.isFinite(rawSession.createdAt)
            ? rawSession.createdAt
            : Date.now(),
        ...(typeof rawSession.cwd === 'string' && rawSession.cwd !== '' ? { cwd: rawSession.cwd } : {}),
    };
    const inheritedEventCount = typeof snapshot.inheritedEventCount === 'number' &&
        Number.isSafeInteger(snapshot.inheritedEventCount) &&
        snapshot.inheritedEventCount >= 0
        ? snapshot.inheritedEventCount
        : 0;
    const capturedThroughSeq = typeof snapshot.capturedThroughSeq === 'number' &&
        Number.isSafeInteger(snapshot.capturedThroughSeq) &&
        snapshot.capturedThroughSeq >= 0
        ? snapshot.capturedThroughSeq
        : null;
    const rawEvents = Array.isArray(snapshot.events) ? snapshot.events : [];
    const events = [];
    for (const ev of rawEvents) {
        if (!isPlainObject(ev) || typeof ev.seq !== 'number' || !Number.isSafeInteger(ev.seq) || ev.seq < 0)
            continue;
        if (ev.type === 'user/message' && isPlainObject(ev.data) && isPlainObject(ev.data.source)) {
            const content = compactTextBlocks(ev.data.content);
            if (content.length === 0)
                continue;
            events.push({
                seq: ev.seq,
                type: 'user/message',
                data: {
                    ...(typeof ev.data.id === 'string' ? { id: ev.data.id } : {}),
                    role: 'user',
                    source: structuredClone(ev.data.source),
                    content,
                },
            });
        }
        else if (ev.type === 'assistant/message' && isPlainObject(ev.data) && isPlainObject(ev.data.message)) {
            const msg = ev.data.message;
            const content = compactTextBlocks(msg.content);
            if (content.length === 0)
                continue;
            events.push({
                seq: ev.seq,
                type: 'assistant/message',
                data: {
                    message: {
                        ...(typeof msg.id === 'string' ? { id: msg.id } : {}),
                        role: 'assistant',
                        content,
                    },
                },
            });
        }
    }
    if (events.length === 0 && (isStagedRefId(id) || isVirtual(id))) {
        const originalId = isStagedRefId(id)
            ? id.replace(/^zr-extref~[^~]+~/, '')
            : (fromVirtual(id)?.id ?? (typeof rawSession.id === 'string' && rawSession.id !== '' ? rawSession.id : id));
        const cwdInfo = typeof session.cwd === 'string' && session.cwd !== '' ? `，工作目录: ${session.cwd}` : '';
        events.push({
            seq: typeof capturedThroughSeq === 'number' ? capturedThroughSeq : 0,
            type: 'user/message',
            data: {
                role: 'user',
                source: { kind: 'user' },
                content: [
                    {
                        type: 'text',
                        text: `[跨端会话连通提示：已成功跨端读取被引用会话 ${originalId}${cwdInfo}，但该会话目前是尚未发送过任何对话消息的空白新会话（0 条历史对话记录）。无需在当前机器本地磁盘搜索该会话文件。]`,
                    },
                ],
            },
        });
    }
    return {
        session,
        inheritedEventCount,
        capturedThroughSeq,
        events,
    };
}
export function stageReferenceSurface(key, snapshot, ttlMs = DEFAULT_STAGE_TTL_MS) {
    if (!isStagedRefId(key)) {
        throw new TypeError(`invalid staged reference key: ${String(key)}`);
    }
    const now = Date.now();
    pruneStagedSurfaces(now);
    const compacted = compactSurfaceSnapshot(snapshot, key);
    if (stagedSurfaces.has(key)) {
        stagedSurfaces.delete(key);
    }
    while (stagedSurfaces.size >= MAX_STAGED_SURFACES) {
        const oldest = stagedSurfaces.keys().next().value;
        if (oldest === undefined)
            break;
        stagedSurfaces.delete(oldest);
    }
    stagedSurfaces.set(key, {
        snapshot: compacted,
        expiresAt: now + Math.max(60_000, ttlMs),
    });
    return compacted;
}
export function hasStagedReferenceSurface(key) {
    if (!isStagedRefId(key))
        return false;
    pruneStagedSurfaces();
    return stagedSurfaces.has(key);
}
export function getStagedReferenceSurface(key) {
    if (!isStagedRefId(key))
        return undefined;
    pruneStagedSurfaces();
    const entry = stagedSurfaces.get(key);
    if (entry === undefined)
        return undefined;
    return structuredClone(entry.snapshot);
}
export function escapeReferenceLabel(label) {
    return String(label).replace(/[\\\]]/gu, (match) => `\\${match}`);
}
export function formatSessionReferenceMention(sessionId, label) {
    const effective = typeof label === 'string' && label !== '' ? label : sessionId;
    return `@[${escapeReferenceLabel(effective)}](${encodeSessionReferenceUri(sessionId)})`;
}
export function prefixHostTag(hostLabel, title) {
    const cleanHost = typeof hostLabel === 'string' && hostLabel.trim() !== '' ? hostLabel.trim() : '远端';
    const cleanTitle = typeof title === 'string' && title !== '' ? title : '';
    const fullBracket = `【${cleanHost}】`;
    const asciiBracket = `[${cleanHost}]`;
    if (cleanTitle.startsWith(fullBracket) || cleanTitle.startsWith(asciiBracket)) {
        return cleanTitle;
    }
    return `${fullBracket}${cleanTitle}`;
}
export function stripHostQueryTokens(query, hostAliases = []) {
    let raw = typeof query === 'string' ? query.trim() : '';
    if (raw === '')
        return { strippedQuery: '', matchedHostAlias: false };
    const normalizedAliases = new Set();
    for (const alias of hostAliases) {
        if (typeof alias !== 'string' || alias.trim() === '')
            continue;
        const lower = alias.trim().toLocaleLowerCase();
        normalizedAliases.add(lower);
        normalizedAliases.add(`[${lower}]`);
        normalizedAliases.add(`【${lower}】`);
    }
    let matchedHostAlias = false;
    // Strip attached leading bracket prefix e.g. "【本机】部署排查" or "[HomeLab]nginx"
    const leadBracket = /^(?:【([^】]{1,32})】|\[([^\]]{1,32})\])\s*(.*)$/u.exec(raw);
    if (leadBracket !== null) {
        const tag = (leadBracket[1] ?? leadBracket[2] ?? '').trim().toLocaleLowerCase();
        if (tag !== '' && normalizedAliases.has(tag)) {
            matchedHostAlias = true;
            raw = (leadBracket[3] ?? '').trim();
            if (raw === '')
                return { strippedQuery: '', matchedHostAlias: true };
        }
    }
    const tokens = raw.split(/\s+/u).filter(Boolean);
    const kept = [];
    for (const tok of tokens) {
        const cleaned = tok.toLocaleLowerCase();
        if (normalizedAliases.has(cleaned)) {
            matchedHostAlias = true;
            continue;
        }
        kept.push(tok);
    }
    return { strippedQuery: kept.join(' '), matchedHostAlias };
}
export function matchesCandidateQuery(candidate, query, extraSearchTerms = []) {
    const raw = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
    if (raw === '')
        return true;
    const haystack = [
        candidate.sessionId ?? '',
        candidate.cwd ?? '',
        candidate.label ?? '',
        candidate.displayTitle ?? '',
        ...extraSearchTerms,
    ].join(' ').toLocaleLowerCase();
    const tokens = raw.split(/\s+/u).filter(Boolean);
    return tokens.every((tok) => haystack.includes(tok));
}
export function isUntitledSessionUuidLabel(label) {
    if (typeof label !== 'string')
        return false;
    return /^(?:【[^】]+】|\[[^\]]+\])?session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(label.trim());
}
export function isExplicitSessionUuidQuery(query) {
    if (typeof query !== 'string')
        return false;
    const q = query.trim();
    return /^(?:【[^】]+】|\[[^\]]+\])?(?:zr~[A-Za-z0-9_.-]+~)?session-[0-9a-f-]{6,}/iu.test(q) || /^[0-9a-f]{8}-[0-9a-f]{4}-/iu.test(q);
}
const CANONICAL_REF_SPLIT_RE = /(@\[(?:\\.|[^\\\]])*\]\(dsh-session:[^\s)]*\)|dsh-session:[A-Za-z0-9_-]+)/gu;
const PLAIN_UUID_HEAD_RE = /^(?:【([^】]{1,32})】|\[([^\]]{1,32})\])?((?:zr~[A-Za-z0-9_.-]+~)?session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=$|[\s,，.。!！?？;；:：)）\]】>》])/iu;
const MENTION_BOUNDARY_AFTER_RE = /^($|[\s,，.。!！?？;；:：)）\]】>》])/u;
export function mayContainPlainSessionMention(text) {
    if (typeof text !== 'string' || text === '')
        return false;
    const parts = text.split(CANONICAL_REF_SPLIT_RE);
    for (let i = 0; i < parts.length; i += 2) {
        const seg = parts[i];
        if (!seg)
            continue;
        if (/session-[0-9a-f]{8}-[0-9a-f]{4}-/iu.test(seg))
            return true;
        if (/(?:@|(?:^|[\s(（,，;；:：]))(?:【[^】]{1,32}】|\[[^\]]{1,32}\])\S/u.test(seg))
            return true;
        if (/(?:^|[\s(（])@[^\s@]/u.test(seg))
            return true;
    }
    return false;
}
export function extractPlainMentionUuids(text) {
    if (typeof text !== 'string' || text === '')
        return [];
    const found = new Set();
    const parts = text.split(CANONICAL_REF_SPLIT_RE);
    for (let i = 0; i < parts.length; i += 2) {
        const seg = parts[i];
        if (!seg)
            continue;
        for (const m of seg.matchAll(/((?:zr~[A-Za-z0-9_.-]+~)?session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/giu)) {
            if (m[1])
                found.add(m[1]);
        }
    }
    return [...found];
}
export function upgradePlainTextSessionMentions(text, options = {}) {
    if (typeof text !== 'string' || text === '')
        return text;
    const candidates = Array.isArray(options.candidates) ? options.candidates : [];
    const resolveUuid = typeof options.resolveUuid === 'function' ? options.resolveUuid : undefined;
    const matchEntries = [];
    const seenTitle = new Set();
    for (const cand of candidates) {
        if (!isPlainObject(cand) || typeof cand.sessionId !== 'string' || cand.sessionId === '')
            continue;
        const displayOrLabel = typeof cand.displayTitle === 'string' && cand.displayTitle !== ''
            ? cand.displayTitle
            : (typeof cand.label === 'string' && cand.label !== '' ? cand.label : cand.sessionId);
        const mention = typeof cand.mention === 'string' && cand.mention.includes('dsh-session:')
            ? cand.mention
            : formatSessionReferenceMention(cand.sessionId, displayOrLabel);
        for (const rawT of [cand.displayTitle, cand.label]) {
            if (typeof rawT !== 'string')
                continue;
            const t = rawT.trim();
            if (t.length < 2)
                continue;
            const hasHostPrefix = /^(?:【[^】]{1,32}】|\[[^\]]{1,32}\])\S/u.test(t);
            if (!hasHostPrefix && /^[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8}$/.test(t) && !/^session-/i.test(t))
                continue;
            const key = t.toLocaleLowerCase();
            if (seenTitle.has(key))
                continue;
            seenTitle.add(key);
            matchEntries.push({
                title: t,
                titleLower: key,
                hasHostPrefix,
                mention,
            });
        }
    }
    matchEntries.sort((a, b) => b.title.length - a.title.length);
    const parts = text.split(CANONICAL_REF_SPLIT_RE);
    let anyChanged = false;
    for (let idx = 0; idx < parts.length; idx += 2) {
        const seg = parts[idx];
        if (!seg)
            continue;
        let out = '';
        let pos = 0;
        let segChanged = false;
        while (pos < seg.length) {
            const ch = seg[pos];
            const prev = pos > 0 ? seg[pos - 1] : '';
            const atTrigger = ch === '@' && (pos === 0 || !/[A-Za-z0-9_]/.test(prev));
            const hostBracketNoAt = !atTrigger && (ch === '【' || ch === '[') && (pos === 0 || /[\s(（,，;；:：]/.test(prev));
            if (!atTrigger && !hostBracketNoAt) {
                out += ch;
                pos += 1;
                continue;
            }
            const rest = seg.slice(pos + (atTrigger ? 1 : 0));
            let replaced = false;
            const uuidMatch = PLAIN_UUID_HEAD_RE.exec(rest);
            if (uuidMatch !== null && (atTrigger || uuidMatch[1] !== undefined || uuidMatch[2] !== undefined)) {
                const hostTag = uuidMatch[1] ?? uuidMatch[2];
                const rawUuid = uuidMatch[3];
                const resolved = resolveUuid?.(rawUuid, hostTag);
                if (resolved !== undefined && typeof resolved.sessionId === 'string' && resolved.sessionId !== '') {
                    const label = typeof resolved.label === 'string' && resolved.label !== ''
                        ? resolved.label
                        : (hostTag ? prefixHostTag(hostTag, rawUuid) : rawUuid);
                    out += formatSessionReferenceMention(resolved.sessionId, label);
                    pos += (atTrigger ? 1 : 0) + uuidMatch[0].length;
                    segChanged = true;
                    replaced = true;
                }
            }
            if (!replaced && matchEntries.length > 0) {
                const restLower = rest.toLocaleLowerCase();
                for (const entry of matchEntries) {
                    if (hostBracketNoAt && !entry.hasHostPrefix)
                        continue;
                    if (!restLower.startsWith(entry.titleLower))
                        continue;
                    const after = rest.slice(entry.title.length);
                    if (!MENTION_BOUNDARY_AFTER_RE.test(after))
                        continue;
                    out += entry.mention;
                    pos += (atTrigger ? 1 : 0) + entry.title.length;
                    segChanged = true;
                    replaced = true;
                    break;
                }
            }
            if (!replaced) {
                out += ch;
                pos += 1;
            }
        }
        if (segChanged) {
            parts[idx] = out;
            anyChanged = true;
        }
    }
    return anyChanged ? parts.join('') : text;
}
export async function listCorpusSessionCandidates(reflectGet, options = {}) {
    const sessionQuery = typeof reflectGet === 'function'
        ? reflectGet('sessionQuery')
        : undefined;
    if (sessionQuery === undefined || typeof sessionQuery?.listSessions !== 'function') {
        return [];
    }
    const limit = typeof options.limit === 'number' && Number.isSafeInteger(options.limit) && options.limit > 0
        ? Math.min(options.limit, 100)
        : 40;
    const query = typeof options.query === 'string' ? options.query : '';
    const allowBlankByUuid = isExplicitSessionUuidQuery(query);
    const sessionsSvc = reflectGet('sessions');
    const projectionsSvc = reflectGet('sessionProjections');
    const projectionCacheSvc = reflectGet('sessionProjectionCache');
    let records;
    try {
        records = await sessionQuery.listSessions(options.signal);
    }
    catch {
        return [];
    }
    if (!Array.isArray(records))
        return [];
    const results = [];
    for (const record of records) {
        const header = isPlainObject(record) ? record.header : undefined;
        if (!isPlainObject(header) || typeof header.id !== 'string' || header.id === '')
            continue;
        if (isVirtual(header.id) || isStagedRefId(header.id))
            continue;
        if (typeof options.excludeSessionId === 'string' && header.id === options.excludeSessionId)
            continue;
        if (typeof options.isAccessible === 'function' && !options.isAccessible(header.id))
            continue;
        let projSnap;
        try {
            const attached = typeof sessionsSvc?.get === 'function' ? sessionsSvc.get(header.id) : undefined;
            if (attached !== undefined && typeof projectionsSvc?.snapshot === 'function') {
                projSnap = projectionsSvc.snapshot(attached, ['title', 'subagent', 'sessionListMetadata']);
            }
            else if (typeof projectionCacheSvc?.cachedSnapshot === 'function') {
                projSnap = projectionCacheSvc.cachedSnapshot(header, ['title', 'subagent', 'sessionListMetadata']);
            }
        }
        catch {
            projSnap = undefined;
        }
        const rawTitle = projSnap?.values?.title;
        const subagent = projSnap?.values?.subagent;
        const meta = projSnap?.values?.sessionListMetadata;
        const hasTitle = typeof rawTitle === 'string' && rawTitle.trim() !== '';
        const hasSubagentLabel = isPlainObject(subagent) && typeof subagent.label === 'string' && subagent.label.trim() !== '';
        const noUserMessages = isPlainObject(meta)
            ? (meta.blank === true || meta.lastPromptAt === null)
            : (!hasTitle && !hasSubagentLabel);
        if (noUserMessages && !allowBlankByUuid)
            continue;
        const label = hasTitle ? rawTitle : header.id;
        const displayTitle = hasSubagentLabel ? subagent.label : label;
        const row = {
            sessionId: header.id,
            label,
            displayTitle,
            ...(typeof header.cwd === 'string' && header.cwd !== '' ? { cwd: header.cwd } : {}),
            sameWorkspace: false,
            createdAt: typeof header.createdAt === 'number' && Number.isFinite(header.createdAt) ? header.createdAt : Date.now(),
        };
        if (!matchesCandidateQuery(row, query))
            continue;
        results.push({
            ...row,
            mention: formatSessionReferenceMention(header.id, displayTitle),
        });
        if (results.length >= limit)
            break;
    }
    return results;
}
export function decorateCrossHostCandidate(raw, { targetSessionId, hostLabel }) {
    const row = isPlainObject(raw) ? raw : {};
    const baseLabel = typeof row?.label === 'string' && row.label !== '' ? row.label : targetSessionId;
    const baseDisplay = typeof row?.displayTitle === 'string' && row.displayTitle !== '' ? row.displayTitle : baseLabel;
    const label = prefixHostTag(hostLabel, baseLabel);
    const displayTitle = prefixHostTag(hostLabel, baseDisplay);
    return {
        sessionId: targetSessionId,
        label,
        displayTitle,
        ...(typeof row?.cwd === 'string' && row.cwd !== '' ? { cwd: row.cwd } : {}),
        sameWorkspace: false,
        createdAt: typeof row?.createdAt === 'number' && Number.isFinite(row.createdAt) ? row.createdAt : Date.now(),
        mention: formatSessionReferenceMention(targetSessionId, displayTitle),
    };
}
export function installSessionQueryBridge(ctx, options = {}) {
    const symOriginal = options.originalSymbol ?? Symbol.for('cordis.original');
    let rawInstance;
    let originalReadSurface;
    const readLocalSurface = async (sessionId) => {
        if (typeof sessionId !== 'string' || sessionId === '' || isVirtual(sessionId) || isStagedRefId(sessionId)) {
            throw new Error(`invalid local session id: ${String(sessionId)}`);
        }
        if (rawInstance !== undefined && typeof originalReadSurface === 'function') {
            return originalReadSurface.call(rawInstance, sessionId);
        }
        const svc = ctx.reflect?.get('sessionQuery');
        if (svc === undefined || typeof svc.readSurface !== 'function') {
            throw new Error('sessionQuery service is unavailable');
        }
        return svc.readSurface(sessionId);
    };
    try {
        ctx.inject(['sessionQuery'], (sqCtx) => {
            const proxy = sqCtx.sessionQuery;
            const raw = proxy !== null && typeof proxy === 'object'
                ? proxy[symOriginal]
                : undefined;
            if (raw === null || typeof raw !== 'object')
                return;
            const existed = Object.prototype.hasOwnProperty.call(raw, 'readSurface');
            const savedValue = existed ? raw.readSurface : undefined;
            const chainReadSurface = (typeof savedValue === 'function'
                ? savedValue
                : Object.getPrototypeOf(raw)?.readSurface);
            if (typeof chainReadSurface !== 'function')
                return;
            rawInstance = raw;
            originalReadSurface = chainReadSurface;
            let active = true;
            const wrappedReadSurface = async function bridgedReadSurface(sessionId, ...rest) {
                if (!active || typeof sessionId !== 'string') {
                    return chainReadSurface.call(this, sessionId, ...rest);
                }
                if (isStagedRefId(sessionId)) {
                    const staged = getStagedReferenceSurface(sessionId);
                    if (staged !== undefined) {
                        return staged;
                    }
                    throw new Error(`staged cross-host session reference expired or not found: ${sessionId}`);
                }
                const parts = fromVirtual(sessionId);
                if (parts !== undefined) {
                    if (typeof options.readRemoteSurface !== 'function') {
                        throw new Error(`remote session reference bridge is not configured for ${sessionId}`);
                    }
                    const remoteSnap = await options.readRemoteSurface(parts.serverId, parts.id);
                    return compactSurfaceSnapshot(remoteSnap, sessionId);
                }
                return chainReadSurface.call(this, sessionId, ...rest);
            };
            raw.readSurface = wrappedReadSurface;
            options.log?.('sessionQuery cross-host reference bridge attached');
            const effectFn = sqCtx.effect;
            effectFn?.(() => () => {
                active = false;
                if (rawInstance === raw) {
                    rawInstance = undefined;
                    originalReadSurface = undefined;
                }
                if (raw.readSurface === wrappedReadSurface) {
                    if (existed)
                        raw.readSurface = savedValue;
                    else
                        delete raw.readSurface;
                }
            }, 'dsh-remote-hub: sessionQuery cross-host bridge');
        });
    }
    catch (err) {
        options.warn?.('dsh-remote-hub cannot attach sessionQuery bridge: %s', err instanceof Error ? err.message : String(err));
    }
    return { readLocalSurface };
}
//# sourceMappingURL=session-ref-bridge.js.map