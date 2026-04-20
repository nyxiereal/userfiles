# Userfiles

Collection of userscripts that I made for various purposes.

> [!WARNING]
> This will only work on [Violentmonkey](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/)!

## UETS (Universal Educational Tool Suite)

A multi-cheat tool for some educational platforms.

- Supports Quizizz/Wayground, Google Forms, Testportal, and Kahoot.
- Universal features: Adding AI, copy prompt, copy text, and DDG buttons to questions, and some answers. Doesn't work on Kahoot.
- Testportal: Removes the "safety" measures, making you unable to leave the window.
- Hides itself quickly, at the press of a button, press the bottom-left corner of the screen to reveal/hide the edits.
- Quizizz/Wayground: Crowdsourcing answers (every time you answer a question, its correct answer gets sent to the server, and when you encounter the same question, it will show you the correct answer), improved streak bonus counter, forced quick answer times (you'll always get the bonus points), hijack timer for bonus points.
- Kahoot: Crowdsourcing answers (you'll automatically get connected to any other person who has the script installed, their answers will be shown to you, and vice versa. This is so you can make an educated guess about the answer/s.).

### UETS Server setup

1. Install Go
2. Install the dependencies with `go mod download`
3. Run the server with `go run main.go`
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