import type { ClientContext, JobsLike, SessionId, WorkspaceId } from './compat/types.ts'
import { isDesktopShell } from './compat/desktop.ts'
import { MobileNavToggle } from './MobileNavToggle.tsx'
import { MobileNavOverlay } from './MobileNavOverlay.tsx'
import { MobileDrawerFooter } from './MobileDrawerFooter.tsx'
import { MobileHome } from './MobileHome.tsx'
import { MobileHeaderActions, MobileHeaderUtilities } from './MobileSessionHeader.tsx'
import { MobileSessionInfo } from './MobileSessionInfo.tsx'
import { MobileAttachButton } from './MobileAttachButton.tsx'
import { MobileAttachChips } from './MobileAttachChips.tsx'
import { createNavStore } from './nav-store.ts'
import { MOBILE_CSS } from './styles/index.ts'
import { installDebugBadge } from './debug.ts'
import { installPhoneChrome, installSunkInset, installViewportHeal } from './effects/phone-chrome.ts'
import { installAionuiCompat } from './effects/aionui-compat.ts'
import { installWorkbenchRefClose } from './effects/workbench-ref-close.ts'
import { installHeaderStatusDot } from './effects/header-status.ts'
import { installGestures } from './effects/gestures.ts'
import { installTurnFold } from './effects/turn-fold.ts'
import { installModalBack } from './effects/modal-back.ts'
import { installModelSheetExtras } from './effects/model-sheet-extras.ts'
import { installPermissionSheet } from './effects/permission-sheet.ts'
import { installNativeTriggerOverlay } from './effects/native-trigger-overlay.ts'
import { installWelcomeNoticeOptOut } from './effects/welcome-notice.ts'
import { installKeyboardGuard } from './effects/keyboard-guard.ts'
import { installKeyboardAvoid } from './effects/keyboard-avoid.ts'
import { SharePreview } from './share/share-preview.tsx'
import { NS } from './locales.ts'
import type { MobileNavKey } from './locales.ts'
import { SettingsSection } from './settings/SettingsSection.tsx'
import { registerSettingsPage } from './settings/register-settings.ts'
import { GatewayWizard } from './wizard/GatewayWizard.tsx'
import { registerGatewayWizard } from './wizard/register-wizard.ts'
import { RemoteHeaderIcon } from './RemoteHeaderIcon.tsx'
import { RemoteShareMenuItem } from './RemoteShareMenu.tsx'
import { getSharesStore } from '../client-data/shares.ts'
import { registerRemoteShareUi } from './remote-share-register.ts'
import { RemoteStatusIcon } from './RemoteStatusIcon.tsx'
import { RemoteComposerBanner } from './RemoteComposerBanner.tsx'
import { registerRemoteStatusUi } from './remote-status-register.ts'
import { mountCurrentSessionReporter } from './current-session-report.ts'
import { mountRemoteDropGuard } from './effects/remote-drop.ts'
import { mountRemoteGroupExpansionKeeper } from './remote-group-expansion.ts'
import { mountHostWorkspaceSwitcher } from './host-workspace-switcher.ts'
import { installRemoteApiFetch } from './remote-fetch.ts'
import { installRemoteSessionGuard } from './effects/remote-session.ts'
import { installModelGroupSide } from './effects/model-group-side.ts'
import { DeliverableDownload, DocumentDownload } from './RemoteFileDownload.tsx'
import { createSaveRemoteFile } from './remote-file-save.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Directory-drawer controls copy. */
    'mobileNav': MobileNavKey
  }
}

/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
export const inject = ['slots', 'layout', 'locale', 'sessionLogDownload', 'sessions', 'workspaces']

/**
 * 0.1.2 把新建会话、归档会话与打开会话的界面级操作挪到了 uiWorkspace
 * 服务（0.1.7 删掉了 ctx.sessions.open，这是它唯一的替代入口）。类型用
 * 本地最小接口，不 import 那个 dsh-client-ui-workspace 包——本插件的
 * peerDependencies 不含它，运行时实例由宿主提供，类型自己声明就够。
 */
interface UiWorkspaceLike {
  openSession(target: SessionId): void
  startSession(workspaceId?: WorkspaceId): void
  archiveSession(sessionId: SessionId): Promise<void>
}

/**
 * Activity data both session-header entries read (0.1.7 sources — 0.1.5's
 * per-parent subagent snapshot and per-session job snapshot are gone):
 * - the subagent catalog is read straight off the sessions snapshot's
 *   explicit-read store (`projectionsBySession[id].values.subagentCatalog`),
 *   exactly like the official SubagentHeaderLineage — no refresh is issued
 *   from here: every projection refresh call registers another session in
 *   the controller's load table, and all of them are re-read on every
 *   reconnect (manager handleConnected), so per-open refreshes would grow
 *   into a batch of re-reads forever;
 * - job rows come from the `jobs` client service; the inject face mirrors
 *   the official JobListAction registration (`hooks.jobs` observable → the
 *   renderer hands the component a `useJobs` hook prop). When the service is
 *   absent (a build without the job controller) a fixed empty source keeps
 *   the prop present, so the component's hook count never varies — the
 *   counts simply read zero instead of the pill silently disappearing.
 */
const NO_JOBS_SNAPSHOT = Object.freeze({ rows: Object.freeze({}) }) as {
  readonly rows: Readonly<Record<string, readonly never[]>>
}
/** Module-level singleton: one stable observable identity across renders. */
const NO_JOBS_SOURCE = {
  getSnapshot: () => NO_JOBS_SNAPSHOT,
  subscribe: (): (() => void) => () => {},
}
const NO_WATCH_ROWS = (): (() => void) => () => {}

