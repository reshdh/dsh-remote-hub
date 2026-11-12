import { createElement, Fragment, useCallback, useEffect, useState } from 'react'
import type { ChangeEvent as ReactChangeEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { ClientContext, WorkspaceId } from './compat/types.ts'
import { fromVirtual } from '../virtual-id.ts'

const h = createElement

const STORAGE_SPACE_KEY = 'dsh-zr.pi.active-space.v2'
const STORAGE_LAST_PATH_PREFIX = 'dsh-zr.pi.last-remote-dir.'
const STATUS_POLL_MS = 5000

const PI_SPACE_CSS = `
/* dsh-remote-hub: PI-Desktop style host scope switcher & remote folder picker */
[data-dsh-sidebar-wide="false"] [data-zr-pi-scope-host] {
  display: none !important;
}
[data-zr-pi-scope-host] {
  box-sizing: border-box;
  flex: none;
  padding: 2px var(--dsh-sidebar-edge-inset, 10px) 6px;
}
[data-zr-pi-scope-host][hidden] {
  display: none !important;
}
.zr-pi-scope-track {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.08));
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.14));
  overflow-x: auto;
  scrollbar-width: none;
}
.zr-pi-scope-track::-webkit-scrollbar {
  display: none;
}
.zr-pi-scope-btn {
  box-sizing: border-box;
  appearance: none;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #8b93a1);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease;
}
.zr-pi-scope-btn:hover {
  color: var(--dsw-alias-label-primary, #e5e7eb);
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.1));
}
.zr-pi-scope-btn[data-active="true"] {
  background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.12)));
  color: var(--dsw-alias-label-primary, #ffffff);
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
}
.zr-pi-scope-btn-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zr-pi-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: #9ca3af;
}
.zr-pi-dot[data-state="online"] {
  background: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.18);
}
.zr-pi-dot[data-state="connecting"] {
  background: #f59e0b;
}
.zr-pi-dot[data-state="offline"],
.zr-pi-dot[data-state="revoked"],
.zr-pi-dot[data-state="unpaired"] {
  background: #ef4444;
}
.zr-pi-empty-cta {
  box-sizing: border-box;
  margin-top: 6px;
  width: 100%;
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px dashed var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.28));
  background: transparent;
  color: var(--dsw-alias-label-secondary, #9ca3af);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
}
.zr-pi-empty-cta:hover {
  color: var(--dsw-alias-label-primary, #f3f4f6);
  border-color: var(--dsw-alias-label-secondary, rgba(156, 163, 175, 0.55));
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.08));
}

/* Pure CSS badge in unified "all" mode: "project · RemoteHost" (PI-Desktop style) */
html[data-zr-pi-space="all"] [class*="_projectText"][data-zr-host-label]::after {
  content: " · " attr(data-zr-host-label);
  flex: none;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #6b7280);
  white-space: nowrap;
  margin-left: 2px;
}
html[data-zr-pi-space="all"] [role="treeitem"]:hover [class*="_projectText"][data-zr-host-label]::after {
  display: none;
}

/* Pure CSS target host hint on top New Session button when scoped to a remote host */
html[data-zr-pi-space^="srv:"] button[class*="_newSession"] [class*="_newSessionLabel"]:not([class*="_newSessionLabelMask"])[data-zr-target-host]::after {
  content: " · " attr(data-zr-target-host);
  font-weight: 400;
  opacity: 0.72;
  font-size: 12px;
  white-space: nowrap;
}

/* Pure CSS "暂无会话" hint under expanded 0-session workspace folders (PI-Desktop style) */
[class*="_groupSection"]:not([class*="_workspaceDropAfter"]):has([role="treeitem"][data-row-key^="workspace:"][aria-expanded="true"]):not(:has([role="treeitem"][data-row-key^="session:"])):not(:has([class*="_groupSection"]))::after {
  content: "暂无会话";
  display: block;
  padding: 3px 12px 6px calc(var(--dsh-workspace-indent, 0px) + 34px);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #6b7280);
  user-select: none;
  pointer-events: none;
}

/* Modal overlay (PI-Desktop CreateProjectDialog + RemoteFolderDialog layout) */
.zr-pi-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.52);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
}
.zr-pi-modal-card {
  box-sizing: border-box;
  width: min(560px, 100%);
  max-height: min(680px, calc(100vh - 40px));
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-layer-1, #1e1f23));
  color: var(--dsw-alias-label-primary, #f3f4f6);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
  box-shadow: 0 22px 54px rgba(0, 0, 0, 0.44);
  overflow: hidden;
  font-size: 13px;
  line-height: 1.45;
}
.zr-pi-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.18));
}
.zr-pi-modal-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}
.zr-pi-modal-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #9ca3af);
}
.zr-pi-modal-close {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #9ca3af);
  width: 28px;
  height: 28px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.zr-pi-modal-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.14));
  color: var(--dsw-alias-label-primary, #ffffff);
}
.zr-pi-modal-body {
  padding: 14px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
}
.zr-pi-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.zr-pi-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #9ca3af);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.zr-pi-source-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 3px;
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.1));
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.16));
}
.zr-pi-source-tab {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #9ca3af);
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 7px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.12s ease, color 0.12s ease;
}
.zr-pi-source-tab:hover {
  color: var(--dsw-alias-label-primary, #f3f4f6);
}
.zr-pi-source-tab[data-active="true"] {
  background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.14)));
  color: var(--dsw-alias-label-primary, #ffffff);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}
.zr-pi-input,
.zr-pi-select {
  box-sizing: border-box;
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.24));
  background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.18));
  color: var(--dsw-alias-label-primary, #f3f4f6);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.zr-pi-input:focus,
.zr-pi-select:focus {
  border-color: var(--dsw-alias-state-business-primary, #3b82f6);
}
.zr-pi-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.zr-pi-btn {
  box-sizing: border-box;
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.24));
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12));
  color: var(--dsw-alias-label-primary, #f3f4f6);
  font: inherit;
  font-size: 12.5px;
  line-height: 18px;
  padding: 6px 11px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.zr-pi-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.2));
}
.zr-pi-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.zr-pi-btn-primary {
  background: var(--dsw-alias-state-business-primary, #2563eb);
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
  color: #ffffff;
  font-weight: 500;
}
.zr-pi-btn-primary:hover:not(:disabled) {
  filter: brightness(1.08);
  background: var(--dsw-alias-state-business-primary, #2563eb);
}
.zr-pi-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.zr-pi-chip {
  appearance: none;
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.24));
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.08));
  color: var(--dsw-alias-label-secondary, #9ca3af);
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: 999px;
  cursor: pointer;
}
.zr-pi-chip:hover {
  color: var(--dsw-alias-label-primary, #ffffff);
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.18));
}
.zr-pi-chip[data-active="true"] {
  color: var(--dsw-alias-state-business-primary, #60a5fa);
  border-color: var(--dsw-alias-state-business-primary, #3b82f6);
  background: rgba(59, 130, 246, 0.12);
}
.zr-pi-dir-box {
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.22));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.14));
  min-height: 170px;
  max-height: 230px;
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.zr-pi-dir-entry {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e5e7eb);
  font: inherit;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 7px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  width: 100%;
}
.zr-pi-dir-entry:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.14));
}
.zr-pi-dir-entry-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}
.zr-pi-dir-entry-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zr-pi-dir-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.14);
  color: #4ade80;
  flex: none;
}
.zr-pi-dir-empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--dsw-alias-label-tertiary, #6b7280);
}
.zr-pi-error {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.32);
  color: var(--dsw-alias-state-error-primary, #f87171);
  font-size: 12px;
}
.zr-pi-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 18px 15px;
  border-top: 0.5px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.18));
}
.zr-pi-footer-target {
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary, #8b93a1);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1 1 auto;
}
.zr-pi-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
`

const QUICK_ROOTS: ReadonlyArray<{ label: string; path: string }> = [
  { label: '/data/projects', path: '/data/projects' },
  { label: '/data/ai', path: '/data/ai' },
  { label: '/data', path: '/data' },
  { label: '/srv', path: '/srv' },
  { label: '主目录', path: '' },
  { label: '/', path: '/' },
]

interface PairedServerItem {
  id: string
  label: string
  serverUrl: string
  state: string
}

interface DirEntryRow {
  name: string
  path: string
}

interface SwitcherState {
  activeSpace: string
  servers: PairedServerItem[]
  dialogOpen: boolean
  dialogInitialSource: 'local' | 'remote'
  dialogInitialServerId: string
}

interface OpenDialogOptions {
  source?: 'local' | 'remote'
  serverId?: string
}

interface UiWorkspaceMutable {
  workspaceVisibility?: {
    getSnapshot?: () => number
    set?: (next: number) => void
  }
  sessionVisibility?: {
    getSnapshot?: () => number
    set?: (next: number) => void
  }
  isWorkspaceVisible: (workspaceId: string) => boolean
  isSessionVisible: (sessionId: string) => boolean
  startSession: (workspaceId?: WorkspaceId) => void
  pickDirectory?: () => Promise<string | null>
  [key: symbol]: unknown
}

function safeReadStorage(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function safeWriteStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore storage quota / privacy errors
  }
}

