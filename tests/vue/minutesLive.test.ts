/**
 * 会议速记卡的纯逻辑层（`src/vue/minutesLive.ts`）。
 *
 * ## 为什么单独给这一层写测试
 * 卡本体（`MinutesCard.vue`）要真 Tauri 壳 + 真麦克风才跑得起来，E2E 也造不出
 * "ASR 模型没下载完" / "设备被拔" / "同一句被重复投递" 这三种局面；而这张卡出错的
 * 地方恰好全在这三种局面的判定上。所以把判定抽成纯函数在这里钉死，卡里只留胶水。
 *
 * ## 这条断言在守什么（每条都写清了"没有它会挂成什么样"）
 * 时长口径、字幕去重排序、按钮可用性、设备挑选 —— 四条都是"看起来对、用起来错"的类型。
 */

import { describe, expect, it } from 'vitest'
import {
  appendSegments,
  asModelState,
  DESKTOP_ONLY_HINT,
  deriveControls,
  describeResult,
  deviceLabel,
  elapsedOf,
  formatBytes,
  formatDuration,
  formatSegmentTime,
  LIVE_SEGMENT_CAP,
  listDevicesFor,
  pauseRun,
  pickDevice,
  progressFrac,
  startRun,
  type AudioDevice,
  type ControlState,
  type Segment,
  type StopResult,
} from '../../src/vue/minutesLive'

function seg(startMs: number, endMs: number, text: string): Segment {
  return { startMs, endMs, text }
}

function dev(id: string, kind: 'input' | 'output', isDefault = false): AudioDevice {
  return { id, name: `设备 ${id}`, isDefault, kind }
}

describe('asModelState', () => {
  it('五个已知状态原样透传', () => {
    for (const s of ['missing', 'downloading', 'verifying', 'ready', 'failed'] as const) {
      expect(asModelState(s)).toBe(s)
    }
  })

  /**
   * 未知值落到 `missing` 而不是 `ready`：前者最多多显示一个下载按钮，
   * 后者会让人点"开始"然后收一个后端 reject —— 两者都能用，但只有一个不骗人。
   */
  it('未知 / 空串落到 missing（宁可多一个下载按钮，也不假装就绪）', () => {
    expect(asModelState('ready-v2')).toBe('missing')
    expect(asModelState('')).toBe('missing')
    expect(asModelState('READY')).toBe('missing')
  })
})

describe('formatDuration', () => {
  it('口径①：向下取整到秒 —— 59.9 秒显示 00:59，计时器不能提前跳下一秒', () => {
    expect(formatDuration(59_999)).toBe('00:59')
    expect(formatDuration(999)).toBe('00:00')
    expect(formatDuration(1_999)).toBe('00:01')
  })

  it('口径②：不满一小时给 mm:ss，满一小时给 h:mm:ss（小时不补零）', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(60_000)).toBe('01:00')
    expect(formatDuration(3_599_000)).toBe('59:59')
    expect(formatDuration(3_600_000)).toBe('1:00:00')
    expect(formatDuration(3_723_000)).toBe('1:02:03')
    expect(formatDuration(36_000_000)).toBe('10:00:00')
  })

  it('口径③：负数 / 非有限值一律当 0 —— 界面上绝不能出现 NaN:NaN', () => {
    for (const bad of [-1, -3_600_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatDuration(bad)).toBe('00:00')
    }
  })
})

describe('formatSegmentTime', () => {
  it('恒定 mm:ss：75 分钟继续写作 75:00，不切 h:mm:ss（否则整列文本会跳一格）', () => {
    expect(formatSegmentTime(0)).toBe('00:00')
    expect(formatSegmentTime(4_500_000)).toBe('75:00')
    expect(formatSegmentTime(4_505_000)).toBe('75:05')
    expect(formatSegmentTime(600_000)).toBe('10:00')
  })

  it('同样向下取整，同样兜住负数与非有限值', () => {
    expect(formatSegmentTime(59_999)).toBe('00:59')
    expect(formatSegmentTime(-5)).toBe('00:00')
    expect(formatSegmentTime(Number.NaN)).toBe('00:00')
  })
})

describe('formatBytes', () => {
  it('B 取整、其余保留一位小数，1024 进制', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1_048_576)).toBe('1.0 MB')
    expect(formatBytes(256_000_000)).toBe('244.1 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
  })

  it('超过 TB 不再进位（单位表到头了），非正值给 0 B', () => {
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB')
    expect(formatBytes(1024 ** 5)).toBe('1024.0 TB')
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})

