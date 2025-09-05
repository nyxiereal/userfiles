// ==UserScript==
// @name         Quizizz Hypertool
// @namespace    http://tampermonkey.net/
// @version      1.5.0
// @description  A tool for Wayground (also known as Quizizz).
// @author       Nyx
// @license      GPL-3.0
// @match        https://quizizz.com/*
// @match        https://wayground.com/*
// @grant        GM_addStyle
// @grant        GM_log
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      media.quizizz.com
// @connect      generativelanguage.googleapis.com
// ==/UserScript==

(function () {
    'use strict';

    const GEMINI_API_KEY_STORAGE = 'GEMINI_API_KEY';
    const GEMINI_MODEL = 'gemini-2.5-flash';
    const UI_MODS_ENABLED_KEY = 'qht_ui_modifications_enabled';
    let uiModificationsEnabled = GM_getValue(UI_MODS_ENABLED_KEY, true);

    GM_addStyle(`
        .quizizz-ddg-link, .quizizz-gemini-button, .quizizz-copy-prompt-button {
            display: inline-block; padding: 5px 8px;
            color: white; text-decoration: none; border-radius: 4px; font-size: 0.8em;
            cursor: pointer; text-align: center; vertical-align: middle;
            transition: opacity 0.2s ease-in-out;
        }
        .quizizz-ddg-link:hover, .quizizz-gemini-button:hover, .quizizz-copy-prompt-button:hover { opacity: 0.85; }
        .quizizz-ddg-link { background-color: #4CAF50; }
        .quizizz-gemini-button { background-color: #007bff; margin-left: 5px; }
        .quizizz-copy-prompt-button { background-color: #FF9800; margin-left: 5px; }
        .quizizz-option-wrapper {
            display: flex; flex-direction: column; align-items: stretch; justify-content: space-between; height: 100%;
        }
        .quizizz-option-wrapper > button.option {
            display: flex; flex-direction: column; flex-grow: 1; min-height: 0; width: 100%;
        }
        .quizizz-ddg-link-option-item {
            width: 100%; box-sizing: border-box; margin-top: 16px; padding: 6px 0; border-radius: 0 0 4px 4px; flex-shrink: 0;
        }
        .quizizz-ddg-link-main-question, .quizizz-gemini-button-main-question, .quizizz-copy-prompt-button-main-question {
            display: block; width: fit-content; margin: 8px auto 0 auto;
        }
        .quizizz-gemini-response-popup {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background-color: #2d3748; color: #e2e8f0; border: 1px solid #4a5568;
            border-radius: 8px; padding: 20px; z-index: 10001; min-width: 380px;
            max-width: 650px; max-height: 80vh; overflow-y: auto;
            box-shadow: 0 10px 25px rgba(0,0,0,0.35), 0 6px 10px rgba(0,0,0,0.25);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
            font-size: 15px;
        }
        .quizizz-gemini-response-popup-header {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #4a5568;
        }
        .quizizz-gemini-response-popup-title { font-weight: 600; font-size: 1.2em; color: #a0aec0; }
        .quizizz-gemini-response-popup-close {
            background: none; border: none; font-size: 1.9em; line-height: 1;
            cursor: pointer; color: #a0aec0; padding: 0 5px; transition: color 0.2s ease-in-out;
        }
        .quizizz-gemini-response-popup-close:hover { color: #cbd5e0; }
        .quizizz-gemini-response-popup-content {
            white-space: pre-wrap; font-size: 1em; line-height: 1.65; color: #cbd5e0;
        }
        .quizizz-gemini-response-popup-content strong, .quizizz-gemini-response-popup-content b { color: #e2e8f0; font-weight: 600; }
        .quizizz-gemini-response-popup-loading {
            text-align: center; font-style: italic; color: #a0aec0; padding: 25px 0; font-size: 1.05em;
        }
        .quizizz-gemini-response-popup::-webkit-scrollbar { width: 8px; }
        .quizizz-gemini-response-popup::-webkit-scrollbar-track { background: #2d3748; }
        .quizizz-gemini-response-popup::-webkit-scrollbar-thumb {
            background-color: #4a5568; border-radius: 4px; border: 2px solid #2d3748;
        }
        .quizizz-gemini-response-popup::-webkit-scrollbar-thumb:hover { background-color: #718096; }
        #qht-toggle-ui-button {
            position: fixed; bottom: 15px; left: 15px; z-index: 10002;
            background-color: #607D8B; border: none; border-radius: 50%;
            width: 44px; height: 44px; cursor: pointer;
            box-shadow: 0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23);
            transition: background-color 0.2s ease-in-out, transform 0.2s ease;
            user-select: none; padding: 6px; box-sizing: border-box;
            display: flex; align-items: center; justify-content: center;
        }
        #qht-toggle-ui-button:hover { background-color: #546E7A; transform: scale(1.05); }
        #qht-toggle-ui-button.qht-mods-hidden-state { background-color: #4CAF50; }
        #qht-toggle-ui-button.qht-mods-hidden-state:hover { background-color: #43A047; }
    `);

    GM_registerMenuCommand('Set Gemini API Key', () => {
        const currentKey = GM_getValue(GEMINI_API_KEY_STORAGE, '');
        const newKey = prompt('Enter your Gemini API Key:', currentKey);
        if (newKey !== null) {
            GM_setValue(GEMINI_API_KEY_STORAGE, newKey.trim());
            GM_log('Gemini API Key updated.');
            alert('Gemini API Key saved!');
        }
    });

    const getApiKey = async () => {
        let apiKey = GM_getValue(GEMINI_API_KEY_STORAGE, null);
        if (!apiKey || apiKey.trim() === '') {
            apiKey = prompt('Gemini API Key not set. Please enter your API Key:');
            if (apiKey && apiKey.trim() !== '') {
                GM_setValue(GEMINI_API_KEY_STORAGE, apiKey.trim());
                return apiKey.trim();
            } else {
                alert('Gemini API Key is required. Set it via the Tampermonkey menu.');
                return null;
            }
        }
        return apiKey.trim();
    };

    const fetchImageAsBase64 = (imageUrl) => new Promise((resolve, reject) => {
        GM_log(`Fetching image: ${imageUrl}`);
        GM_xmlhttpRequest({
            method: 'GET', url: imageUrl, responseType: 'blob',
            onload: (response) => {
                if (response.status >= 200 && response.status < 300) {
                    const blob = response.response;
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const dataUrl = reader.result;
                        const mimeType = dataUrl.substring(dataUrl.indexOf(':') + 1, dataUrl.indexOf(';'));
                        const base64Data = dataUrl.substring(dataUrl.indexOf(',') + 1);
                        GM_log(`Image fetched successfully. MIME type: ${mimeType}, Size: ~${(base64Data.length * 0.75 / 1024).toFixed(2)} KB`);
                        resolve({ base64Data, mimeType });
                    };
                    reader.onerror = () => reject('FileReader error while processing image.');
                    reader.readAsDataURL(blob);
                } else {
                    GM_log(`Failed to fetch image. Status: ${response.status}`);
                    reject(`Failed to fetch image. Status: ${response.status}`);
                }
            },
            onerror: () => reject('Network error while fetching image.'),
            ontimeout: () => reject('Image fetch request timed out.')
        });
    });

    const buildGeminiPrompt = (question, options, hasImage) => `
Context: You are an AI assistant helping a user with a Quizizz quiz.
The user needs to identify the correct answer(s) from the given options for the following question.
${hasImage ? "An image is associated with this question; please consider it in your analysis." : ""}

Question: "${question}"

Available Options:
${options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}

Please perform the following:
1. Identify the correct answer or answers from the "Available Options" list.
2. Provide a concise reasoning for your choice(s).
3. Format your response clearly. Start with "Correct Answer(s):" followed by the answer(s) (you can refer to them by option number or text), and then "Reasoning:" followed by your explanation. Be brief and to the point. If the options seem unrelated or the question cannot be answered with the provided information (including the image if present), please state that clearly in your reasoning.
`;

    const askGemini = (apiKey, question, options, imageData) => {
        const promptText = buildGeminiPrompt(question, options, !!imageData);
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
        const requestPayloadContents = [{ parts: [{ text: promptText }] }];
        if (imageData && imageData.base64Data && imageData.mimeType) {
            requestPayloadContents[0].parts.push({
                inline_data: { mime_type: imageData.mimeType, data: imageData.base64Data }
            });
        }
        const apiPayload = {
            contents: requestPayloadContents,
            generationConfig: { temperature: 0.2, maxOutputTokens: 500, topP: 0.95, topK: 40 },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
            ]
        };
        GM_log('--- Sending to Gemini API ---');
        showGeminiResponsePopup("Loading Gemini's insights...", true);
        GM_xmlhttpRequest({
            method: 'POST', url: apiUrl, headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify(apiPayload),
            onload: (response) => {
                GM_log('--- Received from Gemini API ---');
                GM_log('Response Status: ' + response.status);
                try {
                    const result = JSON.parse(response.responseText);
                    if (result.candidates && result.candidates.length > 0 &&
                        result.candidates[0].content && result.candidates[0].content.parts &&
                        result.candidates[0].content.parts.length > 0) {
                        const geminiText = result.candidates[0].content.parts[0].text;
                        showGeminiResponsePopup(geminiText);
                    } else if (result.promptFeedback && result.promptFeedback.blockReason) {
                        showGeminiResponsePopup(`Gemini API Error: Blocked due to ${result.promptFeedback.blockReason}.\nDetails: ${JSON.stringify(result.promptFeedback.safetyRatings)}`);
                    } else if (result.error) {
                        showGeminiResponsePopup(`Gemini API Error: ${result.error.message}\nDetails: ${JSON.stringify(result.error.details)}`);
                    } else {
                        showGeminiResponsePopup('Gemini API Error: Could not parse a valid response.');
                    }
                } catch (e) {
                    showGeminiResponsePopup('Gemini API Error: Failed to parse JSON response.\n' + e.message + '\nRaw response: ' + response.responseText);
                }
            },
            onerror: (response) => {
                GM_log('--- Gemini API Error (onerror) ---');
                GM_log('Response Status: ' + response.status);
                GM_log('Response Text: ' + response.responseText);
                showGeminiResponsePopup(`Gemini API Error: Request failed. Status: ${response.status}`);
            },
            ontimeout: () => showGeminiResponsePopup('Gemini API Error: Request timed out.')
        });
    };

    const showGeminiResponsePopup = (content, isLoading = false) => {
        if (!uiModificationsEnabled) {
            const existingPopup = document.getElementById('quizizz-gemini-popup');
            if (existingPopup) existingPopup.remove();
            return;
        }
        let popup = document.getElementById('quizizz-gemini-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'quizizz-gemini-popup';
            popup.classList.add('quizizz-gemini-response-popup');
            const header = document.createElement('div');
            header.classList.add('quizizz-gemini-response-popup-header');
            const title = document.createElement('span');
            title.classList.add('quizizz-gemini-response-popup-title');
            title.textContent = "Gemini AI Response";
            const closeButton = document.createElement('button');
            closeButton.classList.add('quizizz-gemini-response-popup-close');
            closeButton.innerHTML = '×';
            closeButton.onclick = () => popup.remove();
            header.appendChild(title);
            header.appendChild(closeButton);
            popup.appendChild(header);
            const contentDiv = document.createElement('div');
            contentDiv.classList.add('quizizz-gemini-response-popup-content');
            popup.appendChild(contentDiv);
            document.body.appendChild(popup);
        }
        const contentDiv = popup.querySelector('.quizizz-gemini-response-popup-content');
        if (isLoading) {
            contentDiv.innerHTML = `<div class="quizizz-gemini-response-popup-loading">${content}</div>`;
        } else {
            let formattedContent = content.replace(/^(Correct Answer\(s\):)/gmi, '<strong>$1</strong>');
            formattedContent = formattedContent.replace(/^(Reasoning:)/gmi, '<br><br><strong>$1</strong>');
            contentDiv.innerHTML = formattedContent;
        }
        popup.style.display = 'block';
    };

    const SELECTORS = {
        questionContainer: 'div[data-testid="question-container-text"]',
        questionText: 'div[data-testid="question-container-text"] div#questionText p, div[data-cy="question-text-color"] p',
        questionImage: 'div[data-testid="question-container-text"] img, div[class*="question-media-container"] img, img[data-testid="question-container-image"], .question-image',
        optionButtons: 'button.option',
        optionText: 'div#optionText p, .option-text p, .resizeable p',
        pageInfo: 'div.pill p, div[class*="question-counter"] p'
    };

    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    };

    const createButton = (text, className, onClick) => {
        const button = document.createElement('button');
        button.textContent = text;
        button.classList.add(...className.split(' '));
        button.onclick = onClick;
        return button;
    };

    const extractAndProcess = () => {
        GM_log(`Quizizz Hypertool: Running extraction. UI Mods Enabled: ${uiModificationsEnabled}`);
        document.querySelectorAll('.quizizz-ddg-link, .quizizz-gemini-button, .quizizz-copy-prompt-button').forEach(el => el.remove());
        document.querySelectorAll('.quizizz-option-wrapper').forEach(wrapper => {
            const button = wrapper.querySelector('button.option');
            if (button && wrapper.parentNode) {
                wrapper.parentNode.insertBefore(button, wrapper);
            }
            wrapper.remove();
        });
        const geminiPopup = document.getElementById('quizizz-gemini-popup');
        if (geminiPopup) geminiPopup.remove();
        if (!uiModificationsEnabled) return;

        let questionTitle = '';
        let optionTexts = [];
        let questionImageUrl = null;

        const questionImageElement = document.querySelector(SELECTORS.questionImage);
        if (questionImageElement?.src) {
            questionImageUrl = questionImageElement.src.startsWith('/') ? window.location.origin + questionImageElement.src : questionImageElement.src;
            GM_log('Found question image URL: ' + questionImageUrl);
        }

        const questionTitleTextElement = document.querySelector(SELECTORS.questionText);
        const questionTextOuterContainer = document.querySelector(SELECTORS.questionContainer);

        if (questionTitleTextElement && questionTextOuterContainer) {
            questionTitle = questionTitleTextElement.textContent.trim();
            GM_log('Question Title: ' + questionTitle);

            if (questionTitle || questionImageUrl) {
                const ddgQLink = document.createElement('a');
                ddgQLink.href = `https://duckduckgo.com/?q=${encodeURIComponent(questionTitle || (questionImageUrl ? "image in question" : "Quizizz Question"))}`;
                ddgQLink.textContent = 'DDG Q';
                ddgQLink.target = '_blank';
                ddgQLink.rel = 'noopener noreferrer';
                ddgQLink.classList.add('quizizz-ddg-link', 'quizizz-ddg-link-main-question');
                questionTextOuterContainer.appendChild(ddgQLink);

                const copyPromptButton = createButton('Copy Gemini Prompt', 'quizizz-copy-prompt-button quizizz-copy-prompt-button-main-question', async () => {
                    if (!questionTitle && !questionImageUrl && optionTexts.length === 0) {
                        alert("No content to build prompt.");
                        return;
                    }
                    const prompt = buildGeminiPrompt(questionTitle || (questionImageUrl ? "(See attached image)" : "No text question"), optionTexts, !!questionImageUrl);
                    try {
                        await navigator.clipboard.writeText(prompt);
                        copyPromptButton.textContent = 'Copied!';
                        copyPromptButton.style.backgroundColor = '#4CAF50';
                        setTimeout(() => {
                            copyPromptButton.textContent = 'Copy Gemini Prompt';
                            copyPromptButton.style.backgroundColor = '';
                        }, 2000);
                    } catch (err) {
                        alert('Failed to copy prompt.');
                    }
                });
                questionTextOuterContainer.appendChild(copyPromptButton);

                const geminiButton = createButton('Ask Gemini', 'quizizz-gemini-button quizizz-gemini-button-main-question', async () => {
                    const apiKey = await getApiKey();
                    if (!apiKey) return;
                    if (!questionTitle && !questionImageUrl && optionTexts.length === 0) {
                        alert("No content to send.");
                        return;
                    }
                    showGeminiResponsePopup("Preparing data...", true);
                    let imageData = null;
                    if (questionImageUrl) {
                        try {
                            imageData = await fetchImageAsBase64(questionImageUrl);
                        } catch (error) {
                            showGeminiResponsePopup(`Failed to fetch image: ${error}\nProceeding with text only.`);
                        }
                    }
                    askGemini(apiKey, questionTitle || (questionImageUrl ? "(See attached image)" : "No text question"), optionTexts, imageData);
                });
                questionTextOuterContainer.appendChild(geminiButton);
            }
        }

        optionTexts = [];
        const optionButtons = document.querySelectorAll(SELECTORS.optionButtons);
        optionButtons.forEach(button => {
            const optionTextElement = button.querySelector(SELECTORS.optionText);
            if (optionTextElement) {
                const optionText = optionTextElement.textContent.trim();
                if (optionText) optionTexts.push(optionText);

                const ddgLink = document.createElement('a');
                ddgLink.href = `https://duckduckgo.com/?q=${encodeURIComponent(optionText)}`;
                ddgLink.textContent = 'DDG';
                ddgLink.target = '_blank';
                ddgLink.rel = 'noopener noreferrer';
                ddgLink.classList.add('quizizz-ddg-link', 'quizizz-ddg-link-option-item');

                const wrapper = document.createElement('div');
                wrapper.classList.add('quizizz-option-wrapper');
                wrapper.style.flexBasis = button.style.flexBasis || '100%';

                if (button.parentNode) {
                    button.parentNode.insertBefore(wrapper, button);
                    wrapper.appendChild(button);
                    wrapper.appendChild(ddgLink);
                }
                // Set max-width to 100% for the button when UI mods are enabled
                button.style.maxWidth = '100%';
            }
        });
        GM_log(`Processed ${optionButtons.length} options.`);
    };

    const setupObserver = () => {
        const observer = new MutationObserver(debounce(() => checkPageInfoAndReprocess(), 500));
        observer.observe(document.body, { childList: true, subtree: true });
    };

    let lastPageInfo = "INITIAL_STATE_PAGE_INFO_MAGIC_STRING_FOR_FIRST_RUN_DETECTION";
    let toggleButton = null;

    const updateToggleButtonAppearance = () => {
        if (!toggleButton) return;
        if (uiModificationsEnabled) {
            toggleButton.innerHTML = '✕';
            toggleButton.title = 'Hide Hypertool Modifications';
            toggleButton.classList.remove('qht-mods-hidden-state');
        } else {
            toggleButton.innerHTML = '🛠️';
            toggleButton.title = 'Show Hypertool Modifications';
            toggleButton.classList.add('qht-mods-hidden-state');
        }
    };

    const handleToggleUiClick = () => {
        uiModificationsEnabled = !uiModificationsEnabled;
        GM_setValue(UI_MODS_ENABLED_KEY, uiModificationsEnabled);
        GM_log(`UI Modifications ${uiModificationsEnabled ? 'Enabled' : 'Disabled'}`);
        updateToggleButtonAppearance();
        setTimeout(() => {
            lastPageInfo = "FORCE_REPROCESS_MAGIC_STRING_" + Date.now();
            checkPageInfoAndReprocess();
        }, 100);
    };

    const createToggleButton = () => {
        if (document.getElementById('qht-toggle-ui-button')) return;
        toggleButton = document.createElement('button');
        toggleButton.id = 'qht-toggle-ui-button';
        updateToggleButtonAppearance();
        toggleButton.addEventListener('click', handleToggleUiClick);
        document.body.appendChild(toggleButton);
    };

    const checkPageInfoAndReprocess = () => {
        const pageInfoElement = document.querySelector(SELECTORS.pageInfo);
        let currentPageInfoText = pageInfoElement ? pageInfoElement.textContent.trim() : "";

        if (currentPageInfoText !== lastPageInfo) {
            if (currentPageInfoText === "" && lastPageInfo === "INITIAL_STATE_PAGE_INFO_MAGIC_STRING_FOR_FIRST_RUN_DETECTION") {
                GM_log('Initial poll: Page info element not yet found or is empty. Setting baseline and waiting for content to appear.');
                lastPageInfo = currentPageInfoText;
                if (uiModificationsEnabled) extractAndProcess();
                return;
            }
            GM_log(`Page info change detected or forced reprocess. Old: "${lastPageInfo}", New: "${currentPageInfoText}". Triggering UI update.`);
            lastPageInfo = currentPageInfoText;
            extractAndProcess();
        }
    };

    if (document.body) {
        createToggleButton();
        setupObserver();
        checkPageInfoAndReprocess();
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            createToggleButton();
            setupObserver();
            checkPageInfoAndReprocess();
        });
    }
    GM_log(`Quizizz Hypertool (v${GM_info.script.version}) loaded. Monitoring page info for changes.`);

})();