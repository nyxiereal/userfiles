# Userfiles

Collection of userscripts that I made for various purposes.

> [!WARNING]
> This will only work on [Violentmonkey](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/)!

## UETS (Universal Educational Tool Suite)

A multi-cheat tool for some educational platforms.

- Supports Quizizz/Wayground, Google Forms, and Kahoot.
- Universal features: Adding AI, copy prompt, copy text, and DDG buttons to questions and some answers. Doesn't work on Kahoot. AI answers appear as a notification with a copy button, and text answers can be dropped into the answer box with the pencil button.
- AI: if a request fails or is rate limited, UETS retries providers that have a saved API key. An AI provider key is required. A manual request prompts for the selected provider's key if it is missing.
- Optional auto-ask: when neither the quiz payload nor the crowdsourced server knows the answer, one AI provider chain starts automatically as soon as the question appears (off by default).
- Hides itself quickly - click the floating button in the bottom-left corner to toggle the edits. Double-click it (or use your userscript manager's menu -> UETS Settings) to open the settings.
- Quizizz/Wayground: Crowdsourcing answers (every time you answer a question, its correct answer gets sent to the server, and when you encounter the same question, it will show you the correct answer), improved streak bonus counter, forced quick answer times (you'll always get the bonus points, and the spoofed time follows a human reading/reaction estimate of the actual question instead of a flat random number), hijack timer for bonus points, and blocked tab-switch/focus plus analytics telemetry.
- Kahoot: Crowdsourcing answers (you'll automatically get connected to any other person who has the script installed, their answers will be shown to you, and vice versa. This is so you can make an educated guess about the answer/s.).

### UETS AI models

Model IDs, pricing, and capabilities are a snapshot from OpenRouter's [model catalog](https://openrouter.ai/api/v1/models), [models.dev](https://models.dev/api.json), and the providers' official docs, checked on 2026-10-16. Prices are USD per 1M tokens and may change.

- OpenRouter defaults to `openai/gpt-6-luna`. Other models are Claude Haiku 5.5, Grok 4.7, Gemini 3.8 Flash, Qwen3.8 Flash, Kimi K3, Claude Sonnet 5, GLM-5.3 Flash, and paid DeepSeek V4 Flash. DeepSeek V4 Flash is text-only. Sonnet 5 supports reasoning effort levels; GPT 6 Luna and Sonnet 5 omit sampling parameters.
- Native Gemini offers Gemini 3.8 Flash and Gemini 4 Argon. Older Flash Lite selections migrate to Gemini 3.8 Flash because Google's API cannot serve Claude.
- OpenCode Go offers GPT 6 Luna, Claude Haiku 5.5, DeepSeek V4.1 Flash / V4 Pro, Qwen3.8 Max / Flash, MiMo-V2.6-Pro, Kimi K3, and GLM-5.3. DeepSeek V4 Pro and GLM-5.3 omit images; V4.1 Flash supports them. [Go pricing and model list](https://opencode.ai/v2/docs/console/go/) include peak-hour DeepSeek rates. Go is intended for coding-agent traffic; UETS is not a validated client.
- Added OpenRouter models, verified against the OpenRouter catalog: `anthropic/claude-sonnet-5` ($2 / $10, image input), `z-ai/glm-5.3-flash` ($0.15 / $0.50, image input), and `deepseek/deepseek-v4-flash` ($0.091 / $0.182, text-only). The [Sonnet 5 model page](https://openrouter.ai/anthropic/claude-sonnet-5) lists its reasoning effort levels. Google's [Gemini model docs](https://ai.google.dev/gemini-api/docs/models) document native API support; models.dev supplies the ID and price snapshot. OpenCode Go IDs and prices come from the [Go docs](https://opencode.ai/v2/docs/console/go/) and models.dev.
- Fresh installs select OpenRouter and GPT 6 Luna. A one-time migration resets existing OpenRouter and OpenCode Go model selections to Luna. It keeps OpenCode Go selected if it was already selected, or if Go is the only configured provider key; otherwise it selects OpenRouter. The saved migration marker leaves later provider and model choices alone. Existing API keys and unrelated settings are kept.
- The free hosted DeepSeek API endpoint has been removed. It is never called, and no free Luna access or credentials are bundled. Paid DeepSeek models remain available through OpenRouter and OpenCode Go.

Run the AI model, migration, and fallback checks with `node --test tests/*.test.cjs`.

### UETS Server setup

1. Install Go
2. Install the dependencies with `go mod download`
3. Run the server with `go run .`
4. The server will be running at `http://localhost:5000`, all answers will be stored in `data/quiz_data.db`. Logs will be stored in `uets-server.log`.

OR

1. Install Docker
2. Create this `docker-compose.yml` file:

    ```yaml
    services:
        uets-server:
            image: ghcr.io/nyxiereal/userfiles/uets-server:latest
            ports:
            - '5000:5000'
            restart: unless-stopped
            volumes:
            - /path/to/your/uets/data:/app/data
    ```

3. Run `docker compose up -d`
4. The server will be running at `http://localhost:5000`, all answers will be stored in `data/quiz_data.db`. Logs will be stored in `uets-server.log`. Websocket commections are handled filelessly.
5. Now you can open the web interface at `http://localhost:5000`. Set the same URL in the userscript settings.

## Roperunner

Cheat for zawodowe.edu.pl, shows the answer to questions in the top right corner automatically

Requires an openrouter api key - configured when you open the site
