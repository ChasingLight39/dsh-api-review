# @dsh-external/dsh-api-review

DSH 消息流安全审查插件：使用小模型并行审查 system / user / assistant / tool / toolResult / unmatched 六类可执行单元，发现可疑行为后通过检查点询问用户；用户拒绝则冻结整个 root 对话，必须输入精确恢复文本才能继续。

## 特性

- 覆盖六类可执行单元：`system`、`user`、`assistant`、`tool`、`toolResult`、`unmatched`
- 每个检测对象独立配置：
  - `review`：是否送小模型检测
  - `block`：是否同步阻塞 / 作为检查点
  - `includeContext`：是否加入 root 共享上下文
- 小模型与大模型并行：
  - `block=false`：异步审查，不拖慢大模型
  - `block=true`：同步审查，执行前等待
- 全局唯一 FIFO 审查队列，严格单消费者
- root session 共享 `contextBuffer` / `pendingBlocks` / `frozen`
- 并行子 agent 共享同一 root 状态；任一 deny 冻结整个 root
- 用户拒绝后必须输入精确恢复文本才能解冻
- JSONL 审计日志
- 小模型非法输出 / 超时 / 网络错误一律按 block 处理

> ⚠️ 安全边界
>
> 如果小模型 API 和大模型 API 走同一个不可信中转站，攻击者同样可以篡改小模型审查结果。
> 本插件是纵深防御 / 启发式拦截，不能替代可信通道、沙箱和权限系统。

## 安装到 DSH

本包是一个 DSH **bundle**，声明了 `dsh.bundle.patch`，可通过 `dsh plugin` 安装并自动加入 profile 的 bundle 层。

### 从 npm 安装

```bash
dsh plugin --profile web add @dsh-external/dsh-api-review
```

### 从本地 tarball 安装

```bash
npm pack
dsh plugin --profile web add ./dsh-external-dsh-api-review-0.0.1.tgz
```

### 从 GitHub 安装

```bash
dsh plugin --profile web add github:ChasingLight39/dsh-api-review
```

> 仓库已包含预构建的 `lib/`，GitHub 安装后无需额外构建。

### 从本地源码目录安装

```bash
dsh plugin --profile web add /path/to/dsh-api-review
```

安装后，在 profile 的插件配置中设置 `baseURL` / `model` 等参数，然后重启 DSH 或热重载。

## 配置

```yaml
plugins:
  '@dsh-external/dsh-api-review':
    baseURL: https://your-relay.example.com/v1
    model: deepseek-chat
    apiKey: sk-xxxx

    system:
      review: false
      block: false
      includeContext: false
    user:
      review: false
      block: false
      includeContext: false
    assistant:
      review: false
      block: false
      includeContext: false
    tool:
      review: true
      block: true
      includeContext: true
    toolResult:
      review: false
      block: false
      includeContext: false
    unmatched:
      review: false
      block: false
      includeContext: false

    maxContextTokens: 256000
    contextTrimThreshold: 0.8
    contextTrimTarget: 0.4
    maxQueueSize: 1000
    noUserAction: 'deny'
    timeoutMs: 8000
    recoveryText: '我已经更换了API源，我信任这个API，继续对话'
    auditLogDir: ''
```

每个检测对象三个独立开关：

- `review`：是否送小模型检测
- `block`：是否同步阻塞 / 作为检查点
- `includeContext`：是否加入 root 共享上下文

### review / block 四象限

| review | block | 行为 |
|---|---|---|
| false | false | 完全跳过 |
| true | false | 异步审查，不拖慢大模型；可疑产生 pendingBlock |
| false | true | 检查点：不审本条，但结算已有 pendingBlock |
| true | true | 先结算已有 pendingBlock，再同步审查本条 |

## 工作原理

- 所有 agent（包括并行子 agent）共享 root 级 `contextBuffer` / `pendingBlocks` / `frozen`。
- 审查请求进入全局唯一 FIFO 队列，严格单消费者。
- `block=false` 允许先执行，事后追认。
- 检查点出现在 `block=true` 单元、turn 结束、恢复前。
- 用户选择“存在拒绝”后整个 root 冻结。
- 只有输入精确恢复文本才解冻，恢复文本不会发给大模型。
- 小模型非法输出 / 超时 / 网络错误一律按 block 处理。
- 审计日志写入 `~/.dsh/logs/api-review-YYYY-MM-DD.jsonl`（可用 `auditLogDir` 覆盖）。

## 开发

### 构建

```bash
DSH_CHECKOUT=/path/to/deepseek-harness bash scripts/build.sh
```

### 测试

```bash
npm test
```

### 开发环境注入

注入器环境内：

```
dev_inject_plugin D:/Prog/Project/dsh-api-review
```

## 已知限制

- assistant 文本可能已经显示给用户，`block` 只能阻止后续步骤，不能撤回已显示内容。
- toolResult 已经执行完，`block` 可以阻止结果进入大模型，但不能阻止工具本身执行。
- 同一个不可信中转站可以伪造小模型的 `safe` 响应。
- 全局单队列在异步任务积压时可能放大 `block=true` 的等待延迟。

## License

MIT