function basenameOfPath(p: unknown): string {
  if (typeof p !== 'string') return ''
  const trimmed = p.trim().replace(/[\\/]+$/, '')
  if (trimmed === '' || trimmed === '/') return trimmed || '/'
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

function parentPosixPath(p: unknown): string {
  if (typeof p !== 'string' || p.trim() === '' || p.trim() === '/') return '/'
  const clean = p.trim().replace(/\/+$/, '')
  const idx = clean.lastIndexOf('/')
  if (idx <= 0) return '/'
  return clean.slice(0, idx)
}

/** Shared lightweight reactive store connecting the scope bar, uiWorkspace wrapper, and React overlay dialog. */
function createController(ctx: ClientContext) {
  const listeners = new Set<() => void>()
  const initialSpace = safeReadStorage(STORAGE_SPACE_KEY) || 'local'
  const state: SwitcherState = {
    activeSpace: initialSpace,
    servers: [],
    dialogOpen: false,
    dialogInitialSource: 'remote',
    dialogInitialServerId: '',
  }

  const emit = (): void => {
    for (const fn of listeners) {
      try {
        fn()
      } catch (err) {
        console.error('[dsh-remote-hub] listener error:', err)
      }
    }
  }

  const subscribe = (fn: () => void): (() => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }

  const getServerById = (id: string): PairedServerItem | undefined => state.servers.find((s) => s.id === id)

  const normalizeActiveSpace = (): string => {
    if (state.servers.length === 0) return 'local'
    if (state.activeSpace === 'local' || state.activeSpace === 'all') return state.activeSpace
    if (state.activeSpace.startsWith('srv:')) {
      const sid = state.activeSpace.slice(4)
      if (state.servers.some((s) => s.id === sid)) return state.activeSpace
      const first = state.servers[0]
      return first !== undefined ? `srv:${first.id}` : 'local'
    }
    return 'local'
  }

  const bumpUiWorkspaceVisibility = (): void => {
    const ui = ctx.get('uiWorkspace') as UiWorkspaceMutable | undefined
    if (!ui) return
    try {
      if (
        ui.workspaceVisibility &&
        typeof ui.workspaceVisibility.getSnapshot === 'function' &&
        typeof ui.workspaceVisibility.set === 'function'
      ) {
        ui.workspaceVisibility.set(ui.workspaceVisibility.getSnapshot() + 1)
      }
      if (
        ui.sessionVisibility &&
        typeof ui.sessionVisibility.getSnapshot === 'function' &&
        typeof ui.sessionVisibility.set === 'function'
      ) {
        ui.sessionVisibility.set(ui.sessionVisibility.getSnapshot() + 1)
      }
    } catch (err) {
      console.warn('[dsh-remote-hub] visibility bump failed:', err)
    }
  }

  const setActiveSpace = (nextSpace: string): void => {
    if (typeof nextSpace !== 'string' || nextSpace === '') return
    if (state.activeSpace === nextSpace) return
    state.activeSpace = nextSpace
    safeWriteStorage(STORAGE_SPACE_KEY, nextSpace)
    bumpUiWorkspaceVisibility()
    emit()
  }

  const openDialog = (opts: OpenDialogOptions = {}): void => {
    const eff = normalizeActiveSpace()
    const defaultSource: 'local' | 'remote' = opts.source
      ? opts.source
      : eff === 'local'
        ? 'local'
        : 'remote'
    const defaultServerId = opts.serverId
      ? opts.serverId
      : eff.startsWith('srv:')
        ? eff.slice(4)
        : (state.servers[0]?.id ?? '')
    state.dialogInitialSource = state.servers.length > 0 ? defaultSource : 'local'
    state.dialogInitialServerId = defaultServerId
    state.dialogOpen = true
    emit()
  }

  const closeDialog = (): void => {
    if (!state.dialogOpen) return
    state.dialogOpen = false
    emit()
  }

  const matchesActiveScopeForServerId = (serverIdOrUndefined: string | undefined): boolean => {
    const eff = normalizeActiveSpace()
    if (state.servers.length === 0 || eff === 'all') return true
    if (eff === 'local') return serverIdOrUndefined === undefined
    if (eff.startsWith('srv:')) {
      const targetSid = eff.slice(4)
      return serverIdOrUndefined === targetSid
    }
    return true
  }

  const mergeDiscoveredServers = (fromStatus: readonly PairedServerItem[]): void => {
    const byId = new Map<string, PairedServerItem>()
    for (const row of fromStatus) {
      if (row && typeof row.id === 'string' && row.id !== '') {
        byId.set(row.id, row)
      }
    }
    try {
      const items = (ctx.workspaces?.list?.getSnapshot?.()?.items ?? []) as ReadonlyArray<{ workspaceId?: string }>
      for (const w of items) {
        const parts = typeof w?.workspaceId === 'string' ? fromVirtual(w.workspaceId) : undefined
        if (parts && !byId.has(parts.serverId)) {
          const prev = getServerById(parts.serverId)
          byId.set(
            parts.serverId,
            prev ?? {
              id: parts.serverId,
              label: '远程主机',
              serverUrl: '',
              state: 'online',
            },
          )
        }
      }
    } catch {
      // ignore snapshot read errors
    }
    const next = Array.from(byId.values())
    const prevSig = JSON.stringify(state.servers)
    const nextSig = JSON.stringify(next)
    if (prevSig !== nextSig) {
      state.servers = next
      bumpUiWorkspaceVisibility()
      emit()
    }
  }

  let lastStatusList: PairedServerItem[] = []
  const pollStatus = async (): Promise<void> => {
    try {
      const res = await fetch('/_dsh/zen-remote/client/status', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return
      const body = (await res.json()) as Record<string, unknown> | null
      const found: PairedServerItem[] = []
      if (body && Array.isArray(body.servers)) {
        for (const raw of body.servers) {
          if (!raw || typeof raw !== 'object') continue
          const s = raw as Record<string, unknown>
          if (typeof s.serverId !== 'string' || s.serverId === '') continue
          const label =
            typeof s.displayName === 'string' && s.displayName.trim() !== ''
              ? s.displayName.trim()
              : typeof s.serverName === 'string' && s.serverName.trim() !== ''
                ? s.serverName.trim()
                : s.serverId
          found.push({
            id: s.serverId,
            label,
            serverUrl: typeof s.serverUrl === 'string' ? s.serverUrl : '',
            state: typeof s.state === 'string' ? s.state : 'offline',
          })
        }
      } else if (
        body &&
        typeof body === 'object' &&
        body.state &&
        body.state !== 'unpaired' &&
        body.state !== 'invalid-url'
      ) {
        const interceptObj = body.intercept && typeof body.intercept === 'object' ? (body.intercept as Record<string, unknown>) : undefined
        let sid = typeof interceptObj?.serverId === 'string' ? interceptObj.serverId : ''
        if (!sid) {
          const items = (ctx.workspaces?.list?.getSnapshot?.()?.items ?? []) as ReadonlyArray<{ workspaceId?: string }>
          for (const w of items) {
            const p = typeof w?.workspaceId === 'string' ? fromVirtual(w.workspaceId) : undefined
            if (p) {
              sid = p.serverId
              break
            }
          }
        }
        if (sid) {
          const label = typeof body.serverName === 'string' && body.serverName.trim() !== '' ? body.serverName.trim() : sid
          found.push({
            id: sid,
            label,
            serverUrl: typeof body.serverUrl === 'string' ? body.serverUrl : '',
            state: typeof body.state === 'string' ? body.state : 'online',
          })
        }
      }
      lastStatusList = found
      mergeDiscoveredServers(lastStatusList)
    } catch {
      // ignore transient status poll error
    }
  }

  const refreshFromWorkspaces = (): void => {
    mergeDiscoveredServers(lastStatusList)
  }

  return {
    state,
    subscribe,
    emit,
    normalizeActiveSpace,
    getServerById,
    setActiveSpace,
    openDialog,
    closeDialog,
    matchesActiveScopeForServerId,
    bumpUiWorkspaceVisibility,
    pollStatus,
    refreshFromWorkspaces,
  }
}

interface WorkspaceManageResponse {
  ok?: boolean
  value?: {
    path?: string
    parent?: string | null
    dirs?: DirEntryRow[]
    entries?: DirEntryRow[]
    [key: string]: unknown
  }
  virtualWorkspaceId?: string
  error?: { code?: string; message?: string }
}

async function callWorkspaceManage(payload: Record<string, unknown>): Promise<WorkspaceManageResponse> {
  const res = await fetch('/_dsh/zen-remote/client/workspace-manage', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  let data: WorkspaceManageResponse | undefined
  try {
    data = (await res.json()) as WorkspaceManageResponse
  } catch {
    throw new Error(`远程服务返回了无法解析的响应 (${res.status})`)
  }
  if (!res.ok || !data || data.ok !== true) {
    const msg = data?.error?.message || `请求失败 (${res.status})`
    throw new Error(msg)
  }
  return data
}

function waitForWorkspaceInStore(ctx: ClientContext, workspaceId: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const check = (): boolean => {
      const items = (ctx.workspaces?.list?.getSnapshot?.()?.items ?? []) as ReadonlyArray<{ workspaceId?: string }>
      return items.some((w) => w.workspaceId === workspaceId)
    }
    if (check()) {
      resolve(true)
      return
    }
    let settled = false
    let off: () => void = () => {}
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      off()
      resolve(check())
    }, timeoutMs)
    if (typeof ctx.workspaces?.list?.subscribe === 'function') {
      off = ctx.workspaces.list.subscribe(() => {
        if (settled) return
        if (check()) {
          settled = true
          clearTimeout(timer)
          off()
          resolve(true)
        }
      })
    }
  })
}

