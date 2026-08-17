# @dsh-external/dsh-api-review

A DSH message-flow security review plugin. It uses a small model to review six kinds of executable units — `system`, `user`, `assistant`, `tool`, `toolResult`, and `unmatched` — in parallel with the main model. When suspicious behavior is detected, the plugin pauses at a checkpoint and asks the user. If the user rejects, the whole root conversation freezes and only an exact recovery phrase can resume it.

## Features

- Covers six unit categories: `system`, `user`, `assistant`, `tool`, `toolResult`, `unmatched`
- Each category has independent settings:
  - `review`: whether to send the unit to the small model
  - `block`: whether to synchronously block / act as a checkpoint
  - `includeContext`: whether to add the unit to the root-shared context
- Runs in parallel with the large model:
  - `block=false`: asynchronous review, does not slow down the large model
  - `block=true`: synchronous review, waits before execution
- Global single-consumer FIFO review queue
- Root sessions share `contextBuffer` / `pendingBlocks` / `frozen`
- Parallel subagents share the same root state; any `deny` freezes the whole root
- After a freeze, only the exact recovery phrase can resume
- JSONL audit logging
- Invalid output / timeout / network errors from the small model are always treated as block

> ⚠️ Security boundary
>
> If the small-model API and the large-model API go through the same untrusted relay, an attacker can tamper with the small-model review result too. This plugin is defense-in-depth / heuristic interception, not a replacement for trusted channels, sandboxing, or permission systems.

## Installing into DSH

This package is a DSH **bundle**; it declares `dsh.bundle.patch`, so `dsh plugin` can install it and automatically add it to the profile bundle layer.

### From npm

```bash
dsh plugin --profile web add @dsh-external/dsh-api-review
```

### From a local tarball

```bash
npm pack
dsh plugin --profile web add ./dsh-external-dsh-api-review-0.0.1.tgz
```

### From GitHub

```bash
dsh plugin --profile web add github:ChasingLight39/dsh-api-review
```

> The repository includes prebuilt `lib/`, so no extra build step is needed for GitHub installs.

### From a local source directory

```bash
dsh plugin --profile web add /path/to/dsh-api-review
```

After installation, configure `baseURL` / `model` and other options in the profile plugin config, then restart DSH or hot-reload.

## Configuration

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

Each category has three independent switches:

- `review`: whether to send the unit to the small model
- `block`: whether to synchronously block / act as a checkpoint
- `includeContext`: whether to add the unit to the root-shared context

### review / block matrix

| review | block | Behavior |
|---|---|---|
| false | false | Skip entirely |
| true | false | Asynchronous review; suspicious results create a pendingBlock |
| false | true | Checkpoint: do not review this unit, but settle existing pendingBlocks |
| true | true | Settle existing pendingBlocks first, then synchronously review this unit |

## How it works

- All agents (including parallel subagents) share root-level `contextBuffer` / `pendingBlocks` / `frozen`.
- Review requests enter one global FIFO queue with a single consumer.
- `block=false` allows execution first, with after-the-fact review.
- Checkpoints occur at `block=true` units, turn end, and before resume.
- If the user chooses "reject", the whole root freezes.
- Only the exact recovery phrase can unfreeze; the recovery phrase itself is not sent to the large model.
- Invalid output / timeout / network errors from the small model are always treated as block.
- Audit logs are written to `~/.dsh/logs/api-review-YYYY-MM-DD.jsonl` (overridable via `auditLogDir`).

## Development

### Build

```bash
DSH_CHECKOUT=/path/to/deepseek-harness bash scripts/build.sh
```

### Test

```bash
npm test
```

### Dev injection

Inside the injector environment:

```
dev_inject_plugin D:/Prog/Project/dsh-api-review
```

## Known limitations

- Assistant text may already be visible to the user; `block` can only stop later steps, not retract displayed content.
- A tool result has already executed; `block` can prevent the result from reaching the large model, but cannot prevent the tool itself from running.
- The same untrusted relay can forge a `safe` response from the small model.
- The global single queue can amplify `block=true` latency when asynchronous tasks accumulate.

## License

MIT
