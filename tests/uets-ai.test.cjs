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
const configManagement = section('  const resetConfig =', '  const createConfigGui =');
const requests = section('  const buildGeminiPrompt', '  // === PARSE AI RESPONSE FOR ANSWER HIGHLIGHTING ===');
const startup = section('    const savedConfig =', '    createToggleButton();');

function load(saved = null, { geminiKey = '', promptResult = '', statuses = [] } = {}) {
  const sent = [];
  const popups = [];
  const handled = [];
  const prompts = [];
  const alerts = [];
  let saves = 0;
  let stored = saved ? { ...saved } : null;
  const context = vm.createContext({
    window: { location: { href: 'https://wayground.com/' } },
    GM_getValue: (key, fallback) => key === 'UETS_CONFIG' ? stored : key === 'UETS_GEMINI_API_KEY' ? geminiKey : fallback,
    GM_log() {},
    GM_setValue() {},
    prompt(message) { prompts.push(message); return promptResult; },
    alert(message) { alerts.push(message); },
    showResponsePopup(...args) { popups.push(args); },
    handleAIResponse(...args) { handled.push(args); },
    saveConfig() {
      saves++;
      stored = { ...context.ai.sharedState.config };
    },
    GM_xmlhttpRequest(request) {
      sent.push({ ...request, payload: JSON.parse(request.data) });
      request.onload({
        status: statuses.length ? statuses.shift() : 200,
        responseText: JSON.stringify({
          choices: [{ message: { content: 'Answer' } }],
          candidates: [{ content: { parts: [{ text: 'Answer' }] } }],
        }),
      });
    },
  });
  vm.runInContext(`${constants}
    const sharedState = { config: { ...DEFAULT_CONFIG }, aiRequestId: 0 };
    ${keyManagement}
    ${configManagement}
    ${requests}
    globalThis.ai = {
      DEFAULT_CONFIG, MODEL_PRICING, GEMINI_MODEL_MIGRATIONS,
      OPENROUTER_MODEL_MIGRATIONS, OPENCODE_GO_MODEL_MIGRATIONS,
      OPENROUTER_REASONING_EFFORTS, OPENROUTER_NO_SAMPLING_MODELS,
      OPENROUTER_TEXT_ONLY_MODELS, OPENCODE_GO_ANTHROPIC_MODELS,
      OPENCODE_GO_RESPONSES_MODELS, OPENCODE_GO_TEXT_ONLY_MODELS,
      OPENCODE_GO_NO_SAMPLING_MODELS, FALLBACK_PROVIDER_ORDER,
      askGemini, askOpenRouter, askOpenCodeGo, askProvider, resetConfig,
      askAIWithFallback, askAIForQuestion, providerSupportsImages, sharedState,
    };`, context);
  return {
    ai: context.ai, sent, popups, handled, prompts, alerts,
    migrate() {
      vm.runInContext(`(() => { ${startup} })()`, context);
      return { config: context.ai.sharedState.config, saves };
    },
  };
}

const image = { mimeType: 'image/png', base64Data: 'aW1hZ2U=' };

