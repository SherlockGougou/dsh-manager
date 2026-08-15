import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite 三段式构建：main / preload / renderer
// 核心层 src/core 由 main 进程直接 import（externalizeDepsPlugin 会把
// js-yaml 等运行时依赖外置，dev 与打包后都从 node_modules 解析）。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
})