describe('progressFrac', () => {
  it('总大小未知（0 / 负数 / 非有限）返回 null —— 界面据此走"只报已下载字节"，不拿 0% 冒充', () => {
    expect(progressFrac(0, 0)).toBeNull()
    expect(progressFrac(100, 0)).toBeNull()
    expect(progressFrac(100, -5)).toBeNull()
    expect(progressFrac(100, Number.NaN)).toBeNull()
  })

  it('已收字节非法时算 0（不留 NaN 给样式用）', () => {
    expect(progressFrac(0, 100)).toBe(0)
    expect(progressFrac(-1, 100)).toBe(0)
    expect(progressFrac(Number.NaN, 100)).toBe(0)
  })

  it('正常区间原样给出，超出总量夹到 1', () => {
    expect(progressFrac(50, 100)).toBe(0.5)
    expect(progressFrac(200, 100)).toBe(1)
  })
})

describe('appendSegments', () => {
  it('空文本 / 纯空白丢掉：摆一行空文本只会让人以为卡了', () => {
    const prev = [seg(0, 1000, '你好')]
    const out = appendSegments(prev, [seg(1000, 2000, '   '), seg(2000, 3000, '')])
    expect(out).toBe(prev)
  })

  /**
   * IPC 载荷是外部数据：字段缺失时按空串处理，而不是让 `undefined.trim()` 把整卡打崩。
   * （类型上 `text` 是 string，运行时不保证。）
   */
  it('text 字段缺失 / null 按空串处理，不抛', () => {
    const prev = [seg(0, 1000, '你好')]
    const bad = [
      { startMs: 0, endMs: 1, text: null },
      { startMs: 1000, endMs: 2, text: undefined },
    ] as unknown as Segment[]
    expect(appendSegments(prev, bad)).toBe(prev)
  })

  it('一条都没收下时返回**原数组本身**（引用不变）—— 否则空转的事件也会触发一轮渲染', () => {
    const prev = [seg(0, 1000, '你好')]
    expect(appendSegments(prev, [])).toBe(prev)
    expect(appendSegments(prev, [seg(0, 1000, '重复起点')])).toBe(prev)
  })

  it('同 startMs 的去重：已有的丢新的（整句发射没有"修正"语义，保留先到的才可复现）', () => {
    const prev = [seg(1000, 2000, '第一版')]
    const out = appendSegments(prev, [seg(1000, 2000, '第二版')])
    expect(out).toBe(prev)
    expect(out[0].text).toBe('第一版')
  })

  it('同一批 incoming 内部也去重（同一句被投递两次时只留一条）', () => {
    const out = appendSegments([], [seg(1000, 2000, '甲'), seg(1000, 2000, '甲的副本')])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('甲')
  })

  it('乱序到达按 startMs 升序落位（事件不保证顺序）', () => {
    const out = appendSegments([seg(3000, 4000, '丙')], [seg(1000, 2000, '甲'), seg(2000, 3000, '乙')])
    expect(out.map((s) => s.text)).toEqual(['甲', '乙', '丙'])
  })

  it('startMs 非有限或负数夹到 0；endMs 早于 startMs 时抬到 startMs（区间不能倒挂）', () => {
    const out = appendSegments([], [seg(Number.NaN, 500, '甲'), seg(4_000, 1_000, '乙')])
    expect(out).toEqual([seg(0, 500, '甲'), seg(4_000, 4_000, '乙')])
  })

  /**
   * 夹到 0 的副作用：多条非法起点的句子会撞在同一个 0 上，于是只剩先到的那条。
   * 这是"起点不可信时宁可少一行，也不要摆一行时间错乱的字幕"的取舍，写出来钉住。
   */
  it('起点不可信的句子撞在 0 上时只剩先到的一条（不是把文本接起来）', () => {
    const out = appendSegments([], [seg(-900, -100, '乙'), seg(Number.NaN, 500, '丙')])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('乙')
  })

  it('文本两端空白去掉后再判断重不重复、再入列', () => {
    const out = appendSegments([], [seg(0, 1000, '  你好  ')])
    expect(out[0].text).toBe('你好')
  })

  it('超出上限只留末尾 cap 条：落盘归 Rust 管，视图不该被一场长会撑死', () => {
    const many = Array.from({ length: 5 }, (_, i) => seg(i * 1000, i * 1000 + 500, `第 ${i} 句`))
    const out = appendSegments([], many, 2)
    expect(out.map((s) => s.text)).toEqual(['第 3 句', '第 4 句'])
  })

  it('正好等于上限时不裁（边界：不能把第 cap 条也削掉）', () => {
    const out = appendSegments([], [seg(0, 1, '甲'), seg(1000, 1, '乙')], 2)
    expect(out).toHaveLength(2)
  })

  it('默认上限是 LIVE_SEGMENT_CAP', () => {
    const many = Array.from({ length: LIVE_SEGMENT_CAP + 3 }, (_, i) => seg(i * 10, i * 10 + 5, `第 ${i} 句`))
    const out = appendSegments([], many)
    expect(out).toHaveLength(LIVE_SEGMENT_CAP)
    expect(out[out.length - 1].text).toBe(`第 ${LIVE_SEGMENT_CAP + 2} 句`)
  })
})

