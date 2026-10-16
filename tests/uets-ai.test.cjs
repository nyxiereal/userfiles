const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(`${__dirname}/../uets.user.js`, 'utf8');
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
};
const constants = section('  const GEMINI_API_KEY_STORAGE', '  const PROFILES =');
const keyManagement = section('  const API_KEY_FIELDS', '  // === SHARED IMAGE FETCHING ===');
const requests = section('  const buildGeminiPrompt', '  const providerHasCredentials');
const startup = section('    const savedConfig =', '    createToggleButton();');

function load(saved = null) {
  const sent = [];
  let saves = 0;
  const context = vm.createContext({
    window: { location: { href: 'https://wayground.com/' } },
    GM_getValue: (key, fallback) => key === 'UETS_CONFIG' ? saved : fallback,
    GM_log() {},
    GM_setValue() {},
    saveConfig() { saves++; },
    GM_xmlhttpRequest(request) {
      sent.push({ ...request, payload: JSON.parse(request.data) });
      request.onload({
        status: 200,
        responseText: JSON.stringify({
          choices: [{ message: { content: 'Answer' } }],
          candidates: [{ content: { parts: [{ text: 'Answer' }] } }],
        }),
      });
    },
  });
  vm.runInContext(`${constants}
    const sharedState = { config: { ...DEFAULT_CONFIG } };
    ${keyManagement}
    ${requests}
    globalThis.ai = {
      DEFAULT_CONFIG, MODEL_PRICING, GEMINI_MODEL_MIGRATIONS,
      OPENROUTER_MODEL_MIGRATIONS, OPENCODE_GO_MODEL_MIGRATIONS,
      OPENROUTER_REASONING_EFFORTS, OPENROUTER_NO_SAMPLING_MODELS,
      OPENCODE_GO_ANTHROPIC_MODELS, OPENCODE_GO_RESPONSES_MODELS,
      OPENCODE_GO_TEXT_ONLY_MODELS, OPENCODE_GO_NO_SAMPLING_MODELS,
      askGemini, askOpenRouter, askOpenCodeGo, askDeepSeek, providerSupportsImages,
      sharedState,
    };`, context);
  return {
    ai: context.ai, sent,
    migrate() {
      vm.runInContext(`(() => { ${startup} })()`, context);
      return { config: context.ai.sharedState.config, saves };
    },
  };
}

test('defaults and every legacy model migrate directly to a current priced model', () => {
  const { ai } = load();
  for (const [provider, key, migrations] of [
    ['gemini', 'geminiModel', ai.GEMINI_MODEL_MIGRATIONS],
    ['openrouter', 'openrouterModel', ai.OPENROUTER_MODEL_MIGRATIONS],
    ['opencode-go', 'opencodeGoModel', ai.OPENCODE_GO_MODEL_MIGRATIONS],
  ]) {
    assert.ok(ai.MODEL_PRICING[provider][ai.DEFAULT_CONFIG[key]]);
    for (const [old, current] of Object.entries(migrations)) {
      assert.ok(ai.MODEL_PRICING[provider][current], `${provider}: ${old} -> ${current}`);
      assert.equal(migrations[current], undefined, 'No multi-startup migration chains');
      const { config, saves } = load({ [key]: old, aiProvider: provider, custom: 'keep' }).migrate();
      assert.equal(config[key], current);
      assert.equal(config.aiProvider, provider);
      assert.equal(config.custom, 'keep');
      assert.equal(saves, 1);
    }
  }
  assert.equal(ai.OPENROUTER_MODEL_MIGRATIONS['google/gemini-3.5-flash-lite'], 'anthropic/claude-haiku-5.5');
  assert.equal(ai.DEFAULT_CONFIG.aiProvider, 'deepseek');
  assert.equal(ai.DEFAULT_CONFIG.autoAIWhenUnknown, false);
  assert.equal(load().migrate().saves, 0);
});

test('legacy Gemini thinking budgets become supported effort levels', () => {
  for (const [budget, level] of [[512, 'low'], [1024, 'low'], [2048, 'medium'], [4096, 'medium'], [8192, 'high']]) {
    assert.equal(load({ geminiThinkingBudget: budget }).migrate().config.geminiThinkingLevel, level);
  }
  assert.equal(load({ geminiThinkingBudget: 512, geminiThinkingLevel: 'high' }).migrate().config.geminiThinkingLevel, 'high');
});

const image = { mimeType: 'image/png', base64Data: 'aW1hZ2U=' };

