# Userfiles
Collection of userscripts that I made for various purposes.

> [!WARNING]
> This will only work on [Violentmonkey](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/)!

## UETS (Universal Educational Tool Suite)
A multi-cheat tool for some educational platforms.
- Supports Quizizz/Wayground, Google Forms, and Testportal.
- Universal features: Adding AI, copy prompt, copy text, and DDG buttons to questions, and some answers.
- Testportal: Removes the "safety" measures, making you unable to leave the window.
- Hides itself quickly, at the press of a button, press the bottom-left corner of the screen to reveal/hide the edits.
- Quizizz/Wayground: Crowdsourcing answers (every time you answer a question, its correct answer gets sent to the server, and when you encounter the same question, it will show you the correct answer), improved streak bonus counter, forced quick answer times (you'll always get the bonus points) ::WIP

### UETS Server setup
1. Install Python, alongside uv
2. Install the dependencies with `uv pip install -r requirements.txt`
3. Run the server with `uv run main.py`
4. The server will be running at `http://localhost:5000`, all answers will be stored in `quiz_data.json`