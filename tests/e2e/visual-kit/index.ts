/** visual-kit 统一出口（跨项目共享内核 + Modulo puppeteer 适配层）。 */
export { CONTRAST_INJECT, ABS_FLOOR, TOLERANCE } from './contrast'
export type { PairResult } from './measure'
export { applySkin, injectKernel, readPairs, readTokens, checkOverflow, dumpReport } from './measure'