function pickLocalDirectoryFromHost(ctx: ClientContext): Promise<string | null> {
  const globalPicker = (globalThis as unknown as { __DSH_DIRECTORY_PICKER__?: { pick?: () => Promise<string | null> } })
    .__DSH_DIRECTORY_PICKER__
  const ui = ctx.get('uiWorkspace') as UiWorkspaceMutable | undefined
  if (globalPicker && typeof globalPicker.pick === 'function') {
    return globalPicker.pick()
  }
  if (ui && typeof ui.pickDirectory === 'function') {
    return ui.pickDirectory()
  }
  return Promise.resolve(null)
}

function createHostWorkspaceDialogComponent(ctx: ClientContext, controller: ReturnType<typeof createController>) {
  return function HostWorkspaceDialog() {
    const [, forceRender] = useState(0)
    useEffect(() => controller.subscribe(() => forceRender((n) => n + 1)), [])

    const isOpen = controller.state.dialogOpen
    const servers = controller.state.servers

    const [source, setSource] = useState<'local' | 'remote'>('remote')
    const [serverId, setServerId] = useState('')
    const [localPath, setLocalPath] = useState('')
    const [customName, setCustomName] = useState('')
    const [nameEdited, setNameEdited] = useState(false)

    const [currentPath, setCurrentPath] = useState('')
    const [pathInput, setPathInput] = useState('')
    const [parentPath, setParentPath] = useState('/')
    const [entries, setEntries] = useState<DirEntryRow[]>([])
    const [showHidden, setShowHidden] = useState(false)
    const [loadingDir, setLoadingDir] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [errorMsg, setErrorMsg] = useState('')

    const [mkdirOpen, setMkdirOpen] = useState(false)
    const [mkdirName, setMkdirName] = useState('')
    const [mkdirBusy, setMkdirBusy] = useState(false)

    const loadRemoteDir = useCallback(async (targetServerId: string, targetPath: string, hiddenFlag: boolean) => {
      if (!targetServerId) return
      setLoadingDir(true)
      setErrorMsg('')
      try {
        const req: Record<string, unknown> = { serverId: targetServerId, action: 'ls', showHidden: Boolean(hiddenFlag) }
        if (typeof targetPath === 'string' && targetPath.trim() !== '') {
          req.path = targetPath.trim()
        }
        const res = await callWorkspaceManage(req)
        const val = res.value ?? {}
        const resolvedPath = typeof val.path === 'string' ? val.path : (targetPath || '/')
        setCurrentPath(resolvedPath)
        setPathInput(resolvedPath)
        setParentPath(typeof val.parent === 'string' ? val.parent : parentPosixPath(resolvedPath))
        const dirRows = Array.isArray(val.dirs) ? val.dirs : Array.isArray(val.entries) ? val.entries : []
        setEntries(dirRows)
        safeWriteStorage(STORAGE_LAST_PATH_PREFIX + targetServerId, resolvedPath)
        setNameEdited((edited) => {
          if (!edited) setCustomName(basenameOfPath(resolvedPath))
          return edited
        })
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err))
      } finally {
        setLoadingDir(false)
      }
    }, [])

    useEffect(() => {
      if (!isOpen) return
      const initSource = servers.length > 0 ? controller.state.dialogInitialSource : 'local'
      const initSid = controller.state.dialogInitialServerId || (servers[0]?.id ?? '')
      setSource(initSource)
      setServerId(initSid)
      setLocalPath('')
      setCustomName('')
      setNameEdited(false)
      setErrorMsg('')
      setMkdirOpen(false)
      setMkdirName('')
      if (initSource === 'remote' && initSid) {
        const saved = safeReadStorage(STORAGE_LAST_PATH_PREFIX + initSid) ?? ''
        void loadRemoteDir(initSid, saved, showHidden)
      }
    }, [isOpen])

    useEffect(() => {
      if (!isOpen) return
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && !submitting) {
          e.stopPropagation()
          controller.closeDialog()
        }
      }
      window.addEventListener('keydown', onKey, true)
      return () => window.removeEventListener('keydown', onKey, true)
    }, [isOpen, submitting])

    if (!isOpen) return null

    const existingRemotePaths = new Set<string>()
    try {
      const wsItems = (ctx.workspaces?.list?.getSnapshot?.()?.items ?? []) as ReadonlyArray<{
        workspaceId?: string
        path?: string
      }>
      for (const w of wsItems) {
        const p = typeof w?.workspaceId === 'string' ? fromVirtual(w.workspaceId) : undefined
        if (p && p.serverId === serverId && typeof w.path === 'string') {
          existingRemotePaths.add(w.path.replace(/\/+$/, '') || '/')
        }
      }
    } catch {
      // ignore
    }

    const onPickLocalFolder = async (): Promise<void> => {
      setErrorMsg('')
      try {
        const picked = await pickLocalDirectoryFromHost(ctx)
        if (picked && typeof picked === 'string') {
          setLocalPath(picked)
          if (!nameEdited) setCustomName(basenameOfPath(picked))
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err))
      }
    }

    const onConfirmLocal = async (): Promise<void> => {
      let targetPath = localPath.trim()
      if (!targetPath) {
        try {
          const picked = await pickLocalDirectoryFromHost(ctx)
          if (!picked || typeof picked !== 'string') return
          targetPath = picked
          setLocalPath(picked)
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : String(err))
          return
        }
      }
      setSubmitting(true)
      setErrorMsg('')
      try {
        const workspacesApi = ctx.workspaces as unknown as {
          create: (args: { path: string }) => Promise<{ workspaceId?: WorkspaceId } | undefined>
          rename?: (id: WorkspaceId, name: string) => Promise<unknown>
        }
        const ws = await workspacesApi.create({ path: targetPath })
        const desiredName = customName.trim()
        const defaultBase = basenameOfPath(targetPath)
        if (ws?.workspaceId && desiredName && desiredName !== defaultBase && typeof workspacesApi.rename === 'function') {
          await workspacesApi.rename(ws.workspaceId, desiredName).catch(() => {})
        }
        const eff = controller.normalizeActiveSpace()
        if (eff.startsWith('srv:')) {
          controller.setActiveSpace('local')
        }
        controller.closeDialog()
        const ui = ctx.get('uiWorkspace') as UiWorkspaceMutable | undefined
        if (ui && ws?.workspaceId) {
          ui.startSession(ws.workspaceId)
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err))
      } finally {
        setSubmitting(false)
      }
    }

    const onCreateMkdir = async (): Promise<void> => {
      const trimmed = mkdirName.trim()
      if (!trimmed || !serverId || !currentPath) return
      setMkdirBusy(true)
      setErrorMsg('')
      try {
        const joinedPath =
          currentPath === '/' ? `/${trimmed}` : `${currentPath.replace(/[\\/]+$/, '')}/${trimmed}`
        const res = await callWorkspaceManage({
          serverId,
          action: 'mkdir',
          path: joinedPath,
          parentPath: currentPath,
          name: trimmed,
        })
        const createdPath = res?.value?.path
        setMkdirOpen(false)
        setMkdirName('')
        await loadRemoteDir(serverId, typeof createdPath === 'string' ? createdPath : joinedPath, showHidden)
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err))
      } finally {
        setMkdirBusy(false)
      }
    }

    const onConfirmRemote = async (openNewSession: boolean): Promise<void> => {
      const targetPath = pathInput.trim() || currentPath.trim()
      if (!serverId) {
        setErrorMsg('请先选择已配对的远程主机')
        return
      }
      if (!targetPath) {
        setErrorMsg('请选择或输入远程目录路径')
        return
      }
      setSubmitting(true)
      setErrorMsg('')
      try {
        const res = await callWorkspaceManage({
          serverId,
          action: 'create',
          path: targetPath,
        })
        const vwsId = res.virtualWorkspaceId
        const eff = controller.normalizeActiveSpace()
        if (eff !== 'all' && eff !== `srv:${serverId}`) {
          controller.setActiveSpace(`srv:${serverId}`)
        } else {
          controller.bumpUiWorkspaceVisibility()
        }
        if (vwsId) {
          await waitForWorkspaceInStore(ctx, vwsId, 4000)
          const desiredName = customName.trim()
          const defaultBase = basenameOfPath(targetPath)
          const workspacesApi = ctx.workspaces as unknown as {
            rename?: (id: WorkspaceId, name: string) => Promise<unknown>
          }
          if (desiredName && desiredName !== defaultBase && typeof workspacesApi.rename === 'function') {
            await workspacesApi.rename(vwsId as WorkspaceId, desiredName).catch(() => {})
          }
        }
        controller.closeDialog()
        if (openNewSession && vwsId) {
          const ui = ctx.get('uiWorkspace') as UiWorkspaceMutable | undefined
          if (ui) ui.startSession(vwsId as WorkspaceId)
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err))
      } finally {
        setSubmitting(false)
      }
    }

    const selectedServer = servers.find((s) => s.id === serverId)

    return h(
      'div',
      {
        className: 'zr-pi-modal-backdrop',
        onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => {
          if (e.target === e.currentTarget && !submitting) controller.closeDialog()
        },
      },
      h(
        'div',
        {
          className: 'zr-pi-modal-card',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '添加工作区',
        },
        h(
          'div',
          { className: 'zr-pi-modal-header' },
          h(
            'div',
            null,
            h('h3', { className: 'zr-pi-modal-title' }, '添加工作区'),
            h('p', { className: 'zr-pi-modal-subtitle' }, '支持将本机目录或远程服务器目录作为独立工作区打开'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'zr-pi-modal-close',
              'aria-label': '关闭',
              onClick: () => {
                if (!submitting) controller.closeDialog()
              },
            },
            '×',
          ),
        ),
        h(
          'div',
          { className: 'zr-pi-modal-body' },
          servers.length > 0 &&
            h(
              'div',
              { className: 'zr-pi-field' },
              h('div', { className: 'zr-pi-label' }, h('span', null, '来源')),
              h(
                'div',
                { className: 'zr-pi-source-tabs' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'zr-pi-source-tab',
                    'data-active': String(source === 'local'),
                    onClick: () => {
                      setSource('local')
                      setErrorMsg('')
                      if (localPath && !nameEdited) setCustomName(basenameOfPath(localPath))
                      else if (!localPath && !nameEdited) setCustomName('')
                    },
                  },
                  '💻 本机电脑',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'zr-pi-source-tab',
                    'data-active': String(source === 'remote'),
                    onClick: () => {
                      setSource('remote')
                      setErrorMsg('')
                      const sid = serverId || (servers[0]?.id ?? '')
                      if (sid) {
                        setServerId(sid)
                        if (!currentPath) {
                          const saved = safeReadStorage(STORAGE_LAST_PATH_PREFIX + sid) ?? ''
                          void loadRemoteDir(sid, saved, showHidden)
                        } else if (!nameEdited) {
                          setCustomName(basenameOfPath(currentPath))
                        }
                      }
                    },
                  },
                  '🖥 远程主机',
                ),
              ),
            ),
          source === 'local'
            ? h(
                Fragment,
                null,
                h(
                  'div',
                  { className: 'zr-pi-field' },
                  h('div', { className: 'zr-pi-label' }, h('span', null, '本地文件夹')),
                  h(
                    'div',
                    { className: 'zr-pi-row' },
                    h('input', {
                      type: 'text',
                      className: 'zr-pi-input',
                      placeholder: '点击右侧浏览按钮选择本地项目目录…',
                      value: localPath,
                      onChange: (e: ReactChangeEvent<HTMLInputElement>) => {
                        const v = e.target.value
                        setLocalPath(v)
                        if (!nameEdited) setCustomName(basenameOfPath(v))
                      },
                    }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'zr-pi-btn',
                        onClick: () => {
                          void onPickLocalFolder()
                        },
                      },
                      '浏览文件夹…',
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'zr-pi-field' },
                  h(
                    'div',
                    { className: 'zr-pi-label' },
                    h('span', null, '工作区名称'),
                    h('span', { style: { fontWeight: 400, opacity: 0.75 } }, '可选，默认取目录名'),
                  ),
                  h('input', {
                    type: 'text',
                    className: 'zr-pi-input',
                    placeholder: localPath ? basenameOfPath(localPath) : '例如：my-project',
                    value: customName,
                    onChange: (e: ReactChangeEvent<HTMLInputElement>) => {
                      setCustomName(e.target.value)
                      setNameEdited(true)
                    },
                  }),
                ),
              )
            : h(
                Fragment,
                null,
                h(
                  'div',
                  { className: 'zr-pi-field' },
                  h(
                    'div',
                    { className: 'zr-pi-label' },
                    h('span', null, '远程主机'),
                    selectedServer &&
                      h(
                        'span',
                        { style: { fontWeight: 400 } },
                        (selectedServer.state === 'online' ? '● 在线' : `○ ${selectedServer.state}`) +
                          (selectedServer.serverUrl ? ` · ${selectedServer.serverUrl}` : ''),
                      ),
                  ),
                  servers.length > 1
                    ? h(
                        'select',
                        {
                          className: 'zr-pi-select',
                          value: serverId,
                          onChange: (e: ReactChangeEvent<HTMLSelectElement>) => {
                            const nextSid = e.target.value
                            setServerId(nextSid)
                            const saved = safeReadStorage(STORAGE_LAST_PATH_PREFIX + nextSid) ?? ''
                            void loadRemoteDir(nextSid, saved, showHidden)
                          },
                        },
                        servers.map((s) =>
                          h('option', { key: s.id, value: s.id }, s.label + (s.serverUrl ? ` (${s.serverUrl})` : '')),
                        ),
                      )
                    : h(
                        'div',
                        {
                          className: 'zr-pi-input',
                          style: { display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.92 },
                        },
                        h('span', { className: 'zr-pi-dot', 'data-state': selectedServer?.state || 'online' }),
                        h('span', { style: { fontWeight: 500 } }, selectedServer?.label || '远程主机'),
                        selectedServer?.serverUrl &&
                          h('span', { style: { opacity: 0.6, fontSize: '12px' } }, selectedServer.serverUrl),
                      ),
                ),
                h(
                  'div',
                  { className: 'zr-pi-chips' },
                  QUICK_ROOTS.map((chip) =>
                    h(
                      'button',
                      {
                        key: chip.label,
                        type: 'button',
                        className: 'zr-pi-chip',
                        'data-active': String(chip.path !== '' && currentPath === chip.path),
                        onClick: () => {
                          void loadRemoteDir(serverId, chip.path, showHidden)
                        },
                      },
                      chip.label,
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'zr-pi-field' },
                  h(
                    'div',
                    { className: 'zr-pi-label' },
                    h('span', null, '远程文件夹'),
                    h(
                      'label',
                      {
                        style: {
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                          fontWeight: 400,
                        },
                      },
                      h('input', {
                        type: 'checkbox',
                        checked: showHidden,
                        onChange: (e: ReactChangeEvent<HTMLInputElement>) => {
                          const nextHidden = e.target.checked
                          setShowHidden(nextHidden)
                          void loadRemoteDir(serverId, currentPath, nextHidden)
                        },
                      }),
                      '显示隐藏目录',
                    ),
                  ),
                  h(
                    'div',
                    { className: 'zr-pi-row' },
                    h('input', {
                      type: 'text',
                      className: 'zr-pi-input',
                      value: pathInput,
                      placeholder: '/data/projects',
                      onChange: (e: ReactChangeEvent<HTMLInputElement>) => {
                        const v = e.target.value
                        setPathInput(v)
                        if (!nameEdited) setCustomName(basenameOfPath(v))
                      },
                      onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void loadRemoteDir(serverId, pathInput, showHidden)
                        }
                      },
                    }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'zr-pi-btn',
                        disabled: loadingDir,
                        onClick: () => {
                          void loadRemoteDir(serverId, pathInput, showHidden)
                        },
                      },
                      '前往',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'zr-pi-btn',
                        disabled: loadingDir || !currentPath || currentPath === '/',
                        title: '返回上级目录',
                        onClick: () => {
                          void loadRemoteDir(serverId, parentPath || parentPosixPath(currentPath), showHidden)
                        },
                      },
                      '↑ 上级',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'zr-pi-btn',
                        disabled: loadingDir || !currentPath,
                        onClick: () => {
                          setMkdirOpen((v) => !v)
                          setMkdirName('')
                        },
                      },
                      '+ 新建',
                    ),
                  ),
                ),
                mkdirOpen &&
                  h(
                    'div',
                    { className: 'zr-pi-row' },
                    h('input', {
                      type: 'text',
                      className: 'zr-pi-input',
                      placeholder: `在 ${currentPath || '/'} 下新建文件夹名称…`,
                      value: mkdirName,
                      autoFocus: true,
                      onChange: (e: ReactChangeEvent<HTMLInputElement>) => setMkdirName(e.target.value),
                      onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void onCreateMkdir()
                        }
                      },
                    }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'zr-pi-btn zr-pi-btn-primary',
                        disabled: mkdirBusy || !mkdirName.trim(),
                        onClick: () => {
                          void onCreateMkdir()
                        },
                      },
                      mkdirBusy ? '创建中…' : '创建并进入',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'zr-pi-btn',
                        disabled: mkdirBusy,
                        onClick: () => {
                          setMkdirOpen(false)
                          setMkdirName('')
                        },
                      },
                      '取消',
                    ),
                  ),
                h(
                  'div',
                  { className: 'zr-pi-dir-box' },
                  loadingDir
                    ? h('div', { className: 'zr-pi-dir-empty' }, '正在读取远程目录…')
                    : entries.length === 0
                      ? h('div', { className: 'zr-pi-dir-empty' }, '当前目录下没有子文件夹（可直接把当前目录添加为工作区）')
                      : entries.map((entry) => {
                          const cleanEntryPath =
                            typeof entry.path === 'string' ? entry.path.replace(/\/+$/, '') || '/' : ''
                          const alreadyAdded = existingRemotePaths.has(cleanEntryPath)
                          return h(
                            'button',
                            {
                              key: entry.path || entry.name,
                              type: 'button',
                              className: 'zr-pi-dir-entry',
                              onClick: () => {
                                void loadRemoteDir(serverId, entry.path, showHidden)
                              },
                            },
                            h(
                              'span',
                              { className: 'zr-pi-dir-entry-left' },
                              h('span', { style: { opacity: 0.82 } }, '📁'),
                              h('span', { className: 'zr-pi-dir-entry-name' }, entry.name),
                              alreadyAdded && h('span', { className: 'zr-pi-dir-badge' }, '已添加'),
                            ),
                            h('span', { style: { opacity: 0.45, fontSize: '14px' } }, '›'),
                          )
                        }),
                ),
                h(
                  'div',
                  { className: 'zr-pi-field' },
                  h(
                    'div',
                    { className: 'zr-pi-label' },
                    h('span', null, '工作区名称'),
                    h('span', { style: { fontWeight: 400, opacity: 0.75 } }, '默认使用目录名，可自定义'),
                  ),
                  h('input', {
                    type: 'text',
                    className: 'zr-pi-input',
                    placeholder: basenameOfPath(pathInput || currentPath) || '工作区名称',
                    value: customName,
                    onChange: (e: ReactChangeEvent<HTMLInputElement>) => {
                      setCustomName(e.target.value)
                      setNameEdited(true)
                    },
                  }),
                ),
              ),
          errorMsg && h('div', { className: 'zr-pi-error' }, errorMsg),
        ),
        h(
          'div',
          { className: 'zr-pi-modal-footer' },
          h(
            'div',
            {
              className: 'zr-pi-footer-target',
              title: source === 'remote' ? pathInput || currentPath : localPath,
            },
            source === 'remote'
              ? `目标: ${pathInput || currentPath || '未选择'}`
              : localPath
                ? `目标: ${localPath}`
                : '提示: 选择文件夹后立即加入工作区列表',
          ),
          h(
            'div',
            { className: 'zr-pi-footer-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'zr-pi-btn',
                disabled: submitting,
                onClick: () => controller.closeDialog(),
              },
              '取消',
            ),
            source === 'remote'
              ? h(
                  Fragment,
                  null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'zr-pi-btn',
                      disabled: submitting || loadingDir || !(pathInput.trim() || currentPath.trim()),
                      onClick: () => {
                        void onConfirmRemote(false)
                      },
                    },
                    submitting ? '处理中…' : '仅添加工作区',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'zr-pi-btn zr-pi-btn-primary',
                      disabled: submitting || loadingDir || !(pathInput.trim() || currentPath.trim()),
                      onClick: () => {
                        void onConfirmRemote(true)
                      },
                    },
                    submitting ? '处理中…' : '打开并新建会话',
                  ),
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'zr-pi-btn zr-pi-btn-primary',
                    disabled: submitting,
                    onClick: () => {
                      void onConfirmLocal()
                    },
                  },
                  submitting ? '处理中…' : localPath.trim() ? '打开工作区' : '浏览并打开…',
                ),
          ),
        ),
      ),
    )
  }
}