test('defaults migrate once to Luna and preserve unrelated config and keys', () => {
  const fresh = load();
  const first = fresh.migrate();
  assert.equal(fresh.ai.DEFAULT_CONFIG.aiProvider, 'openrouter');
  assert.equal(first.config.aiProvider, 'openrouter');
  assert.equal(first.config.openrouterModel, 'openai/gpt-6-luna');
  assert.equal(first.config.opencodeGoModel, 'gpt-6-luna');
  assert.equal(first.config.aiDefaultsMigration, 1);
  assert.equal(first.saves, 1);

  const goSelection = load({
    aiProvider: 'opencode-go', openrouterModel: 'qwen/qwen3.8-flash',
    opencodeGoModel: 'deepseek-v4.1-flash', opencodeGoApiKey: 'go-key',
    openrouterApiKey: 'router-key', custom: 'keep', deepseekMaxTokens: 4096,
  });
  const migrated = goSelection.migrate();
  assert.equal(migrated.config.aiProvider, 'opencode-go');
  assert.equal(migrated.config.openrouterModel, 'openai/gpt-6-luna');
  assert.equal(migrated.config.opencodeGoModel, 'gpt-6-luna');
  assert.equal(migrated.config.opencodeGoApiKey, 'go-key');
  assert.equal(migrated.config.openrouterApiKey, 'router-key');
  assert.equal(migrated.config.custom, 'keep');
  assert.equal('deepseekMaxTokens' in migrated.config, false);
  assert.equal(migrated.saves, 1);

  const goKeyOnly = load({ aiProvider: 'gemini', opencodeGoApiKey: 'go-key' }).migrate();
  assert.equal(goKeyOnly.config.aiProvider, 'opencode-go');
  const routerPreferred = load({
    aiProvider: 'openrouter', opencodeGoApiKey: 'go-key', openrouterApiKey: 'router-key',
  }).migrate();
  assert.equal(routerPreferred.config.aiProvider, 'openrouter');

  const later = load({
    ...migrated.config, aiProvider: 'gemini',
    openrouterModel: 'z-ai/glm-5.3-flash', opencodeGoModel: 'kimi-k3',
  });
  const subsequent = later.migrate();
  assert.equal(subsequent.config.aiProvider, 'gemini');
  assert.equal(subsequent.config.openrouterModel, 'z-ai/glm-5.3-flash');
  assert.equal(subsequent.config.opencodeGoModel, 'kimi-k3');
  assert.equal(subsequent.saves, 0);
  assert.equal(later.ai.DEFAULT_CONFIG.autoAIWhenUnknown, false);

  later.ai.sharedState.config.openrouterModel = 'z-ai/glm-5.3-flash';
  later.ai.resetConfig();
  assert.equal(later.ai.sharedState.config.aiDefaultsMigration, 1);
  assert.equal(later.ai.sharedState.config.openrouterModel, 'openai/gpt-6-luna');
});

test('legacy model aliases migrate directly to priced models', () => {
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
      const { config, saves } = load({
        [key]: old, aiProvider: provider, aiDefaultsMigration: 1, custom: 'keep',
      }).migrate();
      assert.equal(config[key], current);
      assert.equal(config.aiProvider, provider);
      assert.equal(config.custom, 'keep');
      assert.equal(saves, 1);
    }
  }
  assert.equal(ai.OPENROUTER_MODEL_MIGRATIONS['google/gemini-3.5-flash-lite'], 'anthropic/claude-haiku-5.5');
});

test('legacy Gemini thinking budgets become supported effort levels', () => {
  for (const [budget, level] of [[512, 'low'], [1024, 'low'], [2048, 'medium'], [4096, 'medium'], [8192, 'high']]) {
    assert.equal(load({ geminiThinkingBudget: budget }).migrate().config.geminiThinkingLevel, level);
  }
  assert.equal(load({ geminiThinkingBudget: 512, geminiThinkingLevel: 'high' }).migrate().config.geminiThinkingLevel, 'high');
});

test('native Gemini requests use current models and thinkingLevel, not token budgets', async () => {
  const { ai, sent } = load();
  Object.assign(ai.sharedState.config, { geminiApiKey: 'test-key', geminiThinkingLevel: 'high' });
  for (const model of Object.keys(ai.MODEL_PRICING.gemini)) {
    assert.ok(source.includes(`value: '${model}'`), `${model} is available in the Gemini picker`);
    ai.sharedState.config.geminiModel = model;
    assert.equal((await ai.askGemini('Question', [], image)).ok, true);
    const { url, payload } = sent.at(-1);
    assert.ok(url.includes(`/models/${model}:generateContent?`));
    assert.equal(payload.generationConfig.thinkingConfig.thinkingLevel, 'high');
    assert.equal(payload.generationConfig.thinkingConfig.thinkingBudget, undefined);
    assert.equal(payload.contents[0].parts[1].inline_data.data, image.base64Data);
  }
});

