// ==UserScript==
// @name         Zawodowe Correct Answer Toast
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @author       Nyx
// @license      GPL-3.0
// @description  Display the correct answer label for exam questions.
// @match        https://zawodowe.edu.pl/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/nyxiereal/userfiles/master/zeuv.user.js
// @updateURL    https://raw.githubusercontent.com/nyxiereal/userfiles/master/zeuv.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const TARGET_PATH = '/egzamin/';
    let lastSlug = null;

    const showToast = (label) => {
        const toast = document.createElement('div');
        toast.textContent = label;
        toast.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      padding: 8px 14px;
      background: #dbdbdb;
      color: #fff;
      font-size: 20px;
      font-weight: 600;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 9999;
    `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 750);
    };

    const handlePayload = (payload) => {
        if (!payload?.question) return;
        if (payload.question.slug === lastSlug) return;
        const correct = payload.question.answers?.find((a) => a.is_correct);
        if (correct?.label) {
            lastSlug = payload.question.slug;
            showToast(correct.label);
        }
    };

    const tryParseJSON = (text) => {
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    };

    const interceptFetch = () => {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const response = await originalFetch(...args);
            const url = response.url || args[0];
            if (typeof url === 'string' && url.includes(TARGET_PATH)) {
                response.clone().text().then((text) => {
                    const data = tryParseJSON(text);
                    handlePayload(data);
                });
            }
            return response;
        };
    };

    const interceptXHR = () => {
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this.__targetUrl = url;
            return originalOpen.call(this, method, url, ...rest);
        };

        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (...args) {
            this.addEventListener('load', () => {
                const url = this.__targetUrl;
                if (typeof url === 'string' && url.includes(TARGET_PATH)) {
                    const data = tryParseJSON(this.responseText);
                    handlePayload(data);
                }
            });
            return originalSend.apply(this, args);
        };
    };

    interceptFetch();
    interceptXHR();
})();
