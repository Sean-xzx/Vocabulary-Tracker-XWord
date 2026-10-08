/**
 * 启动时间点（performance.now()，毫秒），端到端测试用来核对“开屏不拖慢加载”：
 * dataReady 数据就绪；interactive 开屏结束、主界面可以操作。
 */
export interface StartupMarks {
  dataReady?: number
  /** 开屏三笔画完（最终帧） */
  splashFinal?: number
  interactive?: number
}

declare global {
  interface Window {
    __xwordStartup?: StartupMarks
    /** 测试开关：开屏停在最终帧不自动结束（只在开发 / 测试环境有效，打包后无效） */
    __xwordSplashHold?: boolean
    /** 测试开关：拨动时钟（只在开发 / 测试环境挂上，打包后不存在） */
    __xwordDev?: {
      setNow: (iso: string | null) => Promise<void>
      /** 按界面上的流程导入一个本地文件（代替文件选择框和拖放） */
      importPath?: (path: string) => Promise<unknown>
    }
  }
}

export function markStartup(name: keyof StartupMarks): void {
  const marks = (window.__xwordStartup ??= {})
  marks[name] ??= performance.now()
}
