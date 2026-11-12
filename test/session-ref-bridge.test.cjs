/* dsh-remote-hub · cross-host session reference bridge (src/session-ref-bridge.ts) */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

let bridgePromise
function loadBridge() {
  if (!bridgePromise) {
    bridgePromise = import(pathToFileURL(path.join(__dirname, '..', 'lib', 'session-ref-bridge.js')).href)
  }
  return bridgePromise
}

test('session-ref-bridge: makeStagedRefId + stageReferenceSurface + installSessionQueryBridge round-trips', async () => {
  const bridge = await loadBridge()
  const refId = bridge.makeStagedRefId('homelab', 'session-11111111-2222-3333-4444-555555555555')
  assert.equal(bridge.isStagedRefId(refId), true)
  assert.equal(bridge.hasStagedReferenceSurface(refId), false)

  const snapshot = bridge.compactSurfaceSnapshot(
    {
      session: { id: 'session-11111111-2222-3333-4444-555555555555', version: 4, createdAt: 1700000000000, cwd: '/data/projects' },
      inheritedEventCount: 0,
      capturedThroughSeq: 2,
      events: [
        {
          seq: 1,
          type: 'user/message',
          data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello cross-host' }] },
        },
        {
          seq: 2,
          type: 'assistant/message',
          data: { message: { role: 'assistant', content: [{ type: 'text', text: 'world reply' }] } },
        },
      ],
    },
    refId,
  )
  assert.equal(snapshot.events.length, 2)
  bridge.stageReferenceSurface(refId, snapshot)
  assert.equal(bridge.hasStagedReferenceSurface(refId), true)

  const symOrig = Symbol.for('cordis.original')
  const rawQuery = {
    async readSurface(sessionId) {
      return { session: { id: sessionId, version: 4, createdAt: 1, cwd: '/local' }, inheritedEventCount: 0, capturedThroughSeq: 0, events: [] }
    },
  }
  const proxyQuery = { [symOrig]: rawQuery }
  const fakeCtx = {
    inject(_deps, cb) {
      cb({ sessionQuery: proxyQuery, effect: () => {} })
    },
  }
  const handle = bridge.installSessionQueryBridge(fakeCtx, {
    readRemoteSurface: async (serverId, remoteSessionId) => ({
      session: { id: remoteSessionId, version: 4, createdAt: 99, cwd: `/srv/${serverId}` },
      inheritedEventCount: 0,
      capturedThroughSeq: 1,
      events: [
        {
          seq: 1,
          type: 'user/message',
          data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'from remote' }] },
        },
      ],
    }),
  })

  const stagedOut = await rawQuery.readSurface(refId)
  assert.equal(stagedOut.session.id, refId)
  assert.equal(stagedOut.events.length, 2)

  const virtId = 'zr~a1b2c3d4~session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const remoteOut = await rawQuery.readSurface(virtId)
  assert.equal(remoteOut.session.id, virtId)
  assert.equal(remoteOut.events.length, 1)

  const localOut = await handle.readLocalSurface('session-local-1')
  assert.equal(localOut.session.id, 'session-local-1')
})

test('session-ref-bridge: host prefix query stripping, blank UUID filtering & plain-text mention upgrade', async () => {
  const bridge = await loadBridge()
  assert.deepEqual(bridge.stripHostQueryTokens('【本机】部署排查', ['本机', 'local']), {
    strippedQuery: '部署排查',
    matchedHostAlias: true,
  })
  assert.deepEqual(bridge.stripHostQueryTokens('[HomeLab] nginx', ['HomeLab']), {
    strippedQuery: 'nginx',
    matchedHostAlias: true,
  })
  assert.equal(bridge.isUntitledSessionUuidLabel('【本机】session-78e37d53-a1d1-4f24-bd63-713baa9ac335'), true)
  assert.equal(bridge.isUntitledSessionUuidLabel('【本机】网关调试记录'), false)
  assert.equal(bridge.isExplicitSessionUuidQuery('session-78e37d53-a1d1-4f24'), true)
  assert.equal(bridge.isExplicitSessionUuidQuery('网关调试'), false)

  const cand = bridge.decorateCrossHostCandidate(
    {
      sessionId: 'session-c5260479-680a-4e1d-9d91-3a8d3c7c7b57',
      label: '部署排查记录',
      displayTitle: '部署排查记录',
      cwd: '/data/projects',
      createdAt: 1700000000000,
    },
    {
      targetSessionId: 'zr~a1b2c3d4~session-c5260479-680a-4e1d-9d91-3a8d3c7c7b57',
      hostLabel: 'HomeLab',
    },
  )
  assert.equal(cand.displayTitle, '【HomeLab】部署排查记录')
  assert.match(cand.mention, /^@\[【HomeLab】部署排查记录\]\(dsh-session:[A-Za-z0-9_-]+\)$/)

  const upgradedByTitle = bridge.upgradePlainTextSessionMentions(
    '请参考 @【HomeLab】部署排查记录 继续分析',
    { candidates: [cand] },
  )
  assert.ok(upgradedByTitle.includes(cand.mention))

  const upgradedByUuid = bridge.upgradePlainTextSessionMentions(
    '【本机】session-c5260479-680a-4e1d-9d91-3a8d3c7c7b57 看得到吗',
    {
      resolveUuid: (uuid, hostTag) => ({ sessionId: uuid, label: `【${hostTag}】${uuid}` }),
    },
  )
  assert.match(
    upgradedByUuid,
    /^@\[【本机】session-c5260479-680a-4e1d-9d91-3a8d3c7c7b57\]\(dsh-session:[A-Za-z0-9_-]+\) 看得到吗$/,
  )
})