describe('录制计时（elapsedOf / startRun / pauseRun）', () => {
  it('停着的时候就是累计值', () => {
    expect(elapsedOf({ accumulatedMs: 12_000, runSince: null }, 999_999)).toBe(12_000)
  })

  it('跑着的时候是累计值 + 当前这一段', () => {
    expect(elapsedOf({ accumulatedMs: 5_000, runSince: 1_000 }, 4_000)).toBe(8_000)
  })

  /**
   * 时钟回拨（系统对时 / 手动改表）会让 `now - runSince` 变成负数：
   * 那时必须按 0 算，否则计时器会倒着走甚至显示负时长。
   */
  it('时钟回拨不倒扣：now < runSince 时这一段按 0 算', () => {
    expect(elapsedOf({ accumulatedMs: 5_000, runSince: 9_000 }, 1_000)).toBe(5_000)
  })

  it('累计值是非有限值或负数时当 0', () => {
    expect(elapsedOf({ accumulatedMs: Number.NaN, runSince: null }, 1)).toBe(0)
    expect(elapsedOf({ accumulatedMs: -100, runSince: 2_000 }, 1_500)).toBe(0)
  })

  it('startRun 只在停着的时候开新的一段，重复调用原样返回', () => {
    const idle = { accumulatedMs: 3_000, runSince: null }
    const running = startRun(idle, 10_000)
    expect(running).toEqual({ accumulatedMs: 3_000, runSince: 10_000 })
    // 已经在跑：再点一次"继续"不能把已数的时间抹掉
    expect(startRun(running, 20_000)).toBe(running)
  })

  it('pauseRun 把这一段折进累计值；重复暂停幂等（不能重复计）', () => {
    const running = { accumulatedMs: 3_000, runSince: 10_000 }
    const paused = pauseRun(running, 14_000)
    expect(paused).toEqual({ accumulatedMs: 7_000, runSince: null })
    expect(pauseRun(paused, 20_000)).toBe(paused)
  })

  it('暂停 / 继续来回两轮后，总时长等于各段之和（不重不漏）', () => {
    let s = startRun({ accumulatedMs: 0, runSince: null }, 0)
    s = pauseRun(s, 1_000)
    s = startRun(s, 5_000)
    s = pauseRun(s, 6_000)
    expect(elapsedOf(s, 99_999)).toBe(2_000)
  })
})

describe('deriveControls', () => {
  const base = { isDesktop: true, model: 'ready', session: 'idle' } as const

  function controls(over: Partial<Parameters<typeof deriveControls>[0]>): ControlState {
    return deriveControls({ ...base, ...over })
  }

  it('就绪 + 空闲：只有"开始"可用，没有提示条', () => {
    const c = controls({})
    expect(c).toMatchObject({ canStart: true, canPause: false, canResume: false, canStop: false, pulse: false })
    expect(c.modelLabel).toBe('语音模型就绪')
    expect(c.notice).toBeNull()
  })

  /**
   * 这是这张卡最关键的一条：模型没就绪时绝不能让"开始"看起来能点 ——
   * 否则用户点下去只会收到一个后端 reject，等于把后端的守卫拿来当交互反馈。
   */
  it('模型没就绪（missing / downloading / verifying / failed）一律不能开始', () => {
    for (const model of ['missing', 'downloading', 'verifying', 'failed'] as const) {
      const c = controls({ model })
      expect(c.canStart).toBe(false)
      expect(c.notice).not.toBeNull()
    }
  })

  it('missing：给下载按钮 + 警告提示', () => {
    const c = controls({ model: 'missing' })
    expect(c.canDownload).toBe(true)
    expect(c.modelLabel).toBe('语音模型未下载')
    expect(c.notice).toMatchObject({ tone: 'warn' })
  })

  it('downloading / verifying：不给下载按钮（正在跑），提示是信息级', () => {
    for (const [model, label] of [
      ['downloading', '模型下载中'],
      ['verifying', '模型校验中'],
    ] as const) {
      const c = controls({ model })
      expect(c.canDownload).toBe(false)
      expect(c.modelLabel).toBe(label)
      expect(c.notice).toMatchObject({ tone: 'info' })
    }
  })

  it('failed：给重试按钮，提示用后端那句话；后端没给话时兜一句', () => {
    const withErr = controls({ model: 'failed', modelError: '模型文件损坏' })
    expect(withErr.canDownload).toBe(true)
    expect(withErr.modelLabel).toBe('语音模型不可用')
    expect(withErr.notice).toEqual({ tone: 'error', text: '模型文件损坏' })

    const noErr = controls({ model: 'failed', modelError: null })
    expect(noErr.notice?.text).toContain('重试下载')
  })

  it('录制中：暂停 / 停止可用，开始与继续不可用，呼吸点显示', () => {
    const c = controls({ session: 'recording' })
    expect(c).toMatchObject({ canStart: false, canPause: true, canResume: false, canStop: true, pulse: true })
  })

  it('暂停中：继续 / 停止可用，呼吸点**不**显示（全项目只能有一个常驻动画，停着就别动）', () => {
    const c = controls({ session: 'paused' })
    expect(c).toMatchObject({ canStart: false, canPause: false, canResume: true, canStop: true, pulse: false })
  })

  it('会话在跑时按钮只看会话，不回头看模型状态（此刻模型早已过了那道门）', () => {
    // 模型状态在会话中途变成 failed（例如模型文件被移走）也不该禁掉"停止"
    const c = controls({ model: 'failed', session: 'recording' })
    expect(c.canStop).toBe(true)
    expect(c.canPause).toBe(true)
  })

  it('后端 reject 的那句话盖过模型提示：用户正看着错误，此时显示"下载中"是答非所问', () => {
    const c = controls({ startError: '语音模型还没下载完，先在设置里下载模型再开始速记' })
    expect(c.notice).toEqual({ tone: 'error', text: '语音模型还没下载完，先在设置里下载模型再开始速记' })
  })

  it('网页版：五个按钮全不可用，提示只有一句降级文案，且没有呼吸点', () => {
    const c = controls({ isDesktop: false, model: 'ready', session: 'recording', startError: '后端的话' })
    expect(c).toEqual({
      canStart: false,
      canPause: false,
      canResume: false,
      canStop: false,
      canDownload: false,
      modelLabel: '语音模型就绪',
      notice: { tone: 'info', text: DESKTOP_ONLY_HINT },
      pulse: false,
    })
  })
})