export function mountHostWorkspaceSwitcher(ctx: ClientContext): void {
  const controller = createController(ctx)
  const HostWorkspaceDialog = createHostWorkspaceDialogComponent(ctx, controller)

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-remote-hub'
    tag.dataset.pluginCss = 'dsh-remote-hub/pi-host-space.css'
    tag.textContent = PI_SPACE_CSS
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  }, 'dsh-remote-hub: pi-host-space styles')

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'zr-pi-workspace-dialog',
        order: 5,
      },
      HostWorkspaceDialog,
    ),
  )

  ctx.effect(() => {
    const WORKSPACE_SLOT_KEY = 'sidebar.workspaces'
    const MAX_HEALS_PER_WINDOW = 3
    const HEAL_WINDOW_MS = 60_000
    let healTimestamps: number[] = []
    let healRetryTimer: ReturnType<typeof setTimeout> | null = null

    const symOrig = Symbol.for('cordis.original')
    let wrappedUi: UiWorkspaceMutable | null = null
    let wrappedIsWsVisible: ((workspaceId: string) => boolean) | null = null
    let wrappedIsSessVisible: ((sessionId: string) => boolean) | null = null
    let wrappedStartSession: ((workspaceId?: WorkspaceId) => void) | null = null

    interface WorkspaceSlotActions {
      retainAccountKeys: (keys: readonly string[]) => unknown
      __zrOrigRetainAccountKeys?: (keys: readonly string[]) => unknown
    }
    let wrappedActions: WorkspaceSlotActions | null = null
    let wrappedRetainAccountKeys: ((keys: readonly string[]) => unknown) | null = null

    const unwrapUi = (): void => {
      if (!wrappedUi) return
      try {
        const rec = wrappedUi as unknown as Record<string, unknown>
        if (wrappedUi.isWorkspaceVisible === wrappedIsWsVisible) delete rec.isWorkspaceVisible
        if (wrappedUi.isSessionVisible === wrappedIsSessVisible) delete rec.isSessionVisible
        if (wrappedUi.startSession === wrappedStartSession) delete rec.startSession
        controller.bumpUiWorkspaceVisibility()
      } catch {
        // ignore unwrap errors on disposed service
      }
      wrappedUi = null
      wrappedIsWsVisible = null
      wrappedIsSessVisible = null
      wrappedStartSession = null
    }

    const unwrapActions = (): void => {
      if (!wrappedActions) return
      try {
        if (wrappedActions.retainAccountKeys === wrappedRetainAccountKeys && wrappedActions.__zrOrigRetainAccountKeys) {
          wrappedActions.retainAccountKeys = wrappedActions.__zrOrigRetainAccountKeys
        }
      } catch {
        // ignore unwrap errors
      }
      wrappedActions = null
      wrappedRetainAccountKeys = null
    }

    interface SlotsInternal {
      entries?: (key: string) => unknown[]
      entriesOfSlot?: (key: string) => unknown[]
      onEntryError?: (
        cb: (key: string, entry: unknown, error: unknown, info?: { abdicated?: boolean }) => void,
      ) => () => void
      _core?: {
        abdicated?: Set<unknown>
        records?: Map<string, unknown>
        markDirty?: (key: string, rec: unknown) => void
      }
    }

    const tryHealWorkspaceSlot = (reason: string): boolean => {
      try {
        const slots = ctx.slots as unknown as SlotsInternal | undefined
        const core = slots?._core
        if (!slots || !core || !core.abdicated || !core.records) return false
        const allEntries = typeof slots.entries === 'function' ? slots.entries(WORKSPACE_SLOT_KEY) : []
        const liveEntries = typeof slots.entriesOfSlot === 'function' ? slots.entriesOfSlot(WORKSPACE_SLOT_KEY) : []
        if (allEntries.length === 0 || liveEntries.length > 0) return false

        const now = Date.now()
        healTimestamps = healTimestamps.filter((ts) => now - ts < HEAL_WINDOW_MS)
        if (healTimestamps.length >= MAX_HEALS_PER_WINDOW) return false

        let cleared = false
        for (const entry of allEntries) {
          if (core.abdicated.has(entry)) {
            core.abdicated.delete(entry)
            cleared = true
          }
        }
        if (!cleared) return false
        healTimestamps.push(now)
        const rec = core.records.get(WORKSPACE_SLOT_KEY)
        if (rec && typeof core.markDirty === 'function') {
          core.markDirty(WORKSPACE_SLOT_KEY, rec)
        }
        console.info(`[dsh-remote-hub] recovered abdicated sidebar.workspaces slot (${reason})`)
        return true
      } catch (err) {
        console.warn('[dsh-remote-hub] tryHealWorkspaceSlot failed:', err)
        return false
      }
    }

    const ensureWrapped = (): void => {
      try {
        const slots = ctx.slots as unknown as SlotsInternal | undefined
        const wsEntry = (typeof slots?.entries === 'function' ? slots.entries(WORKSPACE_SLOT_KEY)?.[0] : undefined) as
          | { store?: { create?: () => { actions?: WorkspaceSlotActions } } }
          | undefined
        const viewInst = typeof wsEntry?.store?.create === 'function' ? wsEntry.store.create() : undefined
        const actions = viewInst?.actions
        if (actions && actions !== wrappedActions && typeof actions.retainAccountKeys === 'function') {
          unwrapActions()
          if (!actions.__zrOrigRetainAccountKeys) {
            actions.__zrOrigRetainAccountKeys = actions.retainAccountKeys.bind(actions)
          }
          const origRetain = actions.__zrOrigRetainAccountKeys
          wrappedActions = actions
          wrappedRetainAccountKeys = (workspaceKeys: readonly string[]) => {
            const liveIds = ((ctx.workspaces?.list?.getSnapshot?.()?.items ?? []) as ReadonlyArray<{ workspaceId?: string }>)
              .map((w) => w?.workspaceId)
              .filter((id): id is string => typeof id === 'string' && id !== '')
            const base = Array.isArray(workspaceKeys) ? workspaceKeys : []
            const merged = Array.from(new Set([...base, ...liveIds]))
            return origRetain(merged)
          }
          actions.retainAccountKeys = wrappedRetainAccountKeys
        }
      } catch {
        // ignore transient slot read errors
      }

      const uiProxy = ctx.get('uiWorkspace') as UiWorkspaceMutable | undefined
      const rawUi =
        uiProxy && typeof uiProxy === 'object' ? ((uiProxy[symOrig] as UiWorkspaceMutable | undefined) ?? uiProxy) : null
      if (rawUi && rawUi !== wrappedUi) {
        unwrapUi()
        const proto = Object.getPrototypeOf(rawUi) as Partial<UiWorkspaceMutable> | null
        const origIsWsVisible =
          typeof proto?.isWorkspaceVisible === 'function'
            ? proto.isWorkspaceVisible.bind(rawUi)
            : rawUi.isWorkspaceVisible.bind(rawUi)
        const origIsSessVisible =
          typeof proto?.isSessionVisible === 'function'
            ? proto.isSessionVisible.bind(rawUi)
            : rawUi.isSessionVisible.bind(rawUi)
        const origStartSession =
          typeof proto?.startSession === 'function' ? proto.startSession.bind(rawUi) : rawUi.startSession.bind(rawUi)

        const isWsVisibleFn = (workspaceId: string): boolean => {
          if (!origIsWsVisible(workspaceId)) return false
          const parts = typeof workspaceId === 'string' ? fromVirtual(workspaceId) : undefined
          return controller.matchesActiveScopeForServerId(parts?.serverId)
        }
        const isSessVisibleFn = (sessionId: string): boolean => {
          const parts = typeof sessionId === 'string' ? fromVirtual(sessionId) : undefined
          if (parts !== undefined && parts.id.startsWith('__empty__:')) {
            return controller.matchesActiveScopeForServerId(parts.serverId)
          }
          if (!origIsSessVisible(sessionId)) return false
          return controller.matchesActiveScopeForServerId(parts?.serverId)
        }
        const startSessionFn = (workspaceId?: WorkspaceId): void => {
          if (workspaceId !== undefined || controller.state.servers.length === 0) {
            origStartSession(workspaceId)
            return
          }
          const eff = controller.normalizeActiveSpace()
          if (eff === 'all') {
            origStartSession(undefined)
            return
          }
          const wsSnap = ctx.workspaces?.list?.getSnapshot?.() as
            | { items?: ReadonlyArray<{ workspaceId: WorkspaceId; sessionIds?: readonly string[] }> }
            | undefined
          const sessSnap = ctx.sessions?.list?.getSnapshot?.() as
            | {
                byId?: Readonly<
                  Record<string, { retainedBy?: { mainView?: number }; updatedAt?: number; createdAt?: number }>
                >
              }
            | undefined
          const allItems = wsSnap?.items ?? []
          const scopedItems = allItems.filter((w) => isWsVisibleFn(w.workspaceId))

          if (scopedItems.length === 0) {
            if (eff.startsWith('srv:')) {
              controller.openDialog({ source: 'remote', serverId: eff.slice(4) })
              return
            }
            origStartSession(undefined)
            return
          }

          const byId = sessSnap?.byId ?? {}
          const currentSessId = Object.keys(byId).find((id) => (byId[id]?.retainedBy?.mainView ?? 0) > 0)
          if (currentSessId) {
            const curWs = scopedItems.find((w) => Array.isArray(w.sessionIds) && w.sessionIds.includes(currentSessId))
            if (curWs) {
              origStartSession(curWs.workspaceId)
              return
            }
          }

          const firstItem = scopedItems[0]
          if (!firstItem) {
            origStartSession(undefined)
            return
          }
          let bestWsId = firstItem.workspaceId
          let bestTs = -1
          for (const w of scopedItems) {
            for (const sid of w.sessionIds ?? []) {
              const s = byId[sid]
              const ts =
                typeof s?.updatedAt === 'number'
                  ? s.updatedAt
                  : typeof s?.createdAt === 'number'
                    ? s.createdAt
                    : -1
              if (ts > bestTs) {
                bestTs = ts
                bestWsId = w.workspaceId
              }
            }
          }
          origStartSession(bestWsId)
        }

        wrappedUi = rawUi
        wrappedIsWsVisible = isWsVisibleFn
        wrappedIsSessVisible = isSessVisibleFn
        wrappedStartSession = startSessionFn

        rawUi.isWorkspaceVisible = isWsVisibleFn
        rawUi.isSessionVisible = isSessVisibleFn
        rawUi.startSession = startSessionFn

        controller.bumpUiWorkspaceVisibility()
      }

      tryHealWorkspaceSlot('ensure')
    }

    const slotsForErr = ctx.slots as unknown as SlotsInternal | undefined
    const offSlotError =
      typeof slotsForErr?.onEntryError === 'function'
        ? slotsForErr.onEntryError((key, _entry, error, info) => {
            console.warn('[dsh-remote-hub] slot entry error:', key, info, error)
            if (key === WORKSPACE_SLOT_KEY && info?.abdicated) {
              if (healRetryTimer !== null) clearTimeout(healRetryTimer)
              healRetryTimer = setTimeout(() => {
                healRetryTimer = null
                tryHealWorkspaceSlot('onEntryError')
              }, 120)
            }
          })
        : () => {}

    ensureWrapped()
    const timer = setInterval(ensureWrapped, 300)
    return () => {
      clearInterval(timer)
      if (healRetryTimer !== null) {
        clearTimeout(healRetryTimer)
        healRetryTimer = null
      }
      offSlotError()
      unwrapActions()
      unwrapUi()
    }
  }, 'dsh-remote-hub: uiWorkspace scope filter')

  ctx.effect(() => {
    let hostContainer: HTMLDivElement | null = null
    let observedTarget: Node | null = null
    let rafId = 0

    const countRemoteWorkspaces = (sid: string): number => {
      const items = (ctx.workspaces?.list?.getSnapshot?.()?.items ?? []) as ReadonlyArray<{ workspaceId?: string }>
      let count = 0
      for (const w of items) {
        const p = typeof w?.workspaceId === 'string' ? fromVirtual(w.workspaceId) : undefined
        if (p && p.serverId === sid) count += 1
      }
      return count
    }

    const attachObserver = (obs: MutationObserver): void => {
      const sidebarRoot = document.querySelector('[data-dsh-sidebar-root]') || document.body
      if (sidebarRoot && sidebarRoot !== observedTarget) {
        obs.disconnect()
        observedTarget = sidebarRoot
        obs.observe(sidebarRoot, { childList: true, subtree: true })
      }
    }

    const syncDom = (): void => {
      attachObserver(observer)
      const servers = controller.state.servers
      const eff = controller.normalizeActiveSpace()
      const root = document.documentElement

      if (servers.length > 0) {
        if (root.getAttribute('data-zr-pi-space') !== eff) {
          root.setAttribute('data-zr-pi-space', eff)
        }
      } else {
        root.removeAttribute('data-zr-pi-space')
      }

      const regionArea = document.querySelector('[class*="_regionArea"]')
      if (regionArea) {
        const slotAnchor = regionArea.querySelector(':scope > [data-slot="sidebar.workspaces"]')
        if (!hostContainer || !hostContainer.isConnected || hostContainer.parentElement !== regionArea) {
          if (hostContainer && hostContainer.isConnected) hostContainer.remove()
          hostContainer = document.createElement('div')
          hostContainer.setAttribute('data-zr-pi-scope-host', '1')
          regionArea.insertBefore(hostContainer, slotAnchor || regionArea.firstChild)
        } else if (slotAnchor && hostContainer.nextSibling !== slotAnchor) {
          regionArea.insertBefore(hostContainer, slotAnchor)
        }
        if (servers.length === 0) {
          hostContainer.hidden = true
          hostContainer.replaceChildren()
        } else {
          hostContainer.hidden = false
          const activeRemoteId = eff.startsWith('srv:') ? eff.slice(4) : ''
          const remoteWsCount = activeRemoteId ? countRemoteWorkspaces(activeRemoteId) : -1
          const renderSig = JSON.stringify({ eff, servers, remoteWsCount })
          if (hostContainer.getAttribute('data-render-sig') !== renderSig) {
            hostContainer.setAttribute('data-render-sig', renderSig)
            const track = document.createElement('div')
            track.className = 'zr-pi-scope-track'
            track.setAttribute('role', 'tablist')
            track.setAttribute('aria-label', '工作区环境切换')

            const makeBtn = (spaceKey: string, labelText: string, dotState: string, titleText: string): HTMLButtonElement => {
              const btn = document.createElement('button')
              btn.type = 'button'
              btn.className = 'zr-pi-scope-btn'
              btn.setAttribute('role', 'tab')
              const active = eff === spaceKey
              btn.setAttribute('data-active', String(active))
              btn.setAttribute('aria-selected', String(active))
              if (titleText) btn.title = titleText
              if (dotState) {
                const dot = document.createElement('span')
                dot.className = 'zr-pi-dot'
                dot.setAttribute('data-state', dotState)
                btn.appendChild(dot)
              }
              const lbl = document.createElement('span')
              lbl.className = 'zr-pi-scope-btn-label'
              lbl.textContent = labelText
              btn.appendChild(lbl)
              btn.addEventListener('click', (ev) => {
                ev.stopPropagation()
                controller.setActiveSpace(spaceKey)
              })
              return btn
            }

            track.appendChild(makeBtn('local', '本机', '', '仅显示本机工作区'))
            for (const srv of servers) {
              const stLabel = srv.state === 'online' ? '在线' : srv.state
              track.appendChild(
                makeBtn(
                  `srv:${srv.id}`,
                  srv.label,
                  srv.state || 'online',
                  `${srv.label} (${stLabel}${srv.serverUrl ? ` · ${srv.serverUrl}` : ''})`,
                ),
              )
            }
            track.appendChild(makeBtn('all', '全部', '', '同时显示本机与所有远程主机工作区'))

            const nodes: HTMLElement[] = [track]
            if (activeRemoteId && remoteWsCount === 0) {
              const activeSrv = controller.getServerById(activeRemoteId)
              const cta = document.createElement('button')
              cta.type = 'button'
              cta.className = 'zr-pi-empty-cta'
              cta.textContent = `+ 添加 ${activeSrv?.label || '远程'} 工作区文件夹…`
              cta.addEventListener('click', (ev) => {
                ev.stopPropagation()
                controller.openDialog({ source: 'remote', serverId: activeRemoteId })
              })
              nodes.push(cta)
            }
            hostContainer.replaceChildren(...nodes)
          }
        }
      }

      const newSessionBtn = document.querySelector('button[class*="_newSession"]')
      if (newSessionBtn) {
        if (newSessionBtn.hasAttribute('data-zr-target-host')) {
          newSessionBtn.removeAttribute('data-zr-target-host')
        }
        const maskEl = newSessionBtn.querySelector('[class*="_newSessionLabelMask"]')
        if (maskEl && maskEl.hasAttribute('data-zr-target-host')) {
          maskEl.removeAttribute('data-zr-target-host')
        }
        const newSessionLbl = newSessionBtn.querySelector('[class*="_newSessionLabel"]:not([class*="_newSessionLabelMask"])')
        if (newSessionLbl) {
          if (servers.length > 0 && eff.startsWith('srv:')) {
            const srv = controller.getServerById(eff.slice(4))
            const targetLabel = srv?.label || ''
            if (targetLabel) {
              if (newSessionLbl.getAttribute('data-zr-target-host') !== targetLabel) {
                newSessionLbl.setAttribute('data-zr-target-host', targetLabel)
              }
            } else if (newSessionLbl.hasAttribute('data-zr-target-host')) {
              newSessionLbl.removeAttribute('data-zr-target-host')
            }
          } else if (newSessionLbl.hasAttribute('data-zr-target-host')) {
            newSessionLbl.removeAttribute('data-zr-target-host')
          }
        }
      }

      const wsRows = document.querySelectorAll('[role="treeitem"][data-row-key^="workspace:zr~"]')
      for (const row of wsRows) {
        const rawKey = row.getAttribute('data-row-key') || ''
        const vId = rawKey.slice('workspace:'.length)
        const parts = fromVirtual(vId)
        const textEl = row.querySelector('[class*="_projectText"]')
        if (parts && textEl) {
          const srv = controller.getServerById(parts.serverId)
          const lbl = srv?.label || ''
          if (lbl && textEl.getAttribute('data-zr-host-label') !== lbl) {
            textEl.setAttribute('data-zr-host-label', lbl)
          }
        }
      }
    }

    const scheduleSyncDom = (): void => {
      if (rafId !== 0) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        syncDom()
      })
    }

    const onDocClickCapture = (e: MouseEvent): void => {
      if (controller.state.servers.length === 0) return
      const rawTarget = e.target as Node | null
      const target = rawTarget && rawTarget.nodeType === 1 ? (rawTarget as Element) : rawTarget?.parentElement ?? null
      if (!target || typeof target.closest !== 'function') return
      if (target.closest('.zr-pi-modal-backdrop')) return

      const addBtn = target.closest('button[aria-label="添加工作区"], button[aria-label="Add workspace"]')
      if (addBtn) {
        e.preventDefault()
        e.stopPropagation()
        controller.openDialog()
        return
      }

      const menuItem = target.closest('[role="menuitem"]')
      if (menuItem) {
        const txt = (menuItem.textContent || '').trim()
        if (txt === '添加工作区…' || txt === '添加工作区...' || txt === 'Add workspace…' || txt === 'Add workspace...') {
          e.preventDefault()
          e.stopPropagation()
          controller.openDialog()
        }
      }
    }

    const onKeyDownCapture = (e: KeyboardEvent): void => {
      if (controller.state.servers.length === 0) return
      if (controller.state.dialogOpen) return
      if (e.code === 'KeyO' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        controller.openDialog()
      }
    }

    const observer = new MutationObserver(() => {
      scheduleSyncDom()
    })
    attachObserver(observer)

    const offCtrl = controller.subscribe(syncDom)
    const offWs =
      typeof ctx.workspaces?.list?.subscribe === 'function'
        ? ctx.workspaces.list.subscribe(() => {
            controller.refreshFromWorkspaces()
            syncDom()
          })
        : () => {}

    document.addEventListener('click', onDocClickCapture, true)
    window.addEventListener('keydown', onKeyDownCapture, true)

    controller.refreshFromWorkspaces()
    syncDom()
    void controller.pollStatus()
    const pollTimer = setInterval(() => {
      void controller.pollStatus()
    }, STATUS_POLL_MS)

    return () => {
      clearInterval(pollTimer)
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      observer.disconnect()
      observedTarget = null
      offCtrl()
      offWs()
      document.removeEventListener('click', onDocClickCapture, true)
      window.removeEventListener('keydown', onKeyDownCapture, true)
      document.documentElement.removeAttribute('data-zr-pi-space')
      for (const el of document.querySelectorAll('[data-zr-target-host]')) {
        el.removeAttribute('data-zr-target-host')
      }
      for (const el of document.querySelectorAll('[data-zr-host-label]')) {
        el.removeAttribute('data-zr-host-label')
      }
      if (hostContainer && hostContainer.isConnected) {
        hostContainer.remove()
      }
      hostContainer = null
    }
  }, 'dsh-remote-hub: pi-host-space dom & shortcuts')
}