test('native Gemini requests use current models and thinkingLevel, not token budgets', async () => {
  const { ai, sent } = load();
  Object.assign(ai.sharedState.config, { geminiApiKey: 'test-key', geminiThinkingLevel: 'high' });
  for (const model of Object.keys(ai.MODEL_PRICING.gemini)) {
    ai.sharedState.config.geminiModel = model;
    assert.equal((await ai.askGemini('Question', [], image)).ok, true);
    const { url, payload } = sent.at(-1);
    assert.ok(url.includes(`/models/${model}:generateContent?`));
    assert.equal(payload.generationConfig.thinkingConfig.thinkingLevel, 'high');
    assert.equal(payload.generationConfig.thinkingConfig.thinkingBudget, undefined);
    assert.equal(payload.contents[0].parts[1].inline_data.data, image.base64Data);
  }
});

test('OpenRouter requests normalize effort and omit unsupported sampling parameters', async () => {
  const { ai, sent } = load();
  ai.sharedState.config.openrouterApiKey = 'test-key';
  for (const model of Object.keys(ai.MODEL_PRICING.openrouter)) {
    for (const effort of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      Object.assign(ai.sharedState.config, { openrouterModel: model, openrouterReasoningEffort: effort });
      assert.equal((await ai.askOpenRouter('Question', [], image)).ok, true);
      const { url, payload } = sent.at(-1);
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(payload.model, model);
      const efforts = ai.OPENROUTER_REASONING_EFFORTS[model];
      if (efforts) assert.ok(efforts.includes(payload.reasoning.effort));
      else assert.equal(payload.reasoning.max_tokens, ai.DEFAULT_CONFIG.openrouterReasoningMaxTokens);
      assert.equal('temperature' in payload, !ai.OPENROUTER_NO_SAMPLING_MODELS.has(model));
      assert.equal('top_p' in payload, !ai.OPENROUTER_NO_SAMPLING_MODELS.has(model));
      assert.equal(payload.messages[0].content[1].type, 'image_url');
    }
  }
});

test('OpenCode Go routes each model through its protocol with correct image and sampling support', async () => {
  const { ai, sent } = load();
  ai.sharedState.config.opencodeGoApiKey = 'test-key';
  for (const model of Object.keys(ai.MODEL_PRICING['opencode-go'])) {
    ai.sharedState.config.opencodeGoModel = model;
    assert.equal((await ai.askOpenCodeGo('Question', [], image)).ok, true);
    const { url, headers, payload } = sent.at(-1);
    assert.equal(payload.model, model);
    let content;
    if (ai.OPENCODE_GO_ANTHROPIC_MODELS.has(model)) {
      assert.equal(url, 'https://opencode.ai/inference/go/anthropic/v1/messages');
      assert.equal(headers['x-api-key'], 'test-key');
      content = payload.messages[0].content;
    } else if (ai.OPENCODE_GO_RESPONSES_MODELS.has(model)) {
      assert.equal(url, 'https://opencode.ai/inference/go/openai/v1/responses');
      assert.equal(headers.Authorization, 'Bearer test-key');
      content = payload.input[0].content;
    } else {
      assert.equal(url, 'https://opencode.ai/inference/go/openai/v1/chat/completions');
      assert.equal(headers.Authorization, 'Bearer test-key');
      content = payload.messages[0].content;
    }
    assert.equal(content.length, ai.OPENCODE_GO_TEXT_ONLY_MODELS.has(model) ? 1 : 2);
    assert.equal(ai.providerSupportsImages('opencode-go'), !ai.OPENCODE_GO_TEXT_ONLY_MODELS.has(model));
    assert.equal('temperature' in payload, !ai.OPENCODE_GO_NO_SAMPLING_MODELS.has(model));
    if (ai.OPENCODE_GO_NO_SAMPLING_MODELS.has(model)) assert.equal('top_p' in payload, false);
  }
  ai.sharedState.config.includeImages = false;
  ai.sharedState.config.opencodeGoModel = 'deepseek-v4.1-flash';
  await ai.askOpenCodeGo('Question', [], image);
  assert.equal(sent.at(-1).payload.messages[0].content.length, 1);
});

test('free hosted DeepSeek stays on its pinned text-only model', async () => {
  const { ai, sent } = load();
  assert.equal((await ai.askDeepSeek('Question', [], image)).ok, true);
  assert.equal(sent[0].payload.model, 'deepseek-ai/DeepSeek-V4-Flash-0731');
  assert.equal(typeof sent[0].payload.messages[0].content, 'string');
  assert.equal(ai.providerSupportsImages('deepseek'), false);
});
