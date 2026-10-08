import type { XWordApi } from '../shared/api'

declare global {
  interface Window {
    xword: XWordApi
  }
}
