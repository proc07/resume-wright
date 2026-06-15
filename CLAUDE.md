# ResumeWright 项目开发规范

## 运行规则

### Dashboard 命令
运行 dashboard 命令时，**必须在 demo 目录下执行**，不要在项目根目录下运行。

```bash
# 正确方式
cd demo && pnpm run dashboard

# 错误方式（不要这样做）
npm run dashboard
```

## 项目结构

- `src/` - 核心源代码
- `demo/` - 演示案例和服务器
- `tests/` - 单元测试和集成测试
