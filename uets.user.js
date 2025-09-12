// ==UserScript==
// @name         Universal Educational Tool Suite
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  A unified tool for cheating on online test sites
// @author       Nyx
// @license      GPL-3.0
// @match        https://quizizz.com/*
// @match        https://wayground.com/*
// @match        https://*.testportal.net/*
// @match        https://*.testportal.pl/*
// @match        https://docs.google.com/forms/d/e/*/viewform*
// @grant        GM_addStyle
// @grant        GM_log
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @connect      media.quizizz.com
// @connect      generativelanguage.googleapis.com
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    // === SHARED CONSTANTS ===
    const GEMINI_API_KEY_STORAGE = 'UETS_GEMINI_API_KEY';
    const GEMINI_MODEL = 'gemini-2.5-flash';
    const UI_MODS_ENABLED_KEY = 'uets_ui_modifications_enabled';

    // === SHARED STATE ===
    const sharedState = {
        uiModificationsEnabled: GM_getValue(UI_MODS_ENABLED_KEY, true),
        toggleButton: null,
        geminiPopup: null,
        elementsToCleanup: [],
        observer: null,
        currentDomain: window.location.hostname,
        originalRegExpTest: RegExp.prototype.test
    };

    // === SHARED STYLES ===
    GM_addStyle(`
        .uets-ddg-link, .uets-gemini-button, .uets-copy-prompt-button, .uets-ai-button, .uets-ddg-button {
            display: inline-block; padding: 5px 8px;
            color: white; text-decoration: none; border-radius: 4px; font-size: 0.8em;
            cursor: pointer; text-align: center; vertical-align: middle;
            transition: opacity 0.2s ease-in-out; border: none;
        }
        .uets-ddg-link:hover, .uets-gemini-button:hover, .uets-copy-prompt-button:hover,
        .uets-ai-button:hover, .uets-ddg-button:hover { opacity: 0.85; }
        .uets-ddg-link, .uets-ddg-button { background-color: #4CAF50; }
        .uets-gemini-button, .uets-ai-button { background-color: #007bff; margin-left: 8px; }
        .uets-copy-prompt-button { background-color: #FF9800; margin-left: 8px; }
        .uets-ddg-button { margin-left: 8px; }

        .uets-option-wrapper {
            display: flex; flex-direction: column; align-items: stretch; justify-content: space-between; height: 100%;
        }
        .uets-option-wrapper > button.option {
            display: flex; flex-direction: column; flex-grow: 1; min-height: 0; width: 100%;
        }
        .uets-ddg-link-option-item {
            width: 100%; box-sizing: border-box; margin-top: 16px; padding: 6px 0; border-radius: 0 0 4px 4px; flex-shrink: 0;
        }
        .uets-ddg-link-main-question, .uets-gemini-button-main-question, .uets-copy-prompt-button-main-question {
            display: block; width: fit-content; margin: 8px auto 0 auto;
        }

        .uets-gemini-response-popup {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background-color: #2d3748; color: #e2e8f0; border: 1px solid #4a5568;
            border-radius: 8px; padding: 20px; z-index: 10001; min-width: 380px;
            max-width: 650px; max-height: 80vh; overflow-y: auto;
            box-shadow: 0 10px 25px rgba(0,0,0,0.35), 0 6px 10px rgba(0,0,0,0.25);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
            font-size: 15px;
        }
        .uets-gemini-response-popup-header {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #4a5568;
        }
        .uets-gemini-response-popup-title { font-weight: 600; font-size: 1.2em; color: #a0aec0; }
        .uets-gemini-response-popup-close {
            background: none; border: none; font-size: 1.9em; line-height: 1;
            cursor: pointer; color: #a0aec0; padding: 0 5px; transition: color 0.2s ease-in-out;
        }
        .uets-gemini-response-popup-close:hover { color: #cbd5e0; }
        .uets-gemini-response-popup-content {
            white-space: pre-wrap; font-size: 1em; line-height: 1.65; color: #cbd5e0;
        }
        .uets-gemini-response-popup-content strong, .uets-gemini-response-popup-content b { color: #e2e8f0; font-weight: 600; }
        .uets-gemini-response-popup-loading {
            text-align: center; font-style: italic; color: #a0aec0; padding: 25px 0; font-size: 1.05em;
        }

        #uets-toggle-ui-button {
            position: fixed; bottom: 15px; left: 15px; z-index: 10002;
            background-color: #607D8B; border: none; border-radius: 50%;
            width: 44px; height: 44px; cursor: pointer;
            box-shadow: 0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23);
            transition: background-color 0.2s ease-in-out, transform 0.2s ease;
            user-select: none; padding: 6px; box-sizing: border-box;
            display: flex; align-items: center; justify-content: center;
            color: white; font-size: 16px;
        }
        #uets-toggle-ui-button:hover { background-color: #546E7A; transform: scale(1.05); }
        #uets-toggle-ui-button.uets-mods-hidden-state { background-color: transparent; }
        #uets-toggle-ui-button.uets-mods-hidden-state:hover { background-color: #ff0000; }

        .gform-copy-button {
            margin-left: 12px; padding: 2px 8px; font-size: 12px; font-weight: bold;
            color: #fff; background-color: #1a73e8; border: none; border-radius: 4px;
            cursor: pointer; vertical-align: middle; transition: background-color 0.2s;
        }
        .gform-copy-button:hover { background-color: #287ae6; }
        .gform-copy-button:disabled { background-color: #8ab4f8; cursor: default; }
    `);

    // === SHARED API KEY MANAGEMENT ===
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

    // === SHARED IMAGE FETCHING ===
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
                        GM_log(`Image fetched successfully. MIME type: ${mimeType}`);
                        resolve({ base64Data, mimeType });
                    };
                    reader.onerror = () => reject('FileReader error while processing image.');
                    reader.readAsDataURL(blob);
                } else {
                    reject(`Failed to fetch image. Status: ${response.status}`);
                }
            },
            onerror: () => reject('Network error while fetching image.'),
            ontimeout: () => reject('Image fetch request timed out.')
        });
    });

    // === SHARED GEMINI INTERACTION ===
    const buildGeminiPrompt = (question, options, hasImage, platform = 'quiz') => {
        const contextMap = {
            quiz: 'You are an AI assistant helping a user with a quiz.',
            test: 'You are an AI assistant helping a user with a test.',
            form: 'You are an AI assistant helping a user with a form.'
        };

        return `
Context: ${contextMap[platform] || contextMap.quiz}
The user needs to identify the correct answer(s) from the given options for the following question.
${hasImage ? "An image is associated with this question; please consider it in your analysis." : ""}

Question: "${question}"

Available Options:
${options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}

Please perform the following:
1. Identify the correct answer or answers from the "Available Options" list.
2. Provide a concise reasoning for your choice(s).
3. Format your response clearly. Start with "Correct Answer(s):" followed by the answer(s), and then "Reasoning:" followed by your explanation. Be brief and to the point.
`;
    };

    const askGemini = async (question, options, imageData, platform = 'quiz') => {
        const apiKey = await getApiKey();
        if (!apiKey) return;

        const promptText = buildGeminiPrompt(question, options, !!imageData, platform);
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

        showGeminiResponsePopup("Loading AI insights...", true);

        GM_xmlhttpRequest({
            method: 'POST', url: apiUrl, headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify(apiPayload),
            onload: (response) => {
                try {
                    const result = JSON.parse(response.responseText);
                    if (result.candidates && result.candidates.length > 0 &&
                        result.candidates[0].content && result.candidates[0].content.parts &&
                        result.candidates[0].content.parts.length > 0) {
                        const geminiText = result.candidates[0].content.parts[0].text;
                        showGeminiResponsePopup(geminiText);
                    } else if (result.error) {
                        showGeminiResponsePopup(`Gemini API Error: ${result.error.message}`);
                    } else {
                        showGeminiResponsePopup('Gemini API Error: Could not parse a valid response.');
                    }
                } catch (e) {
                    showGeminiResponsePopup('Gemini API Error: Failed to parse response.\n' + e.message);
                }
            },
            onerror: (response) => {
                showGeminiResponsePopup(`Gemini API Error: Request failed. Status: ${response.status}`);
            },
            ontimeout: () => showGeminiResponsePopup('Gemini API Error: Request timed out.')
        });
    };

    const showGeminiResponsePopup = (content, isLoading = false) => {
        if (!sharedState.uiModificationsEnabled) {
            if (sharedState.geminiPopup) {
                sharedState.geminiPopup.remove();
                sharedState.geminiPopup = null;
            }
            return;
        }

        let popup = document.getElementById('uets-gemini-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'uets-gemini-popup';
            popup.classList.add('uets-gemini-response-popup');

            const header = document.createElement('div');
            header.classList.add('uets-gemini-response-popup-header');

            const title = document.createElement('span');
            title.classList.add('uets-gemini-response-popup-title');
            title.textContent = "AI Assistant";

            const closeButton = document.createElement('button');
            closeButton.classList.add('uets-gemini-response-popup-close');
            closeButton.innerHTML = '×';
            closeButton.onclick = () => {
                popup.remove();
                sharedState.geminiPopup = null;
            };

            header.appendChild(title);
            header.appendChild(closeButton);
            popup.appendChild(header);

            const contentDiv = document.createElement('div');
            contentDiv.classList.add('uets-gemini-response-popup-content');
            popup.appendChild(contentDiv);

            document.body.appendChild(popup);
            sharedState.geminiPopup = popup;
        }

        const contentDiv = popup.querySelector('.uets-gemini-response-popup-content');
        if (isLoading) {
            contentDiv.innerHTML = `<div class="uets-gemini-response-popup-loading">${content}</div>`;
        } else {
            let formattedContent = content.replace(/^(Correct Answer\(s\):)/gmi, '<strong>$1</strong>');
            formattedContent = formattedContent.replace(/^(Reasoning:)/gmi, '<br><br><strong>$1</strong>');
            contentDiv.innerHTML = formattedContent;
        }
        popup.style.display = 'block';
    };

    // === SHARED UI TOGGLE ===
    const updateToggleButtonAppearance = () => {
        if (!sharedState.toggleButton) return;
        if (sharedState.uiModificationsEnabled) {
            sharedState.toggleButton.innerHTML = '✕';
            sharedState.toggleButton.title = 'Hide Tool Modifications';
            sharedState.toggleButton.classList.remove('uets-mods-hidden-state');
        } else {
            sharedState.toggleButton.innerHTML = '🛠️';
            sharedState.toggleButton.title = 'Show Tool Modifications';
            sharedState.toggleButton.classList.add('uets-mods-hidden-state');
        }
    };

    const handleToggleUiClick = () => {
        sharedState.uiModificationsEnabled = !sharedState.uiModificationsEnabled;
        GM_setValue(UI_MODS_ENABLED_KEY, sharedState.uiModificationsEnabled);
        updateToggleButtonAppearance();

        if (!sharedState.uiModificationsEnabled) {
            // Clean up existing UETS elements when disabling
            document.querySelectorAll('.uets-ddg-link, .uets-gemini-button, .uets-copy-prompt-button').forEach(el => el.remove());

            if (sharedState.geminiPopup) {
                sharedState.geminiPopup.remove();
                sharedState.geminiPopup = null;
            }

            // For Quizizz, only remove UETS wrappers but preserve original buttons
            document.querySelectorAll('.uets-option-wrapper').forEach(wrapper => {
                const button = wrapper.querySelector('button.option');
                if (button && wrapper.parentNode) {
                    wrapper.parentNode.insertBefore(button, wrapper);
                }
                wrapper.remove();
            });

            // Clean up other UETS elements
            sharedState.elementsToCleanup.forEach(el => {
                if (el && el.parentNode && !el.querySelector('button.option')) {
                    el.remove();
                }
            });
            sharedState.elementsToCleanup = [];

            // For Google Forms, reset the dataset flag to allow re-adding buttons on re-enable
            if (sharedState.currentDomain.includes('docs.google.com')) {
                const questionBlocks = document.querySelectorAll('div[role="listitem"] > div[jsmodel]');
                questionBlocks.forEach(block => {
                    delete block.dataset.uetsButtonsAdded;
                });
            }

            // For Testportal, reset the dataset flag to allow re-adding enhancements on re-enable
            if (sharedState.currentDomain.includes('testportal.net') || sharedState.currentDomain.includes('testportal.pl')) {
                const questionElements = document.querySelectorAll('.question_essence');
                questionElements.forEach(el => {
                    delete el.dataset.enhancementsAdded;
                });
            }
        } else {
            // Re-run domain-specific initialization when enabling
            setTimeout(() => {
                initializeDomainSpecific();
            }, 100);
        }
    };

    const createToggleButton = () => {
        if (document.getElementById('uets-toggle-ui-button')) return;

        sharedState.toggleButton = document.createElement('button');
        sharedState.toggleButton.id = 'uets-toggle-ui-button';
        updateToggleButtonAppearance();
        sharedState.toggleButton.addEventListener('click', handleToggleUiClick);
        document.body.appendChild(sharedState.toggleButton);
    };

    // === DOMAIN-SPECIFIC MODULES ===

    // QUIZIZZ/WAYGROUND MODULE
    const quizizzModule = {
        selectors: {
            questionContainer: 'div[data-testid="question-container-text"]',
            questionText: 'div[data-testid="question-container-text"] div#questionText p, div[data-cy="question-text-color"] p',
            questionImage: 'div[data-testid="question-container-text"] img, div[class*="question-media-container"] img, img[data-testid="question-container-image"], .question-image',
            optionButtons: 'button.option',
            optionText: 'div#optionText p, .option-text p, .resizeable p',
            pageInfo: 'div.pill p, div[class*="question-counter"] p'
        },

        lastPageInfo: "INITIAL_STATE",

        debounce: (func, wait) => {
            let timeout;
            return (...args) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => func(...args), wait);
            };
        },

        createButton: (text, className, onClick) => {
            const button = document.createElement('button');
            button.textContent = text;
            button.classList.add(...className.split(' '));
            button.onclick = onClick;
            return button;
        },

        extractAndProcess: () => {
            if (!sharedState.uiModificationsEnabled) return;

            // Clean up existing UETS elements first (but not original buttons)
            document.querySelectorAll('.uets-ddg-link, .uets-gemini-button, .uets-copy-prompt-button').forEach(el => el.remove());

            // Clean up existing wrappers and restore original button layout
            document.querySelectorAll('.uets-option-wrapper').forEach(wrapper => {
                const button = wrapper.querySelector('button.option');
                if (button && wrapper.parentNode) {
                    wrapper.parentNode.insertBefore(button, wrapper);
                }
                wrapper.remove();
            });

            // Filter out removed elements from cleanup array
            sharedState.elementsToCleanup = sharedState.elementsToCleanup.filter(el => {
                return el && el.parentNode;
            });

            let questionTitle = '';
            let optionTexts = [];
            let questionImageUrl = null;

            // Extract question image
            const questionImageElement = document.querySelector(quizizzModule.selectors.questionImage);
            if (questionImageElement?.src) {
                questionImageUrl = questionImageElement.src.startsWith('/') ?
                    window.location.origin + questionImageElement.src : questionImageElement.src;
            }

            // Extract question text
            const questionTitleTextElement = document.querySelector(quizizzModule.selectors.questionText);
            const questionTextOuterContainer = document.querySelector(quizizzModule.selectors.questionContainer);

            if (questionTitleTextElement && questionTextOuterContainer) {
                questionTitle = questionTitleTextElement.textContent.trim();

                if (questionTitle || questionImageUrl) {
                    // DDG link
                    const ddgQLink = document.createElement('a');
                    ddgQLink.href = `https://duckduckgo.com/?q=${encodeURIComponent(questionTitle || "quiz question")}`;
                    ddgQLink.textContent = 'DDG Q';
                    ddgQLink.target = '_blank';
                    ddgQLink.rel = 'noopener noreferrer';
                    ddgQLink.classList.add('uets-ddg-link', 'uets-ddg-link-main-question');
                    questionTextOuterContainer.appendChild(ddgQLink);
                    sharedState.elementsToCleanup.push(ddgQLink);

                    // Copy prompt button
                    const copyPromptButton = quizizzModule.createButton('Copy Prompt', 'uets-copy-prompt-button uets-copy-prompt-button-main-question', async () => {
                        const prompt = buildGeminiPrompt(questionTitle || "(See attached image)", optionTexts, !!questionImageUrl, 'quiz');
                        try {
                            await navigator.clipboard.writeText(prompt);
                            copyPromptButton.textContent = 'Copied!';
                            setTimeout(() => copyPromptButton.textContent = 'Copy Prompt', 2000);
                        } catch (err) {
                            alert('Failed to copy prompt.');
                        }
                    });
                    questionTextOuterContainer.appendChild(copyPromptButton);
                    sharedState.elementsToCleanup.push(copyPromptButton);

                    // Gemini button
                    const geminiButton = quizizzModule.createButton('Ask AI', 'uets-gemini-button uets-gemini-button-main-question', async () => {
                        let imageData = null;
                        if (questionImageUrl) {
                            try {
                                imageData = await fetchImageAsBase64(questionImageUrl);
                            } catch (error) {
                                showGeminiResponsePopup(`Failed to fetch image: ${error}\nProceeding with text only.`);
                            }
                        }
                        askGemini(questionTitle || "(See attached image)", optionTexts, imageData, 'quiz');
                    });
                    questionTextOuterContainer.appendChild(geminiButton);
                    sharedState.elementsToCleanup.push(geminiButton);
                }
            }

            // Process options - wait a bit for DOM to be ready
            setTimeout(() => {
                optionTexts = [];
                const optionButtons = document.querySelectorAll(quizizzModule.selectors.optionButtons);

                optionButtons.forEach(button => {
                    // Skip if already wrapped
                    if (button.closest('.uets-option-wrapper')) return;

                    const optionTextElement = button.querySelector(quizizzModule.selectors.optionText);
                    if (optionTextElement) {
                        const optionText = optionTextElement.textContent.trim();
                        if (optionText) optionTexts.push(optionText);

                        const ddgLink = document.createElement('a');
                        ddgLink.href = `https://duckduckgo.com/?q=${encodeURIComponent(optionText)}`;
                        ddgLink.textContent = 'DDG';
                        ddgLink.target = '_blank';
                        ddgLink.rel = 'noopener noreferrer';
                        ddgLink.classList.add('uets-ddg-link', 'uets-ddg-link-option-item');

                        const wrapper = document.createElement('div');
                        wrapper.classList.add('uets-option-wrapper');
                        wrapper.style.flexBasis = button.style.flexBasis || '100%';

                        if (button.parentNode) {
                            button.parentNode.insertBefore(wrapper, button);
                            wrapper.appendChild(button);
                            wrapper.appendChild(ddgLink);
                            sharedState.elementsToCleanup.push(wrapper);
                        }
                        button.style.maxWidth = '100%';
                    }
                });
            }, 50);
        },

        checkPageInfoAndReprocess: () => {
            const pageInfoElement = document.querySelector(quizizzModule.selectors.pageInfo);
            let currentPageInfoText = pageInfoElement ? pageInfoElement.textContent.trim() : "";

            if (currentPageInfoText !== quizizzModule.lastPageInfo) {
                quizizzModule.lastPageInfo = currentPageInfoText;
                quizizzModule.extractAndProcess();
            }
        },

        initialize: () => {
            // Reset the last page info to force initial processing
            quizizzModule.lastPageInfo = "INITIAL_STATE";

            if (sharedState.observer) sharedState.observer.disconnect();

            sharedState.observer = new MutationObserver(quizizzModule.debounce(() => {
                if (sharedState.uiModificationsEnabled) {
                    quizizzModule.checkPageInfoAndReprocess();
                }
            }, 500));

            sharedState.observer.observe(document.body, { childList: true, subtree: true });

            // Force initial processing
            if (sharedState.uiModificationsEnabled) {
                quizizzModule.extractAndProcess();
            }
        }
    };

    // TESTPORTAL MODULE
    const testportalModule = {
        customRegExpTestFunction: function (s) {
            const string = this.toString();
            if (string.includes("native code") && string.includes("function")) {
                return true;
            }
            return sharedState.originalRegExpTest.call(this, s);
        },

        processQuestionElement: (qEssenceEl) => {
            if (!sharedState.uiModificationsEnabled || qEssenceEl.dataset.enhancementsAdded) return;

            let questionTextContent = (qEssenceEl.innerText || qEssenceEl.textContent || "").trim();
            if (!questionTextContent) return;

            const questionContainer = qEssenceEl.closest('.question_container_wrapper, .question-view, .question-content, form, div.row, .question_row_content_container, .question_item_view_v2, .q_tresc_pytania_mock, .question_essence_fs');
            let answerElements = [];

            if (questionContainer) {
                answerElements = Array.from(questionContainer.querySelectorAll(".answer_body, .answer-body, .odpowiedz_tresc"));
            } else {
                const formElement = qEssenceEl.closest('form');
                if (formElement) {
                    answerElements = Array.from(formElement.querySelectorAll(".answer_body, .answer-body, .odpowiedz_tresc"));
                }
            }

            const options = answerElements
                .map(optEl => (optEl.innerText || optEl.textContent || "").trim())
                .filter(Boolean);

            let questionImageElement = qEssenceEl.querySelector('img');
            if (!questionImageElement && questionContainer) {
                questionImageElement = questionContainer.querySelector('img.question-image, img.question_image_preview, .question_media img, .question-body__attachment img, .image_area img');
            }

            const imageUrl = questionImageElement ? questionImageElement.src : null;
            const buttonContainer = document.createElement('span');
            buttonContainer.style.marginLeft = "15px";
            buttonContainer.classList.add('uets-multitool-button-container');

            const aiButton = document.createElement('button');
            aiButton.textContent = "Ask AI";
            aiButton.title = "Analyze question with AI";
            aiButton.classList.add('uets-ai-button');
            aiButton.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                let imageData = null;
                if (imageUrl) {
                    try {
                        imageData = await fetchImageAsBase64(imageUrl);
                    } catch (error) {
                        // Continue without image
                    }
                }
                askGemini(questionTextContent, options, imageData, 'test');
            };
            buttonContainer.appendChild(aiButton);

            const ddgButton = document.createElement('button');
            ddgButton.textContent = "DDG";
            ddgButton.title = "Search this question on DuckDuckGo";
            ddgButton.classList.add('uets-ddg-button');
            ddgButton.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(`https://duckduckgo.com/?q=${encodeURIComponent(questionTextContent)}`, '_blank');
            };
            buttonContainer.appendChild(ddgButton);

            qEssenceEl.appendChild(buttonContainer);
            sharedState.elementsToCleanup.push(buttonContainer);

            qEssenceEl.dataset.enhancementsAdded = "true";
        },

        enhanceAllExistingQuestions: () => {
            if (!sharedState.uiModificationsEnabled) return;
            const qElements = document.getElementsByClassName("question_essence");
            for (const qEl of qElements) {
                testportalModule.processQuestionElement(qEl);
            }
        },

        initialize: () => {
            if (sharedState.uiModificationsEnabled) {
                RegExp.prototype.test = testportalModule.customRegExpTestFunction;
                testportalModule.enhanceAllExistingQuestions();

                if (sharedState.observer) sharedState.observer.disconnect();

                sharedState.observer = new MutationObserver((mutationsList) => {
                    if (!sharedState.uiModificationsEnabled) return;
                    for (const mutation of mutationsList) {
                        if (mutation.type === 'childList') {
                            for (const node of mutation.addedNodes) {
                                if (node.nodeType === Node.ELEMENT_NODE) {
                                    if (node.classList && (node.classList.contains('question_essence') || node.querySelector('.question_essence'))) {
                                        if (node.classList.contains('question_essence')) {
                                            testportalModule.processQuestionElement(node);
                                        } else {
                                            const qElements = node.getElementsByClassName('question_essence');
                                            for (const qEl of qElements) {
                                                testportalModule.processQuestionElement(qEl);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                });

                sharedState.observer.observe(document.body, { childList: true, subtree: true });
            } else {
                RegExp.prototype.test = sharedState.originalRegExpTest;
            }
        }
    };

    // GOOGLE FORMS MODULE
    const googleFormsModule = {
        handleCopyClick: (event) => {
            event.preventDefault();
            const button = event.target;
            const questionBlock = button.closest('div[jsmodel]');
            if (!questionBlock) return;

            const questionTitleEl = questionBlock.querySelector('div[role="heading"] > span:first-child');
            const questionTitle = questionTitleEl ? questionTitleEl.textContent.trim() : 'Question not found';

            let promptText = '';
            let questionType = 'Unknown Type';
            let options = [];

            const radioOptions = questionBlock.querySelectorAll('div[role="radio"]');
            if (radioOptions.length > 0) {
                questionType = 'Single Choice';
                radioOptions.forEach(radio => {
                    const label = radio.getAttribute('aria-label');
                    if (label) options.push(`- ${label}`);
                });
            } else {
                const checkOptions = questionBlock.querySelectorAll('div[role="checkbox"]');
                if (checkOptions.length > 0) {
                    questionType = 'Multi Choice (Select all that apply)';
                    checkOptions.forEach(check => {
                        const label = check.getAttribute('aria-label') || check.getAttribute('data-answer-value');
                        if (label) options.push(`- ${label}`);
                    });
                } else {
                    const textInput = questionBlock.querySelector('div[role="textbox"], textarea, input[type="text"]');
                    if (textInput) {
                        questionType = 'Free Text';
                    }
                }
            }

            promptText = `[${questionType}]\nQuestion: ${questionTitle}`;
            if (options.length > 0) {
                promptText += '\n\nOptions:\n' + options.join('\n');
            }

            const instructionText = "Reply with the correct answer and a quick reasoning why it is the correct answer. Don't over-complicate stuff.";
            promptText += `\n\n${instructionText}`;

            GM_setClipboard(promptText);

            const originalText = button.textContent;
            button.textContent = 'Copied!';
            button.disabled = true;
            setTimeout(() => {
                button.textContent = originalText;
                button.disabled = false;
            }, 1500);
        },

        handleAiClick: async (event) => {
            event.preventDefault();
            const button = event.target;
            const questionBlock = button.closest('div[jsmodel]');
            if (!questionBlock) return;

            const questionTitleEl = questionBlock.querySelector('div[role="heading"] > span:first-child');
            const questionTitle = questionTitleEl ? questionTitleEl.textContent.trim() : 'Question not found';

            let options = [];

            const radioOptions = questionBlock.querySelectorAll('div[role="radio"]');
            if (radioOptions.length > 0) {
                radioOptions.forEach(radio => {
                    const label = radio.getAttribute('aria-label');
                    if (label) options.push(label);
                });
            } else {
                const checkOptions = questionBlock.querySelectorAll('div[role="checkbox"]');
                if (checkOptions.length > 0) {
                    checkOptions.forEach(check => {
                        const label = check.getAttribute('aria-label') || check.getAttribute('data-answer-value');
                        if (label) options.push(label);
                    });
                }
            }

            askGemini(questionTitle, options, null, 'form');
        },

        handleDdgClick: (event) => {
            event.preventDefault();
            const button = event.target;
            const questionBlock = button.closest('div[jsmodel]');
            if (!questionBlock) return;

            const questionTitleEl = questionBlock.querySelector('div[role="heading"] > span:first-child');
            const questionTitle = questionTitleEl ? questionTitleEl.textContent.trim() : 'Question not found';

            window.open(`https://duckduckgo.com/?q=${encodeURIComponent(questionTitle)}`, '_blank');
        },

        addButtons: () => {
            if (!sharedState.uiModificationsEnabled) return;

            const questionBlocks = document.querySelectorAll('div[role="listitem"] > div[jsmodel]');

            questionBlocks.forEach(block => {
                if (block.dataset.uetsButtonsAdded) return;
                block.dataset.uetsButtonsAdded = 'true';

                const headingContainer = block.querySelector('div[role="heading"]');
                if (!headingContainer) return;

                // Copy button
                const copyButton = document.createElement('button');
                copyButton.textContent = 'Copy';
                copyButton.className = 'gform-copy-button';
                copyButton.onclick = googleFormsModule.handleCopyClick;
                headingContainer.appendChild(copyButton);
                sharedState.elementsToCleanup.push(copyButton);

                // Ask AI button
                const aiButton = document.createElement('button');
                aiButton.textContent = 'Ask AI';
                aiButton.classList.add('uets-ai-button');
                aiButton.onclick = googleFormsModule.handleAiClick;
                headingContainer.appendChild(aiButton);
                sharedState.elementsToCleanup.push(aiButton);

                // DDG button
                const ddgButton = document.createElement('button');
                ddgButton.textContent = 'DDG';
                ddgButton.classList.add('uets-ddg-button');
                ddgButton.onclick = googleFormsModule.handleDdgClick;
                headingContainer.appendChild(ddgButton);
                sharedState.elementsToCleanup.push(ddgButton);
            });
        },

        initialize: () => {
            if (sharedState.observer) sharedState.observer.disconnect();

            sharedState.observer = new MutationObserver(() => {
                googleFormsModule.addButtons();
            });

            sharedState.observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            googleFormsModule.addButtons();
        }
    };

    // === DOMAIN DETECTION AND INITIALIZATION ===
    const initializeDomainSpecific = () => {
        const hostname = window.location.hostname;

        if (hostname.includes('quizizz.com') || hostname.includes('wayground.com')) {
            GM_log('Initializing Quizizz/Wayground module');
            quizizzModule.initialize();
        } else if (hostname.includes('testportal.net') || hostname.includes('testportal.pl')) {
            GM_log('Initializing Testportal module');
            testportalModule.initialize();
        } else if (hostname.includes('docs.google.com') && window.location.pathname.includes('/forms/')) {
            GM_log('Initializing Google Forms module');
            googleFormsModule.initialize();
        }
    };

    // === MAIN INITIALIZATION ===
    const main = () => {
        createToggleButton();
        initializeDomainSpecific();
        GM_log(`Universal Educational Tool Suite loaded on ${sharedState.currentDomain}`);
    };

    if (document.body) {
        main();
    } else {
        window.addEventListener('DOMContentLoaded', main);
    }

})();
