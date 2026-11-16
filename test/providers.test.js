const test = require('node:test'); const assert = require('node:assert');
const LLM = require('../js/llm.js'); const SC = require('../js/scoring.js'); const S = require('../js/seed.js');
const msg = { system: 'sys', messages: [{ role: 'user', content: 'hi' }], json: true };
const NOW = Date.UTC(2026, 10, 16);
test('Anthropic requests carry the direct-browser-access header and the key only in x-api-key', () => {
  const r = LLM.buildRequest({ provider: 'anthropic', key: 'sk-ant-fake', model: 'claude-haiku-4-5' }, msg);
  assert.strictEqual(r.init.headers['anthropic-dangerous-direct-browser-access'], 'true'); assert.strictEqual(r.init.headers['x-api-key'], 'sk-ant-fake'); assert.ok(!r.init.body.includes('sk-ant-fake'));
});
test('Gemini puts the key in x-goog-api-key, not the URL', () => { const r = LLM.buildRequest({ provider: 'gemini', key: 'AIzaFAKE', model: 'gemini-2.5-flash' }, msg); assert.ok(!r.url.includes('AIzaFAKE')); assert.strictEqual(r.init.headers['x-goog-api-key'], 'AIzaFAKE'); });
test('OpenAI-compatible uses the base URL and OpenRouter headers', () => { const r = LLM.buildRequest({ provider: 'compatible', key: 'k', baseUrl: 'https://openrouter.ai/api/v1/', model: 'openai/gpt-5-mini' }, msg); assert.strictEqual(r.url, 'https://openrouter.ai/api/v1/chat/completions'); assert.match(r.init.headers['HTTP-Referer'], /hirescout-ai/); assert.strictEqual(r.init.headers['X-Title'], 'HireScout AI'); });
test('Ollama needs no key', () => { const r = LLM.buildRequest({ provider: 'compatible', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' }, msg); assert.ok(!r.init.headers.authorization); });
for (const [provider, status, body] of [['openai', 401, { error: { message: 'Incorrect API key provided' } }], ['anthropic', 401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }], ['gemini', 400, { error: { message: 'API key not valid. Please pass a valid API key.' } }], ['compatible', 401, { error: { message: 'No auth credentials found' } }]]) {
  test(provider + ' bad key gives a readable error', async () => {
    const fetch = async () => ({ ok: false, status, text: async () => JSON.stringify(body) });
    await assert.rejects(LLM.call({ provider, key: 'bad-key-123', model: LLM.PROVIDERS[provider].defaultModel, baseUrl: provider === 'compatible' ? 'https://openrouter.ai/api/v1' : '' }, msg, { fetch }), /key was rejected/);
  });
}
test('a CORS-less OpenAI failure explains itself', async () => { await assert.rejects(LLM.call({ provider: 'openai', key: 'bad' }, msg, { fetch: async () => { throw new TypeError('Failed to fetch'); } }), /CORS header/); });
test('end to end with each mocked provider: the scorecard reply is parsed and checked', async () => {
  const job = S.JOBS[0]; const cand = Object.assign({}, S.CANDIDATES.find((c) => c.id === 'c-ana'), { now: NOW });
  const p = SC.scorePrompt(job, cand);
  const answer = JSON.stringify({ criteria: [{ id: 'must', score: 5, evidence: ['Led the rebuild of the course editor in React and TypeScript'], rationale: 'React and TypeScript lead work.' }, { id: 'years', score: 5, evidence: ['Frontend Engineer, Kiteworks, Jun 2017 - Feb 2021'], rationale: 'Over 9 years.' }, { id: 'nice', score: 4, evidence: ['I invented this quote'], rationale: 'x' }], summary: 'Strong frontend lead.' });
  for (const provider of ['openai', 'anthropic', 'gemini', 'compatible']) {
    const reply = provider === 'anthropic' ? { content: [{ type: 'text', text: answer }], usage: { input_tokens: 900, output_tokens: 40 } } : provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: answer }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40 } } : { choices: [{ message: { content: answer } }], usage: { prompt_tokens: 900, completion_tokens: 40 } };
    let sent = null; const fetch = async (url, init) => { sent = init; return { ok: true, status: 200, text: async () => JSON.stringify(reply) }; };
    const r = await LLM.call({ provider, key: 'test-key-not-real', model: LLM.PROVIDERS[provider].defaultModel, baseUrl: provider === 'compatible' ? 'http://localhost:11434/v1' : '' }, p, { fetch });
    const sc = SC.parseScore(job, cand, r.text, p);
    assert.strictEqual(sc.results.find((x) => x.id === 'must').score, 5, provider); assert.strictEqual(sc.results.find((x) => x.id === 'nice').score, null); assert.match(sc.results.find((x) => x.id === 'nice').withheld, /verbatim/);
    assert.ok(!sent.body.includes('test-key-not-real')); assert.ok(!sent.body.includes('ana.reyes@mail.example'), 'blinded'); assert.ok(!/Ana Reyes/.test(sent.body)); assert.ok(r.usage.input === 900);
  }
});
