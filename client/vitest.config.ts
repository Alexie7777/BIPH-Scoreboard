import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 测试里也会写 JSX(比如渲染提示组件),所以这里要挂上 React 插件
  plugins: [react()],
  test: {
    // 蜂鸣器是纯数学合成,不碰 DOM,node 环境即可
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
