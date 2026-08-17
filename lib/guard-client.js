/**
 * Small-model guard API client.
 *
 * The guard model is deliberately given no tools and no code execution ability.
 * It only returns a JSON classification. Anything other than an explicit `safe`
 * verdict is treated as a block/unknown/error by the caller.
 */
const GUARD_SYSTEM_PROMPT = `You are a security reviewer for an AI agent harness.
You only inspect a proposed agent action and classify whether it can steal or exfiltrate private information.
You have NO tools and NO code execution ability.
Reply with JSON only, exactly one object:
{"verdict":"safe"|"block","reason":"short reason"}
Do not output anything except this JSON object.`;
function estimateTokens(text) {
    // Rough heuristic: ~4 chars per token for mixed Chinese/English text.
    return Math.ceil(text.length / 4);
}
function truncate(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars)}… (+${text.length - maxChars} more chars)`;
}
function errorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
function parseVerdictObject(data) {
    if (data.verdict === 'safe') {
        return { verdict: 'safe', reason: typeof data.reason === 'string' ? data.reason : '' };
    }
    if (data.verdict === 'block' || data.verdict === 'suspicious' || data.verdict === 'stop') {
        return {
            verdict: 'block',
            reason: typeof data.reason === 'string' ? data.reason : 'suspicious action',
        };
    }
    return { verdict: 'unknown', reason: `guard returned unknown verdict: ${JSON.stringify(data.verdict)}` };
}
function parseReview(text) {
    const trimmed = text.trim();
    // Try the whole response first (strict JSON-only output).
    try {
        return parseVerdictObject(JSON.parse(trimmed));
    }
    catch {
        // Fall through to substring extraction.
    }
    // Try the first balanced-looking JSON object. Non-greedy first, greedy as a
    // last resort for models that wrap the object in prose.
    const candidates = [
        /\{[\s\S]*?\}/.exec(trimmed)?.[0],
        /\{[\s\S]*\}/.exec(trimmed)?.[0],
    ].filter((candidate) => candidate !== undefined);
    for (const candidate of candidates) {
        try {
            return parseVerdictObject(JSON.parse(candidate));
        }
        catch {
            // Try the next candidate.
        }
    }
    return { verdict: 'unknown', reason: `guard returned unparseable output: ${text.slice(0, 200)}` };
}
export class GuardClient {
    config;
    constructor(config) {
        this.config = config;
    }
    async review(unit, contextSnapshot, systemSnapshot, signal) {
        const contextText = contextSnapshot
            .map(item => `[${item.category}] ${item.content}`)
            .join('\n\n');
        const systemText = systemSnapshot?.content ?? '';
        const currentText = unit.content;
        // Keep the total request near the configured context budget: split the
        // character budget across system, history, and current unit.
        const maxChars = Math.max(1, Math.floor((this.config.maxContextTokens * 4) / 3));
        const userContent = [
            'Review the following assistant/agent action before it is allowed to proceed.',
            '',
            systemText.trim() === '' ? '' : `Current agent system prompt:\n"""\n${truncate(systemText, maxChars)}\n"""`,
            '',
            contextText.trim() === '' ? '' : `Known history:\n"""\n${truncate(contextText, maxChars)}\n"""`,
            '',
            `Current unit to review (category: ${unit.category}):`,
            '"""',
            truncate(currentText, maxChars),
            '"""',
            '',
            'Return the JSON verdict now.',
        ].filter(Boolean).join('\n');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
        const onExternalAbort = () => controller.abort();
        if (signal?.aborted)
            controller.abort();
        else
            signal?.addEventListener('abort', onExternalAbort, { once: true });
        try {
            const response = await fetch(`${this.config.baseURL.replace(/\/$/, '')}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey.trim() === '' ? {} : { Authorization: `Bearer ${this.config.apiKey.trim()}` }),
                },
                body: JSON.stringify({
                    model: this.config.model,
                    messages: [
                        { role: 'system', content: GUARD_SYSTEM_PROMPT },
                        { role: 'user', content: userContent },
                    ],
                    temperature: 0,
                    max_tokens: 300,
                    stream: false,
                }),
                signal: controller.signal,
            });
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                return {
                    verdict: 'error',
                    reason: `guard API HTTP ${response.status}: ${body.slice(0, 200)}`,
                };
            }
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;
            if (typeof content !== 'string') {
                return { verdict: 'error', reason: 'guard API returned no message content' };
            }
            return parseReview(content);
        }
        catch (error) {
            return {
                verdict: 'error',
                reason: `guard API failed: ${errorMessage(error)}`,
            };
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onExternalAbort);
        }
    }
}
export { estimateTokens };
//# sourceMappingURL=guard-client.js.map