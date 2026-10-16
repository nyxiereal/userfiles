# Userfiles

Collection of userscripts that I made for various purposes.

> [!WARNING]
> This will only work on [Violentmonkey](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/)!

## UETS (Universal Educational Tool Suite)

A multi-cheat tool for some educational platforms.

- Supports Quizizz/Wayground, Google Forms, and Kahoot.
- Universal features: Adding AI, copy prompt, copy text, and DDG buttons to questions and some answers. Doesn't work on Kahoot. AI answers appear as a notification with a copy button, and text answers can be dropped into the answer box with the pencil button.
- AI: if the selected provider fails or is rate limited, the request is retried with the next configured provider (the hosted DeepSeek endpoint needs no key, so it is always the last resort).
- Optional auto-ask: when neither the quiz payload nor the crowdsourced server knows the answer, one AI provider chain starts automatically as soon as the question appears (off by default).
- Hides itself quickly - click the floating button in the bottom-left corner to toggle the edits. Double-click it (or use your userscript manager's menu -> UETS Settings) to open the settings.
- Quizizz/Wayground: Crowdsourcing answers (every time you answer a question, its correct answer gets sent to the server, and when you encounter the same question, it will show you the correct answer), improved streak bonus counter, forced quick answer times (you'll always get the bonus points, and the spoofed time follows a human reading/reaction estimate of the actual question instead of a flat random number), hijack timer for bonus points, and blocked tab-switch/focus plus analytics telemetry.
- Kahoot: Crowdsourcing answers (you'll automatically get connected to any other person who has the script installed, their answers will be shown to you, and vice versa. This is so you can make an educated guess about the answer/s.).

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