function activityInject(ctx: ClientContext) {
  const jobs = ctx.get('jobs') as JobsLike | undefined
  return {
    hooks: { jobs: jobs === undefined ? NO_JOBS_SOURCE : jobs.state },
    watchRows: jobs === undefined ? NO_WATCH_ROWS : (id: SessionId) => jobs.watchRows(id),
  }
}

/**
 * Mobile-adaptive shell, browser half: injects the mobile stylesheet, then
 * contributes the directory toggle to the session header and the backdrop +
 * floating button to the shell overlay.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // 2.0.0 设置页：必须在桌面门之前注册——桌面端 App 里手机外壳整体不生效，
  // 但设置页必须生效（主服务端就是桌面端）。字典、设置页样式与设置表单服务
  // 的按需注入都在 registerSettingsPage 里（那个服务名绝不进顶层的 inject
  // 数组，否则没有该服务的环境整个界面半边都加载不了）。
  registerSettingsPage(ctx, SettingsSection)

  // GW-10 网关配置引导「让手机连上来」：同样在桌面门之前注册——桌面端 App
  // 正是主服务端，wizard 恰好是它最有用的入口。部件自身三重门控：subject
  // 过滤（kind === 'row' && pkg.name === 'dsh-remote-hub'）、保存角色检查
  // （client 角色不渲染）、viaGateway 时全部操作禁用。样式全部作用在组件
  // 自身的 data 属性下，≥1024px 的其他页面逐像素不受影响。
  registerGatewayWizard(ctx, GatewayWizard)

  // T33b 会话共享的三个入口里前两个（标题行远程图标、会话右键菜单项）：
  // 同样必须在桌面门之前注册——桌面端 App 就是主服务端，图标和菜单恰好
  // 住在它的标题行与会话菜单里。部件自身按数据降级：shares 路由 404
  // （子客户端部署没有这条路由）时渲染为空；手机外壳下样式表把
  // header.actions 全量隐藏（styles/header.css.ts），图标也就不订阅
  // （subscribeIfNotPhoneShell）——订阅是轮询的燃料，不订阅就不发
  // admin/shares 请求。设置页的共享列表在 SettingsSection 内部，随设置
  // 页已在门之前。
  registerRemoteShareUi(ctx, RemoteHeaderIcon, RemoteShareMenuItem)

  // T34 子客户端的远程状态两件套（标题行连接图标、composer 横幅）：同样在
  // 桌面门之前注册——桌面端 App 也能以 client 角色接入服务端。部件自身按
  // 数据降级：只在虚拟 id 会话渲染、首次 GET 应答前不渲染，所以主服务端
  // 的页面上两者都是空，桌面保持逐像素 no-op；订阅本身也按虚拟 id 门控
  // （remote-status.ts 的 subscribeIfVirtual）——本地会话不建立订阅，
  // store 只在有订阅者时才轮询，主服务端的页面不白发 remote-status 请求。
  registerRemoteStatusUi(ctx, RemoteStatusIcon, RemoteComposerBanner)
  // T62 当前会话信号的上报：拦截层跑在后台 Node 进程里，读不到浏览器的
  // localStorage——由这里（唯一读得到宿主选择存储的地方）把「当前打开的
  // 会话」在值变化时 POST 给后台路由。同样在桌面门之前挂载：client 角色
  // 的桌面端 App 正是远程会话所在；只在探测出的子客户端角色下运行，主
  // 服务端的页面探测一次后就静默。
  mountCurrentSessionReporter(ctx)
  // 远程会话拖拽附件（RD-2）：document 级 capture 阶段的 drop 拦截。桌面端
  // 的同机零拷贝会把拖入的文件变成 `@本机绝对路径` chip，远程会话里服务端
  // 读不到这个路径——守卫把远程会话的文件拖拽改写成无路径 File 的合成
  // drop（宿主原生管道按浏览器拖拽走字节上传，再由 T51 的 fetch-route
  // 拦截经中继转服务端）。判定在 client-data/remote-drop.ts（纯函数），
  // 这里只做监听与重派发。同样必须在桌面门之前挂载：远程会话恰在桌面端
  // 全宽使用；三门全不中（本地会话 / 手机端无 bridge / 非受信事件）时
  // 零干预，主服务端的页面不受影响。
  mountRemoteDropGuard(ctx)
  // T64 服务端分组展开状态的记忆与恢复：宿主在工作区列表 ready 时会把不在
  // 列表里的分组展开记录清掉（retainAccountKeys），而本地工作区先 ready、
  // 服务端分组后并入，zr~ 键每次加载都被清掉、分组回到折叠。与上报器共用
  // 挂载点与角色判断（同一个 client-config 探测）、同样的 1 秒节拍（自己的
  // 定时器），逻辑在 remote-group-expansion.ts 自己的文件里。
  mountRemoteGroupExpansionKeeper(ctx)
  mountHostWorkspaceSwitcher(ctx)
  // T41b 的两个远程会话部件：fetch 改写（改动 / diff 面板的两条 /api GET）与
  // 远程会话标记（data-zr-remote-session + 隐藏「在服务端机器上打开」类入口
  // 的样式）。同样必须在桌面门之前注册——桌面窗口也可以是配对好的子客户端，
  // 改写与隐藏在它里面一样必要。改写只碰「同源 + 精确两条路径 + zr~ 虚拟
  // 会话 id」的 GET（remote-fetch.ts），宿主角色的桌面端（会话 id 永非虚拟）
  // 逐字节原样放行；标记属性只在虚拟会话打开时出现，卸载时还原。
  ctx.effect(() => installRemoteApiFetch(window), 'dsh-zen-remote: remote api fetch')
  installRemoteSessionGuard(ctx)
  // T74 模型选单分组按会话归属显示：0.2.0 的 MenuGroup 的 aria-labelledby 只剩
  // useId（分组 id 不再出现在标记里），旧的 zr~ 前缀选择器失效——改为 effect 给
  // 分组打 data-zr-group 标（分类依据是虚拟分组名开头的不可见标记，见
  // client-data/model-group-side.ts），CSS 按标隐藏。同样必须在桌面门之前挂载：
  // 桌面端子客户端的模型选单一样要分侧，桌面无手机外壳不影响它。
  installModelGroupSide(ctx)

  ctx.effect(() => {
    let lastRefreshAt = 0
    const timers = new Set<number>()
    const refreshCatalog = (force = false): void => {
      const now = Date.now()
      if (!force && now - lastRefreshAt < 3000) return
      const md = ctx.get('modelDirectories') as { catalog?: { refresh?: () => void } } | undefined
      if (md?.catalog && typeof md.catalog.refresh === 'function') {
        lastRefreshAt = now
        try {
          md.catalog.refresh()
        } catch {
          // ignore transient refresh errors
        }
      }
    }
    const schedulePostSaveRefresh = (): void => {
      for (const delay of [450, 1400]) {
        const timer = window.setTimeout(() => {
          timers.delete(timer)
          refreshCatalog(true)
        }, delay)
        timers.add(timer)
      }
    }
    const initTimer = window.setTimeout(() => {
      timers.delete(initTimer)
      refreshCatalog(true)
    }, 120)
    timers.add(initTimer)
    const disposers: Array<() => void> = []
    const remote = ctx.get('remote') as { $on?: (event: string, cb: () => void) => () => void } | undefined
    if (remote && typeof remote.$on === 'function') {
      disposers.push(remote.$on('settings/document-updated', schedulePostSaveRefresh))
      disposers.push(remote.$on('credentials/reference-updated', schedulePostSaveRefresh))
      disposers.push(remote.$on('credentials/record-updated', schedulePostSaveRefresh))
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      if (!target) return
      const btn = target.closest('button[aria-haspopup="menu"], button[class*="_trigger"]')
      if (btn) refreshCatalog(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // ignore
        }
      }
      for (const timer of timers) window.clearTimeout(timer)
      timers.clear()
    }
  }, 'dsh-remote-hub: remote model catalog live refresh')

  ctx.inject(['connection'], (connCtx) => {
    interface RpcLike {
      call: (route: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
      [key: string]: unknown
    }
    interface RawConnectionLike {
      rpc?: RpcLike
      __zrOrigRpc?: RpcLike
      [key: symbol]: unknown
    }
    const symOrig = Symbol.for('cordis.original')
    const connProxy = connCtx.get('connection') as RawConnectionLike | undefined
    const rawConn =
      connProxy && typeof connProxy === 'object'
        ? ((connProxy[symOrig] as RawConnectionLike | undefined) ?? connProxy)
        : undefined
    if (!rawConn || !rawConn.rpc || typeof rawConn.rpc.call !== 'function') return
    if (!rawConn.__zrOrigRpc) {
      rawConn.__zrOrigRpc = rawConn.rpc
    }
    const origRpc = rawConn.__zrOrigRpc
    const origCall = origRpc.call.bind(origRpc)

    const isObj = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v)
    const CANONICAL_SPLIT_RE = /(@\[(?:\\.|[^\\\]])*\]\(dsh-session:[^\s)]*\)|dsh-session:[A-Za-z0-9_-]+)/gu
    const PLAIN_UUID_HEAD_RE =
      /^(?:【([^】]{1,32})】|\[([^\]]{1,32})\])?((?:zr~[A-Za-z0-9_.-]+~)?session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=$|[\s,，.。!！?？;；:：)）\]】>》])/iu
    const BOUNDARY_AFTER_RE = /^($|[\s,，.。!！?？;；:：)）\]】>》])/u

    const encodeRefUri = (sessionId: string): string => {
      const bytes = new TextEncoder().encode(JSON.stringify(sessionId))
      let binary = ''
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i]
        if (b !== undefined) binary += String.fromCharCode(b)
      }
      const b64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return `dsh-session:${b64url}`
    }
    const escapeRefLabel = (label: string): string => String(label).replace(/[\\\]]/gu, (m) => `\\${m}`)
    const formatRefMention = (sessionId: string, label: unknown): string => {
      const eff = typeof label === 'string' && label !== '' ? label : sessionId
      return `@[${escapeRefLabel(eff)}](${encodeRefUri(sessionId)})`
    }
    const prefixTag = (host: unknown, title: unknown): string => {
      const h = typeof host === 'string' && host.trim() !== '' ? host.trim() : '远端'
      const t = typeof title === 'string' ? title : ''
      if (t.startsWith(`【${h}】`) || t.startsWith(`[${h}]`)) return t
      return `【${h}】${t}`
    }
    const isUntitledUuidLabel = (label: unknown): boolean =>
      typeof label === 'string' &&
      /^(?:【[^】]+】|\[[^\]]+\])?session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        label.trim(),
      )
    const isExplicitUuidQuery = (q: unknown): boolean => {
      if (typeof q !== 'string') return false
      const s = q.trim()
      return (
        /^(?:【[^】]+】|\[[^\]]+\])?(?:zr~[A-Za-z0-9_.-]+~)?session-[0-9a-f-]{6,}/iu.test(s) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-/iu.test(s)
      )
    }
    const mayContainPlainMention = (text: unknown): boolean => {
      if (typeof text !== 'string' || text === '') return false
      const parts = text.split(CANONICAL_SPLIT_RE)
      for (let i = 0; i < parts.length; i += 2) {
        const seg = parts[i]
        if (!seg) continue
        if (/session-[0-9a-f]{8}-[0-9a-f]{4}-/iu.test(seg)) return true
        if (/(?:@|(?:^|[\s(（,，;；:：]))(?:【[^】]{1,32}】|\[[^\]]{1,32}\])\S/u.test(seg)) return true
        if (/(?:^|[\s(（])@[^\s@]/u.test(seg)) return true
      }
      return false
    }
    const extractPlainUuids = (text: unknown): string[] => {
      if (typeof text !== 'string' || text === '') return []
      const set = new Set<string>()
      const parts = text.split(CANONICAL_SPLIT_RE)
      for (let i = 0; i < parts.length; i += 2) {
        const seg = parts[i]
        if (!seg) continue
        for (const m of seg.matchAll(
          /((?:zr~[A-Za-z0-9_.-]+~)?session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/giu,
        )) {
          if (m[1]) set.add(m[1])
        }
      }
      return [...set]
    }

    interface CandidateItemLike {
      sessionId: string
      displayTitle?: string
      label?: string
      mention?: string
      [key: string]: unknown
    }

    const upgradePlainMentions = (
      text: string,
      candidates: readonly CandidateItemLike[],
      resolveUuid: (rawUuid: string, hostTag?: string) => { sessionId: string; label?: string } | undefined,
    ): string => {
      if (typeof text !== 'string' || text === '') return text
      const entries: Array<{ title: string; titleLower: string; hasHostPrefix: boolean; mention: string }> = []
      const seen = new Set<string>()
      for (const cand of candidates) {
        if (!isObj(cand) || typeof cand.sessionId !== 'string' || cand.sessionId === '') continue
        const mention =
          typeof cand.mention === 'string' && cand.mention.includes('dsh-session:')
            ? cand.mention
            : formatRefMention(cand.sessionId, cand.displayTitle || cand.label || cand.sessionId)
        for (const rawT of [cand.displayTitle, cand.label]) {
          if (typeof rawT !== 'string') continue
          const t = rawT.trim()
          if (t.length < 2) continue
          const hasHostPrefix = /^(?:【[^】]{1,32}】|\[[^\]]{1,32}\])\S/u.test(t)
          if (!hasHostPrefix && /^[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8}$/.test(t) && !/^session-/i.test(t)) continue
          const key = t.toLocaleLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          entries.push({ title: t, titleLower: key, hasHostPrefix, mention })
        }
      }
      entries.sort((a, b) => b.title.length - a.title.length)

      const parts = text.split(CANONICAL_SPLIT_RE)
      let anyChanged = false
      for (let idx = 0; idx < parts.length; idx += 2) {
        const seg = parts[idx]
        if (!seg) continue
        let out = ''
        let pos = 0
        let segChanged = false
        while (pos < seg.length) {
          const ch = seg[pos] ?? ''
          const prev = pos > 0 ? (seg[pos - 1] ?? '') : ''
          const atTrigger = ch === '@' && (pos === 0 || !/[A-Za-z0-9_]/.test(prev))
          const hostBracketNoAt =
            !atTrigger && (ch === '【' || ch === '[') && (pos === 0 || /[\s(（,，;；:：]/.test(prev))
          if (!atTrigger && !hostBracketNoAt) {
            out += ch
            pos += 1
            continue
          }
          const rest = seg.slice(pos + (atTrigger ? 1 : 0))
          let replaced = false

          const um = PLAIN_UUID_HEAD_RE.exec(rest)
          if (um !== null && (atTrigger || um[1] !== undefined || um[2] !== undefined)) {
            const hostTag = um[1] ?? um[2]
            const rawUuid = um[3] ?? ''
            const resolved = rawUuid !== '' ? resolveUuid(rawUuid, hostTag) : undefined
            if (resolved && typeof resolved.sessionId === 'string' && resolved.sessionId !== '') {
              const label =
                typeof resolved.label === 'string' && resolved.label !== ''
                  ? resolved.label
                  : hostTag
                    ? prefixTag(hostTag, rawUuid)
                    : rawUuid
              out += formatRefMention(resolved.sessionId, label)
              pos += (atTrigger ? 1 : 0) + um[0].length
              segChanged = true
              replaced = true
            }
          }

          if (!replaced && entries.length > 0) {
            const restLower = rest.toLocaleLowerCase()
            for (const entry of entries) {
              if (hostBracketNoAt && !entry.hasHostPrefix) continue
              if (!restLower.startsWith(entry.titleLower)) continue
              const after = rest.slice(entry.title.length)
              if (!BOUNDARY_AFTER_RE.test(after)) continue
              out += entry.mention
              pos += (atTrigger ? 1 : 0) + entry.title.length
              segChanged = true
              replaced = true
              break
            }
          }

          if (!replaced) {
            out += ch
            pos += 1
          }
        }
        if (segChanged) {
          parts[idx] = out
          anyChanged = true
        }
      }
      return anyChanged ? parts.join('') : text
    }

    const visitBlocks = (content: unknown, fn: (t: string) => string): void => {
      if (!Array.isArray(content)) return
      for (const block of content) {
        if (isObj(block) && block.type === 'text' && typeof block.text === 'string') {
          block.text = fn(block.text)
        }
      }
    }
    const mapDeepStrings = (val: unknown, fn: (t: string) => string): unknown => {
      if (typeof val === 'string') return fn(val)
      if (Array.isArray(val)) return val.map((item) => mapDeepStrings(item, fn))
      if (isObj(val)) {
        const next: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(val)) next[k] = mapDeepStrings(v, fn)
        return next
      }
      return val
    }
    const applyInjectableTexts = (endpoint: string, args: unknown, fn: (t: string) => string): unknown => {
      if (!isObj(args)) return args
      const req = isObj(args.request) ? args.request : undefined
      if (endpoint === 'session/prompt' || endpoint === 'subagents/prompt') {
        if (req) visitBlocks(req.content, fn)
        return args
      }
      if (endpoint === 'session/updateQueue') {
        if (req && isObj(req.action) && req.action.kind === 'edit') visitBlocks(req.action.content, fn)
        return args
      }
      if (endpoint === 'commands/execute') {
        return mapDeepStrings(args, fn)
      }
      return args
    }
    const collectInjectableTexts = (endpoint: string, args: unknown): string[] => {
      const out: string[] = []
      applyInjectableTexts(endpoint, args, (t) => {
        out.push(t)
        return t
      })
      return out
    }

    const wrappedCall = async (
      route: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<unknown> => {
      if (endpoint === 'sessionReferenceResolver/candidates') {
        const res = await origCall(route, endpoint, payload, signal)
        if (!isObj(res) || res.ok !== true || !Array.isArray(res.value)) return res
        const rawQ =
          isObj(payload) && isObj(payload.args) && typeof payload.args.query === 'string' ? payload.args.query : ''
        if (isExplicitUuidQuery(rawQ)) return res
        const byId = (ctx.get('sessions')?.list?.getSnapshot()?.byId ?? {}) as Readonly<
          Record<string, { blank?: boolean }>
        >
        const filtered = res.value.filter((row: unknown) => {
          if (!isObj(row) || typeof row.sessionId !== 'string') return false
          if (byId[row.sessionId]?.blank === true) return false
          if (isUntitledUuidLabel(row.displayTitle ?? row.label ?? '')) return false
          return true
        })
        return { ...res, value: filtered }
      }

      if (
        endpoint === 'session/prompt' ||
        endpoint === 'subagents/prompt' ||
        endpoint === 'session/updateQueue' ||
        endpoint === 'commands/execute'
      ) {
        const args = isObj(payload) ? payload.args : undefined
        const texts = collectInjectableTexts(endpoint, args)
        if (texts.some((t) => mayContainPlainMention(t))) {
          try {
            const byId = (ctx.get('sessions')?.list?.getSnapshot()?.byId ?? {}) as Readonly<Record<string, unknown>>
            const req = isObj(args) && isObj(args.request) ? args.request : undefined
            const contextSessionId =
              (typeof req?.sessionId === 'string' && req.sessionId !== '' ? req.sessionId : undefined) ??
              (typeof req?.parentSessionId === 'string' && req.parentSessionId !== ''
                ? req.parentSessionId
                : undefined) ??
              (isObj(args) && typeof args.agentId === 'string' && args.agentId !== '' ? args.agentId : undefined) ??
              (isObj(args) && typeof args.sessionId === 'string' && args.sessionId !== '' ? args.sessionId : undefined) ??
              Object.keys(byId)[0]

            const candidates: CandidateItemLike[] = []
            if (typeof contextSessionId === 'string' && contextSessionId !== '') {
              const lookupQueries = ['', ...extractPlainUuids(texts.join('\n'))]
              const settled = await Promise.all(
                lookupQueries.map((q) =>
                  origCall(
                    '/api',
                    'sessionReferenceResolver/candidates',
                    { args: { agentId: contextSessionId, query: q } },
                    signal,
                  ).catch(() => null),
                ),
              )
              const seenIds = new Set<string>()
              for (const item of settled) {
                if (!isObj(item) || item.ok !== true || !Array.isArray(item.value)) continue
                for (const row of item.value) {
                  if (!isObj(row) || typeof row.sessionId !== 'string' || seenIds.has(row.sessionId)) continue
                  seenIds.add(row.sessionId)
                  candidates.push(row as CandidateItemLike)
                }
              }
            }

            const inferRemoteServerId = (): string | undefined => {
              if (typeof contextSessionId === 'string' && contextSessionId.startsWith('zr~')) {
                const segs = contextSessionId.split('~')
                if (segs.length >= 3 && segs[1]) return segs[1]
              }
              for (const k of Object.keys(byId)) {
                if (k.startsWith('zr~')) {
                  const segs = k.split('~')
                  if (segs.length >= 3 && segs[1]) return segs[1]
                }
              }
              return undefined
            }

            const resolveUuid = (rawUuid: string, hostTag?: string): { sessionId: string; label: string } => {
              const tagLower = typeof hostTag === 'string' ? hostTag.trim().toLocaleLowerCase() : ''
              if (rawUuid.startsWith('zr~')) {
                return { sessionId: rawUuid, label: hostTag ? prefixTag(hostTag, rawUuid) : rawUuid }
              }
              if (tagLower === '本机' || tagLower === '本地' || tagLower === 'local') {
                const hit = candidates.find((c) => c.sessionId === rawUuid)
                return { sessionId: rawUuid, label: hit?.displayTitle ?? prefixTag('本机', rawUuid) }
              }
              if (tagLower !== '') {
                const srvId = inferRemoteServerId()
                if (srvId) {
                  const virtId = `zr~${srvId}~${rawUuid}`
                  const hit = candidates.find((c) => c.sessionId === virtId)
                  return { sessionId: virtId, label: hit?.displayTitle ?? prefixTag(hostTag, rawUuid) }
                }
              }
              const candHit = candidates.find((c) => c.sessionId === rawUuid || c.sessionId.endsWith(`~${rawUuid}`))
              if (candHit) {
                return { sessionId: candHit.sessionId, label: candHit.displayTitle ?? candHit.label ?? rawUuid }
              }
              if (byId[rawUuid]) {
                return { sessionId: rawUuid, label: rawUuid }
              }
              const srvId = inferRemoteServerId()
              if (srvId && byId[`zr~${srvId}~${rawUuid}`]) {
                return { sessionId: `zr~${srvId}~${rawUuid}`, label: rawUuid }
              }
              if (typeof contextSessionId === 'string' && contextSessionId.startsWith('zr~') && srvId) {
                return { sessionId: `zr~${srvId}~${rawUuid}`, label: rawUuid }
              }
              return { sessionId: rawUuid, label: rawUuid }
            }

            const clonedPayload = structuredClone(payload) as Record<string, unknown>
            clonedPayload.args = applyInjectableTexts(endpoint, clonedPayload.args, (text) =>
              upgradePlainMentions(text, candidates, resolveUuid),
            )
            return origCall(route, endpoint, clonedPayload, signal)
          } catch {
            // Fall back to original payload on any unexpected error
          }
        }
      }

      return origCall(route, endpoint, payload, signal)
    }

    const wrappedRpc: RpcLike = Object.assign({}, origRpc, { call: wrappedCall })
    rawConn.rpc = wrappedRpc
    connCtx.effect(
      () => () => {
        if (rawConn.rpc === wrappedRpc) {
          rawConn.rpc = origRpc
        }
      },
      'dsh-remote-hub: cross-host session reference enhancer',
    )
  })

  // 2.2.6 远程会话产物下载：子客户端最常见的诉求是「把服务端工作区里刚产出的
  // 文件拿到本机」。DSH 官方的产物卡片只有预览，打开类动作（present.open /
  // open-in-app）作用于跑 DSH 的那台机器，远程会话里被样式表整组隐藏——
  // 也就是说此前客户端根本没有把文件落到本机磁盘的入口。两个入口共用同一个
  // 「读中继 + 浏览器下载」实现（RemoteFileDownload.tsx + remote-file-save.ts）：
  // deliverable 卡片上的按钮从卡片自己的预览按钮 title 取绝对路径，
  // 文档预览头的按钮直接拿 owner 给的 absolutePath；两者都只在虚拟会话渲染，
  // 主服务端与本地会话逐像素 no-op。同样在桌面门之前注册——client 角色的
  // 桌面端 App 正是远程会话所在。
  const saveRemoteFileToLocal = createSaveRemoteFile(ctx)
  ctx.slots.inject('deliverables.file.actions', () =>
    ctx.slots.register(
      {
        name: 'deliverables.file.actions',
        id: 'zr-download',
        order: 40,
        locale: NS,
        inject: () => ({ saveFile: saveRemoteFileToLocal }),
      },
      DeliverableDownload,
    ),
  )
  ctx.slots.inject('sidebar.right.tab.document.actions', () =>
    ctx.slots.register(
      {
        name: 'sidebar.right.tab.document.actions',
        id: 'zr-download',
        order: 40,
        locale: NS,
        inject: () => ({ saveFile: saveRemoteFileToLocal }),
      },
      DocumentDownload,
    ),
  )

  // Desktop gate (DSH 0.1.7): the official Electron shell can be dragged
  // down to ~520px wide, where every width-based gate would flip the phone
  // shell on inside the desktop app. Inside that shell this plugin is a
  // complete no-op — no stylesheet, no effects, no slot entries, which is
  // bit-for-bit "not installed" and also retires the desktop-fold knobs
  // there (they exist for narrow desktop *browsers*, which never carry the
  // dshDesktop bridge). See compat/desktop.ts for the marker's provenance.
  if (isDesktopShell()) return

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-zen-remote'
    tag.dataset.pluginCss = 'dsh-zen-remote/mobile.css'
    tag.textContent = MOBILE_CSS
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  }, 'dsh-mobile-nav: styles')

  // Diagnostic overlay for phone-side repros (?mobile-nav-debug=1).
  installDebugBadge(ctx)

  installPhoneChrome(ctx)

  // Standalone-PWA only: undo the WebKit keyboard bug that permanently steals
  // the status-bar height from the viewport (the ~60px band under the
  // composer and the session list). No-op in any browser tab.
  installViewportHeal(ctx)

  // Registered after the heal so a viewport that heals is measured healed:
  // when the strip is real, drop the home-indicator padding that would only
  // stack more blank page on top of it.
  installSunkInset(ctx)

  installAionuiCompat(ctx)

  // Phone: tapping a file's @-reference in the workbench closes the panel —
  // the conversation returning with the fresh mention IS the tap feedback.
  installWorkbenchRefClose(ctx)

  // Session header running-status dot (S2): no official element exists to
  // reposition, so this reads ctx.sessions directly and self-draws via CSS.
  installHeaderStatusDot(ctx)

  // S6: content-area swipe (Chat/Trajectory) + sheet drag-to-close.
  installGestures(ctx)

  // S8: fold a turn's process (tool calls, injected context, slash commands,
  // Think rows) behind one summary chip. Chat view only, phone only — see
  // effects/turn-fold.ts for why the keyed conversation.chat.node seat could
  // not carry this.
  installTurnFold(ctx)
  installModalBack(ctx)
  installNativeTriggerOverlay(ctx)
  // Third-party composer entries (speed chip, vision toggle) move into the
  // model sheet — the row has no width to spare and both are model settings.
  installModelSheetExtras(ctx)
  // T70: the permission menu portals to body on DSH 0.2.0 — mark it so
  // composer.css section 4 can still make it the bottom sheet.
  installPermissionSheet(ctx)

  // "内测声明" first-run notice: keep it visible (CSS-hiding it leaked the
  // dialog's #root inert lock — see effects/welcome-notice.ts) and offer a
  // per-browser "不再弹出" opt-out instead.
  installWelcomeNoticeOptOut(ctx)

  // S9: opening a session must not pop the phone keyboard — the official
  // composer autofocuses on every sessionId change; keep focus only when the
  // user tapped the composer (or typed) themselves.
  installKeyboardGuard(ctx)

  // S10: when the keyboard shrinks the visual viewport but the browser fails
  // to reveal the focused composer (issue #1 的「视口缩了页面没跟上」类环境),
  // translate the composer up by the occluded band. Inert everywhere else.
  installKeyboardAvoid(ctx)

  // Page-stack store (apply world) — created before any registration so
  // every slot below (the phone home screen, the session header's back
  // button) shares the exact same handle/instance.
  const nav = createNavStore()

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'mobile-nav-toggle',
    order: 10,
    locale: NS,
    inject: () => ({
      toggleSidebar: () => ctx.layout.toggleSidebar(),
    }),
  }, MobileNavToggle))

  // Session header back button + Chat/Trajectory view-switch row (S2).
  // Renders unconditionally; CSS (styles/header.css.ts) keeps it hidden at
  // >= 768px. Order is irrelevant here — the phone stylesheet hides every
  // other header.actions entry and only re-shows this one.
  //
  // No `store: nav` here: this slot is session-scope while `nav` already
  // mounts at shell.overlay's root scope, and a handle can only mount
  // under one scope (runtime throws otherwise — see nav-store.ts). The
  // back button dispatches GO_HOME_EVENT and MobileHome applies it.
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'mobile-header-actions',
    order: 0,
    locale: NS,
    // Activity-pill data (subagent catalog + job roster), see activityInject.
    inject: () => activityInject(ctx),
  }, MobileHeaderActions))

  // Session-info entry (placeholder — S4 owns the sheet) + workbench entry
  // (dsh-better-sidebar, see MobileSessionHeader.tsx for the trigger).
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'mobile-header-utilities',
    order: 0,
    locale: NS,
  }, MobileHeaderUtilities))

  // Session-info sheet (S4): a second, sibling entry on the SAME slot as
  // the ⓘ button above — it listens for the CustomEvent that button fires
  // instead of sharing render state with it. Session scope gives this
  // entry useProjection/sessionId (the stats grid) for free alongside the
  // always-present useSessions/useWorkspaces (see MobileSessionInfo.tsx's
  // header comment for the full mount-point tradeoff against shell.overlay).
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'mobile-session-info',
    order: 10,
    locale: NS,
    // The factory's own sessionId param is unused: every function below
    // takes its own session id explicitly (they're generic action bindings
    // reused verbatim, not closures over one particular session). The
    // spread adds the activity-pill data (subagent catalog + job roster for
    // the info-sheet badges), see activityInject.
    inject: (_sessionId: SessionId) => ({
      ...activityInject(ctx),
      // T67: the SAME page-wide shares store the header icon and the menu
      // item read — the row subscribes only while the sheet is open, so no
      // second poll loop and no phone-shell polling either.
      shares: getSharesStore(),
      forkSession: (id: SessionId) => ctx.sessions.fork({ sessionId: id }),
      // 0.1.7: ctx.sessions.open is gone; uiWorkspace.openSession is the one
      // navigation entry (also what the official subagent catalog uses).
      // Lazy lookup like every other uiWorkspace binding here: the callback
      // runs on a user tap, by which time the service is registered.
      openSession: (id: SessionId) => {
        const ui = ctx.get('uiWorkspace') as UiWorkspaceLike | undefined
        if (ui === undefined) console.warn('[dsh-zen-remote] uiWorkspace service unavailable; cannot open session', id)
        else ui.openSession(id)
      },
      renameSession: (id: SessionId, title: string) => ctx.sessions.binding(id)?.session.rename(title),
      // 0.1.2 的界面级归档在 uiWorkspace（顺带清当前选中）；懒查——回调是用户
      // 点击才跑，那时服务必已注册。本插件的 inject 不包含 uiWorkspace，
      // 所以启动时不能查一次就用：可能早于它注册。
      archiveSession: (id: SessionId) => {
        const ui = ctx.get('uiWorkspace') as UiWorkspaceLike | undefined
        return ui === undefined ? ctx.workspaces.archiveSession(id) : ui.archiveSession(id)
      },
      downloadSessionLog: (id: SessionId) => ctx.sessionLogDownload.download(id),
    }),
  }, MobileSessionInfo))

  // Composer attachment seat (S7). Registered unconditionally;
  // styles/composer.css.ts hides it at >= 768px and orders it into the
  // leftmost seat of the phone composer row.
  //
  // No `inject` here: every attachment now rides the host upload route and
  // the standard session props (`sessionId`, `inputActions`), so the button
  // needs nothing bound off ctx. S7.1 removed the session.prompt binding that
  // used to send inlineable images straight into the conversation.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'mobile-attach',
    order: 0,
    locale: NS,
  }, MobileAttachButton))

  // Attachment preview row (S7.1), above the composer card. Renders purely
  // off the draft's @.dsh-uploads/ tokens — see MobileAttachChips.tsx. Order 0
  // puts it left of the git branch chip (order 100) on the shared dock line.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'mobile-attach-chips',
    order: 0,
    locale: NS,
  }, MobileAttachChips))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'mobile-nav-overlay',
    order: 10,
    locale: NS,
    inject: () => ({
      toggleSidebar: () => ctx.layout.toggleSidebar(),
    }),
  }, MobileNavOverlay))

  // Phone app shell (< 768px): the full-screen session list that is level 1
  // of the page stack. Owns the `nav` handle created above (root scope);
  // the session header's back button listens for GO_HOME_EVENT instead of
  // sharing the handle directly (see nav-store.ts and the comment above).
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'mobile-home',
    order: 20,
    locale: NS,
    store: nav,
    inject: () => ({
      // Same uiWorkspace.openSession binding as the session-info sheet above.
      openSession: (id: SessionId) => {
        const ui = ctx.get('uiWorkspace') as UiWorkspaceLike | undefined
        if (ui === undefined) console.warn('[dsh-zen-remote] uiWorkspace service unavailable; cannot open session', id)
        else ui.openSession(id)
      },
      // uiWorkspace 懒查：回调是用户点击才跑，服务那时必已注册（inject 不含
      // uiWorkspace，启动时可能先于它注册，不能启动查一次就用）。
      startSession: (workspaceId?: WorkspaceId) => {
        const ui = ctx.get('uiWorkspace') as UiWorkspaceLike | undefined
        if (ui === undefined) console.warn('[dsh-zen-remote] uiWorkspace service unavailable; cannot start a session')
        else ui.startSession(workspaceId)
      },
      // S5 session-log chip — the same service call MobileDrawerFooter uses.
      downloadSessionLog: (id: SessionId) => ctx.sessionLogDownload.download(id),
      // Row swipe action — the same binding MobileSessionInfo archives with;
      // on 0.1.2 the uiWorkspace variant also clears the current selection
      // when the archived session is the one selected. Same lazy lookup as
      // the session-info sheet's archive binding above.
      archiveSession: (id: SessionId) => {
        const ui = ctx.get('uiWorkspace') as UiWorkspaceLike | undefined
        return ui === undefined ? ctx.workspaces.archiveSession(id) : ui.archiveSession(id)
      },
    }),
  }, MobileHome))

  // Session log download, relocated from the session header to the drawer
  // footer on mobile (the header capsule is hidden by CSS); the drawer
  // footer also hosts the Files action that opens the dsh-web-ui explorer
  // sheet.
  //
  // Footer stacking relies on the list-slot sort by (priority, order):
  // dsh-remote-web-ui leaves it unset (default 0, its two icon buttons stay
  // on top) and dsh-usage-stats uses 10. Order 5 keeps the Files + Session
  // log pills directly under the icon row with the usage/balance badge
  // below them — instead of a tie at 10 where registration order could
  // wedge the badge between the icons and the pills.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'mobile-nav-session-log',
    order: 5,
    locale: NS,
    inject: () => ({
      // The footer slot contract hands the id over as a loose string;
      // download() wants the branded SessionId — pure type-layer narrowing
      // (runtime value is a session id either way, same as MobileHome.tsx).
      downloadSessionLog: (sessionId: string) => ctx.sessionLogDownload.download(sessionId as SessionId),
      toggleSidebar: () => ctx.layout.toggleSidebar(),
    }),
  }, MobileDrawerFooter))

  // Share-card debug preview (ticket 03): renders the share-card template at
  // the top of the page so its layout is inspectable before the rasterizer
  // (ticket 04) exists. Registered ONLY with the URL param, so the no-param
  // path — including desktop — stays bit-for-bit untouched (same debug-param
  // exemption as ?mobile-nav-inset=, see debug.ts).
  if (new URLSearchParams(location.search).has('mobile-nav-share-preview')) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'share-preview',
      // Above the phone home screen (order 20) within the same overlay layer.
      order: 30,
      locale: NS,
    }, SharePreview))
  }
}

// Type-only augmentation imports: pull the layout / conversation / sidebar
// SlotMap merges and the sessionLogDownload service typing into this program
// without any runtime import.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-session-log-export/client'
// ui-session: augments GlobalStandardProps with useSessions /
// useSessionPendingInteraction / useSessionStatus and SessionStandardProps
// with sessionId/useSession/useProjection, and declares the `ctx.uiSession`
// service.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Controller packages: their `/client` type entries merge `ctx.sessions` /
// `ctx.workspaces` onto the cordis Context. Type-only — nothing to load at
// runtime.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: the renderer declares `ctx.slots` on the cordis Context (the
// service this plugin registers every slot through) and `dsh-subagent/client`
// types the subagent catalog projection entries the session header reads
// (projectionsBySession[].values.subagentCatalog on 0.1.7).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-subagent/client'
