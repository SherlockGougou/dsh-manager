/// <reference types="vite/client" />

import type { DshmApi } from '../../preload/index'

declare global {
  interface Window {
    dshm: DshmApi
  }
}

export {}
