/**
 * 系统通知投递层（P0-④ 阶段 2）。
 *
 * 这里守的全是"坏了也不该反噬"的路径：插件没装（网页版）、权限被拒、插件抛错 ——
 * 一律返回 false，让应用内横幅仍然是那条提醒的兜底。真机 Toast 由桌面验收，不在单测射程内。
 */
import { describe, expect, it, vi } from 'vitest'
import { sendSystemNotifications, type NotifyPlugin } from '../../src/vue/notify'

const item = { key: 'countdown:2026-10-21', title: '今天是「发布」', body: '倒数到站了。' }

function fakePlugin(over: Partial<NotifyPlugin> = {}) {
  const sent: { title: string; body: string }[] = []
  const plugin: NotifyPlugin = {
    isPermissionGranted: async () => true,
    requestPermission: async () => 'granted',
    sendNotification: (o) => void sent.push(o),
    ...over,
  }
  return { plugin, sent }
}

describe('sendSystemNotifications', () => {
  it('没有条目就不加载插件（空投递不碰权限）', async () => {
    const load = vi.fn(async () => null)
    expect(await sendSystemNotifications([], { load })).toBe(false)
    expect(load).not.toHaveBeenCalled()
  })

  it('插件加载不到（网页版）→ false，不抛', async () => {
    expect(await sendSystemNotifications([item], { load: async () => null })).toBe(false)
    expect(
      await sendSystemNotifications([item], {
        load: async () => {
          throw new Error('no plugin')
        },
      }),
    ).toBe(false)
  })

  it('已有权限 → 每条一条系统通知，顺序不变', async () => {
    const { plugin, sent } = fakePlugin()
    const two = [item, { key: 'habit:2026-10-21', title: '今天还没打卡：跑步', body: '今天还差一次。' }]
    expect(await sendSystemNotifications(two, { load: async () => plugin })).toBe(true)
    expect(sent).toEqual([
      { title: '今天是「发布」', body: '倒数到站了。' },
      { title: '今天还没打卡：跑步', body: '今天还差一次。' },
    ])
  })

  it('没有权限就申请一次；批了才发', async () => {
    const asked = vi.fn(async () => 'granted' as const)
    const { plugin, sent } = fakePlugin({ isPermissionGranted: async () => false, requestPermission: asked })
    expect(await sendSystemNotifications([item], { load: async () => plugin })).toBe(true)
    expect(asked).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(1)
  })

  it('权限被拒 → false 且一条都不发', async () => {
    const { plugin, sent } = fakePlugin({
      isPermissionGranted: async () => false,
      requestPermission: async () => 'denied',
    })
    expect(await sendSystemNotifications([item], { load: async () => plugin })).toBe(false)
    expect(sent).toEqual([])
  })

  it('走默认加载器：node 里没有 Tauri IPC → 拿得到插件也调不动，仍返回 false 且不抛', async () => {
    // 这条覆盖的是真实入口（不注入 load）：`@tauri-apps/plugin-notification` 在 node 里
    // import 能成功，但 invoke 没有 `__TAURI_INTERNALS__`；两种失败形态都必须落到 false。
    await expect(sendSystemNotifications([item])).resolves.toBe(false)
  })

  it('插件抛错 → false，不把异常抛给调用方（横幅兜底）', async () => {
    const { plugin } = fakePlugin({
      sendNotification: () => {
        throw new Error('toast failed')
      },
    })
    expect(await sendSystemNotifications([item], { load: async () => plugin })).toBe(false)

    const broken = { ...fakePlugin().plugin, isPermissionGranted: async () => Promise.reject(new Error('ipc')) }
    expect(await sendSystemNotifications([item], { load: async () => broken })).toBe(false)
  })
})
