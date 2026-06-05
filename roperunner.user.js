// ==UserScript==
// @name         roperunner
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Naciśnij V na stronie egzaminu, aby pokazać ledwo widoczną literę odpowiedzi (A/B/C/D) w prawym górnym rogu. Prefetchuje odpowiedzi w tle.
// @author       Nyx & Kimi
// @match        https://zawodowe.edu.pl/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const CACHE_PREFIX = 'zah_cache_v3_';
    const MODEL = 'openai/gpt-5.4-nano';
    const OR_API = 'https://openrouter.ai/api/v1/chat/completions';

    // Config / Key Prompt
    function ensureApiKey() {
        let key = GM_getValue('openrouter_key', '');
        if (!key && !sessionStorage.getItem('zah_key_prompted')) {
            key = prompt('Zawodowe.edu.pl Answer Hint\n\nPodaj klucz API OpenRouter (zostanie zapisany przez Violentmonkey):');
            sessionStorage.setItem('zah_key_prompted', '1');
            if (key) {
                key = key.trim();
                GM_setValue('openrouter_key', key);
            }
        }
        return key;
    }
    ensureApiKey();

    GM_registerMenuCommand('Zawodowe: Ustaw klucz OpenRouter', () => {
        const key = prompt('Podaj klucz API OpenRouter:', GM_getValue('openrouter_key', ''));
        if (key !== null) GM_setValue('openrouter_key', key.trim());
    });

    GM_registerMenuCommand('Zawodowe: Wyczyść cache odpowiedzi', () => {
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
        });
        updateOverlay('--');
    });

    // UI
    const overlay = document.createElement('div');
    overlay.id = 'zah2-hint';
    overlay.style.cssText = `
        position: fixed;
        top: 8px;
        right: 8px;
        z-index: 2147483647;
        font-family: monospace;
        font-size: 12px;
        line-height: 1.4;
        color: rgba(128,128,128,0.40);
        background: transparent;
        pointer-events: auto;
        user-select: none;
        cursor: default;
        padding: 2px 6px;
        border-radius: 4px;
        transition: color 0.2s, background 0.2s;
    `;
    overlay.textContent = '--';
    overlay.title = 'Naciśnij V, aby pokazać odpowiedź';
    overlay.addEventListener('mouseenter', () => {
        overlay.style.color = 'rgba(220,220,220,0.85)';
        overlay.style.background = 'rgba(0,0,0,0.30)';
    });
    overlay.addEventListener('mouseleave', () => {
        overlay.style.color = 'rgba(128,128,128,0.30)';
        overlay.style.background = 'transparent';
    });
    document.body.appendChild(overlay);

    function updateOverlay(text) {
        overlay.textContent = text;
    }

    // DOM Extraction
    function extractQuestionFromDOM() {
        const qContent = document.querySelector('.question-content');
        if (!qContent) return null;
        const questionText = qContent.textContent.trim();

        const answerBtns = document.querySelectorAll('.answers .answer-btn');
        if (!answerBtns.length) return null;

        const answers = [];
        answerBtns.forEach(btn => {
            const span = btn.querySelector('span[itemprop="text"]');
            const fullText = span ? span.textContent.trim() : btn.textContent.trim();
            const m = fullText.match(/^([A-D])\.\s*(.*)$/);
            const label = m ? m[1] : '';
            const text = m ? m[2] : fullText;
            answers.push({ label, text, full: fullText });
        });

        return { content: questionText, answers };
    }

    function hashString(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = (h << 5) - h + str.charCodeAt(i);
            h |= 0;
        }
        return 'h' + Math.abs(h).toString(36);
    }

    function cacheKey(content) {
        return CACHE_PREFIX + hashString(content);
    }

    function getCached(content) {
        try { return localStorage.getItem(cacheKey(content)); } catch (e) { return null; }
    }

    function setCached(content, letter) {
        try { localStorage.setItem(cacheKey(content), letter); } catch (e) { }
    }

    function buildPrompt(q) {
        const lines = [];
        lines.push('Pytanie: ' + q.content);
        lines.push('');
        lines.push('Odpowiedzi:');
        for (const a of q.answers) {
            lines.push(a.label + '. ' + a.text);
        }
        lines.push('');
        lines.push('Podaj TYLKO literę poprawnej odpowiedzi (A, B, C lub D). Nie pisz nic więcej.');
        return lines.join('\n');
    }

    function parseLetter(raw) {
        if (!raw) return null;
        const txt = raw.trim();
        const m = txt.match(/\b([A-D])\b/i);
        if (m) return m[1].toUpperCase();
        const first = txt.charAt(0).toUpperCase();
        if (/[A-D]/.test(first)) return first;
        return null;
    }

    // API
    function askOpenRouter(content, promptText) {
        const key = GM_getValue('openrouter_key', '');
        if (!key) {
            updateOverlay('!!');
            console.warn('[ZAH] Brak klucza API.');
            return;
        }
        const id = hashString(content);
        if (!window._zah_pending) window._zah_pending = new Set();
        if (window._zah_pending.has(id)) return;
        window._zah_pending.add(id);

        GM_xmlhttpRequest({
            method: 'POST',
            url: OR_API,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + key,
            },
            data: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: 'Jesteś asystentem egzaminacyjnym. Odpowiadasz wyłącznie jedną literą: A, B, C lub D.' },
                    { role: 'user', content: promptText }
                ],
                max_tokens: 16,
                temperature: 0.1
            }),
            onload: (resp) => {
                window._zah_pending.delete(id);
                let letter = null;
                try {
                    const json = JSON.parse(resp.responseText);
                    if (json.error) {
                        console.warn('[ZAH] API error:', json.error);
                        return;
                    }
                    const raw = json.choices?.[0]?.message?.content;
                    letter = parseLetter(raw);
                } catch (e) {
                    console.warn('[ZAH] Parse error', e, resp.responseText);
                }
                if (letter) {
                    setCached(content, letter);
                    // Only update overlay if this answer still matches the currently visible question
                    const cur = extractQuestionFromDOM();
                    if (cur && hashString(cur.content) === hashString(content)) {
                        updateOverlay(letter);
                    }
                }
            },
            onerror: (err) => {
                window._zah_pending.delete(id);
                console.warn('[ZAH] Network error', err);
            }
        });
    }

    // Handler
    function processQuestion({ showSpinner = false } = {}) {
        const q = extractQuestionFromDOM();
        if (!q) {
            updateOverlay('--');
            return;
        }
        const cached = getCached(q.content);
        if (cached) {
            updateOverlay(cached);
            return;
        }
        if (showSpinner) updateOverlay('...');
        const prompt = buildPrompt(q);
        askOpenRouter(q.content, prompt);
    }

    function handleShowAnswer() {
        console.log('[ZAH] V pressed');
        processQuestion({ showSpinner: true });
    }

    // Keyboard
    document.addEventListener('keydown', (e) => {
        const tag = e.target?.tagName;
        const editable = e.target?.isContentEditable;
        if (editable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'v' || e.key === 'V') {
            e.preventDefault();
            handleShowAnswer();
        }
    });

    // Auto-fetch on question change
    let autoFetchTimer = null;
    function onQuestionChange() {
        updateOverlay('--');
        clearTimeout(autoFetchTimer);
        autoFetchTimer = setTimeout(() => {
            processQuestion({ showSpinner: false }); // background prefetch, no spinner
        }, 400);
    }

    const qContainer = document.getElementById('questionContainer');
    if (qContainer) {
        const observer = new MutationObserver(onQuestionChange);
        observer.observe(qContainer, { childList: true, subtree: true });
    }

    // Also reset immediately on question button click
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('question-btn') || e.target.closest('.question-btn')) {
            updateOverlay('--');
        }
    });
})();