describe('describeResult', () => {
  const stop = (over: Partial<StopResult>): StopResult => ({
    id: 'm-1',
    transcriptPath: 'C:\\Users\\me\\Modulo\\minutes\\m-1.md',
    segmentCount: 42,
    durationMs: 723_000,
    ...over,
  })

  it('正常一场：句数 + 时长，路径原样带出（供界面显示与复制）', () => {
    const r = describeResult(stop({}))
    expect(r.text).toBe('42 句 · 12:03')
    expect(r.path).toBe('C:\\Users\\me\\Modulo\\minutes\\m-1.md')
    expect(r.empty).toBe(false)
  })

  it('一句都没断出来：明说，并提示最可能的原因（音源 / 设备选错），不当成"成功"', () => {
    const r = describeResult(stop({ segmentCount: 0, durationMs: 8_000 }))
    expect(r.empty).toBe(true)
    expect(r.text).toContain('00:08')
    expect(r.text).toContain('没识别到语音')
  })

  it('句数为负（不该出现，但后端字段不可信）同样按"没识别到"处理', () => {
    expect(describeResult(stop({ segmentCount: -1 })).empty).toBe(true)
  })

  it('时长非法时显示 00:00，不吐 NaN', () => {
    expect(describeResult(stop({ durationMs: Number.NaN })).text).toBe('42 句 · 00:00')
  })
})

describe('设备（listDevicesFor / pickDevice / deviceLabel）', () => {
  const devices: AudioDevice[] = [
    dev('mic-b', 'input'),
    dev('mic-a', 'input', true),
    dev('spk-a', 'output', true),
    dev('spk-b', 'output'),
  ]

  it('音源决定列哪一批：mic 列输入、system 列输出（枚举错方向就会挑到"扬声器当麦克风"）', () => {
    expect(listDevicesFor(devices, 'mic').map((d) => d.id)).toEqual(['mic-b', 'mic-a'])
    expect(listDevicesFor(devices, 'system').map((d) => d.id)).toEqual(['spk-a', 'spk-b'])
    expect(listDevicesFor([], 'mic')).toEqual([])
  })

  it('优先系统标了 isDefault 的那个，哪怕它不是列表第一个', () => {
    expect(pickDevice(devices, 'mic')?.id).toBe('mic-a')
    expect(pickDevice(devices, 'system')?.id).toBe('spk-a')
  })

  it('没有默认设备就取第一个；这一类一个都没有则返回 null（界面据此提示没读到设备）', () => {
    expect(pickDevice([dev('mic-b', 'input')], 'mic')?.id).toBe('mic-b')
    expect(pickDevice([dev('mic-b', 'input')], 'system')).toBeNull()
    expect(pickDevice([], 'mic')).toBeNull()
  })

  it('显示名：默认设备用文字后缀标出来（不靠颜色，状态双编码）', () => {
    expect(deviceLabel(dev('mic-a', 'input', true))).toBe('设备 mic-a（默认）')
    expect(deviceLabel(dev('mic-b', 'input'))).toBe('设备 mic-b')
  })
})
