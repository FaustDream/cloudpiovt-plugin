import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 测试环境：Node（默认），DOM 测试用 jsdom
    environment: "node",
    // 包含测试文件
    include: ["tests/**/*.test.{js,mjs}"],
    // 覆盖率配置
    coverage: {
      provider: "v8",
      include: [
        "lib/preflight-diagnostics.js",
        "lib/h3yun-code.js"
      ],
      // 需要 95% 以上覆盖率
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95
      },
      reporter: ["text", "lcov"]
    }
  }
});