test('OpenRouter catalog entries have verified pricing, reasoning, sampling, and image handling', async () => {
  const { ai, sent } = load();
  ai.sharedState.config.openrouterApiKey = 'test-key';
  for (const model of Object.keys(ai.MODEL_PRICING.openrouter)) {
    assert.ok(source.includes(`value: '${model}'`), `${model} is available in the OpenRouter picker`);
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
      const textOnly = ai.OPENROUTER_TEXT_ONLY_MODELS.has(model);
      assert.equal(payload.messages[0].content.length, textOnly ? 1 : 2);
      assert.equal(ai.providerSupportsImages('openrouter'), !textOnly);
      if (textOnly) assert.equal(payload.messages[0].content[0].text.includes('image is associated'), false);
    }
  }
  assert.equal(ai.MODEL_PRICING.openrouter['deepseek/deepseek-v4-flash'].input, 0.091);
  assert.equal(ai.MODEL_PRICING.openrouter['deepseek/deepseek-v4-flash'].output, 0.182);
  assert.equal(ai.MODEL_PRICING.openrouter['z-ai/glm-5.3-flash'].input, 0.15);
  assert.equal(ai.MODEL_PRICING.openrouter['z-ai/glm-5.3-flash'].output, 0.5);
  assert.equal(ai.MODEL_PRICING.openrouter['anthropic/claude-sonnet-5'].input, 2);
  assert.equal(ai.MODEL_PRICING.openrouter['anthropic/claude-sonnet-5'].output, 10);
});

test('OpenCode Go routes each model through its protocol with correct image and sampling support', async () => {
  const { ai, sent } = load();
  ai.sharedState.config.opencodeGoApiKey = 'test-key';
  for (const model of Object.keys(ai.MODEL_PRICING['opencode-go'])) {
    assert.ok(source.includes(`value: '${model}'`), `${model} is available in the OpenCode Go picker`);
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

test('fallback only tries configured providers and keeps the selected provider key prompt', async () => {
  const configured = load(null, { statuses: [503, 200] });
  Object.assign(configured.ai.sharedState.config, {
    aiProvider: 'openrouter', openrouterApiKey: 'router-key', opencodeGoApiKey: 'go-key',
  });
  assert.equal(await configured.ai.askAIWithFallback('Question', [], null, 'form'), true);
  assert.deepEqual(configured.sent.map(({ payload }) => payload.model), [
    configured.ai.DEFAULT_CONFIG.openrouterModel, configured.ai.DEFAULT_CONFIG.opencodeGoModel,
  ]);
  assert.equal(configured.prompts.length, 0);
  assert.match(configured.popups.at(-1)[0], /Answered by OpenCode Go \(fallback\)/);

  const manual = load(null, { promptResult: 'new-router-key' });
  manual.ai.sharedState.config.aiProvider = 'openrouter';
  assert.equal(await manual.ai.askAIForQuestion('Question', [], null, 'form'), true);
  assert.match(manual.prompts[0], /OpenRouter API Key/);
  assert.equal(manual.ai.sharedState.config.openrouterApiKey, 'new-router-key');
  assert.equal(manual.sent[0].headers.Authorization, 'Bearer new-router-key');
});

test('missing provider keys show setup instructions and no hosted DeepSeek endpoint remains', async () => {
  const automatic = load();
  assert.equal(await automatic.ai.askAIForQuestion('Question', [], null, 'form', false), false);
  assert.equal(automatic.prompts.length, 0);
  assert.match(automatic.popups.at(-1)[0], /No AI provider is configured/);
  assert.equal(automatic.sent.length, 0);

  const empty = load();
  assert.equal(await empty.ai.askAIWithFallback('Question', [], null, 'form'), false);
  assert.equal(empty.prompts.length, 1);
  assert.match(empty.popups.at(-1)[0], /No AI provider is configured/);
  assert.equal(empty.sent.length, 0);
  assert.match(empty.ai.askProvider('deepseek', 'Question', [], null, 'form').error, /Unsupported AI provider/);
  assert.doesNotMatch(source, /q5dh1rfszfym23hj|DeepSeek-V4-Flash-0731|DEEPSEEK_API_URL|askDeepSeek/);
});
