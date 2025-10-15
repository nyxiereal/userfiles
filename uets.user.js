// ==UserScript==
// @name         Universal Educational Tool Suite
// @namespace    http://tampermonkey.net/
// @version      1.3.4
// @description  A unified tool for cheating on online test sites
// @author       Nyx
// @license      GPL-3.0
// @match        https://quizizz.com/*
// @match        https://wayground.com/*
// @match        https://*.quizizz.com/*
// @match        https://*.wayground.com/*
// @match        https://*.testportal.net/*
// @match        https://*.testportal.pl/*
// @match        https://docs.google.com/forms/*
// @match        *://kahoot.it/*
// @grant        GM_addStyle
// @grant        GM_log
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @connect      *
// @downloadURL  https://raw.githubusercontent.com/nyxiereal/userfiles/master/uets.user.js
// @updateURL    https://raw.githubusercontent.com/nyxiereal/userfiles/master/uets.meta.js
// ==/UserScript==

(function () {
  "use strict";

  // === SHARED CONSTANTS ===
  const GEMINI_API_KEY_STORAGE = "UETS_GEMINI_API_KEY";
  const UI_MODS_ENABLED_KEY = "uets_ui_modifications_enabled";
  const CONFIG_STORAGE_KEY = "UETS_CONFIG";
  const DEFAULT_CONFIG = {
    enableTimeTakenEdit: true,
    timeTakenMin: 5067,
    timeTakenMax: 7067,
    enableTimerHijack: true,
    timerBonusPoints: 270,
    enableSpoofFullscreen: true,
    serverUrl: "https://uets.meowery.eu",
    geminiApiKey: "",
    geminiModel: "gemini-2.5-flash",
    thinkingBudget: 256,
    maxOutputTokens: 1024,
    temperature: 0.2,
    topP: 0.95,
    topK: 64,
    includeImages: true,
    enableReactionSpam: true,
    reactionSpamCount: 1,
    reactionSpamDelay: 2000
  };

  const PROFILES = {
    "True Stealth": {
      enableTimeTakenEdit: false,
      enableTimerHijack: false,
      enableSpoofFullscreen: true,
      enableReactionSpam: false,
    },
    "Stealthy Extended": {
      enableTimeTakenEdit: true,
      timeTakenMin: 8000,
      timeTakenMax: 14000,
      enableTimerHijack: true,
      timerBonusPoints: 200,
      enableSpoofFullscreen: true,
      enableReactionSpam: false,
    },
    "Creator's choice": {
      enableTimeTakenEdit: true,
      timeTakenMin: 6000,
      timeTakenMax: 8000,
      enableTimerHijack: true,
      timerBonusPoints: 270,
      enableSpoofFullscreen: true,
      enableReactionSpam: false,
    },
    "LMAO": {
      enableTimeTakenEdit: true,
      timeTakenMin: 1000,
      timeTakenMax: 2000,
      enableTimerHijack: true,
      timerBonusPoints: 5000,
      enableSpoofFullscreen: true,
      enableReactionSpam: true,
      reactionSpamCount: 2,
      reactionSpamDelay: 500
    },
  };

  // === SHARED STATE ===
  const sharedState = {
    uiModificationsEnabled: GM_getValue(UI_MODS_ENABLED_KEY, true),
    toggleButton: null,
    geminiPopup: null,
    elementsToCleanup: [],
    observer: null,
    currentDomain: window.location.hostname,
    originalRegExpTest: RegExp.prototype.test,
    quizData: {},
    currentQuestionId: null,
    questionsPool: {},
    config: GM_getValue(CONFIG_STORAGE_KEY, DEFAULT_CONFIG),
    configGui: null,
    holdTimeout: null,
    originalTabLeaveHTML: null,
    originalStartButtonText: null,
    firstRunKey: "UETS_FIRST_RUN",
    kahootSocket: null,
    kahootClientId: null,
    kahootGameId: null,
    kahootCurrentQuestion: null,
    kahootAnswerCounts: {},
    kahootHasConnected: false
  };

  // === SHARED STYLES ===
  GM_addStyle(`
  @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;600;700&display=swap');
  @import url('https://fonts.googleapis.com/icon?family=Material+Icons+Outlined');

  :root {
    --md-primary: #6750A4;
    --md-primary-container: #EADDFF;
    --md-on-primary: #FFFFFF;
    --md-on-primary-container: #21005D;
    --md-secondary: #625B71;
    --md-secondary-container: #E8DEF8;
    --md-on-secondary: #FFFFFF;
    --md-on-secondary-container: #1D192B;
    --md-tertiary: #7D5260;
    --md-tertiary-container: #FFD8E4;
    --md-on-tertiary: #FFFFFF;
    --md-on-tertiary-container: #31111D;
    --md-surface: #FEF7FF;
    --md-surface-dim: #DED8E1;
    --md-surface-bright: #FEF7FF;
    --md-surface-container-lowest: #FFFFFF;
    --md-surface-container-low: #F7F2FA;
    --md-surface-container: #F1ECF4;
    --md-surface-container-high: #ECE6F0;
    --md-surface-container-highest: #E6E0E9;
    --md-on-surface: #1C1B1F;
    --md-on-surface-variant: #49454F;
    --md-outline: #79747E;
    --md-outline-variant: #CAC4D0;
    --md-error: #B3261E;
    --md-error-container: #F9DEDC;
    --md-on-error: #FFFFFF;
    --md-on-error-container: #410E0B;
    --md-shadow: #000000;
  }

  .uets-card {
    background: var(--md-surface-container);
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
    overflow: hidden;
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
  }

  .uets-elevated-card {
    background: var(--md-surface-container-low);
    border-radius: 12px;
    box-shadow: 0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23);
    overflow: hidden;
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
  }

  .uets-filled-button {
    background: var(--md-primary);
    color: var(--md-on-primary);
    border: none;
    border-radius: 20px;
    padding: 10px 24px;
    font-family: 'Roboto', sans-serif;
    font-weight: 500;
    font-size: 14px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    text-decoration: none;
    min-height: 40px;
    justify-content: center;
  }

  .uets-filled-button:hover {
    box-shadow: 0 2px 4px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
    transform: translateY(-1px);
  }

  .uets-filled-button:active {
    transform: translateY(0px);
    box-shadow: 0 1px 2px rgba(0,0,0,0.12);
  }

  .uets-outlined-button {
    background: transparent;
    color: var(--md-primary);
    border: 1px solid var(--md-outline);
    border-radius: 20px;
    padding: 10px 24px;
    font-family: 'Roboto', sans-serif;
    font-weight: 500;
    font-size: 14px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    text-decoration: none;
    min-height: 40px;
    justify-content: center;
  }

  .uets-outlined-button:hover {
    background: rgba(103, 80, 164, 0.08);
    border-color: var(--md-primary);
  }

  .uets-text-button {
    background: transparent;
    color: var(--md-primary);
    border: none;
    border-radius: 20px;
    padding: 10px 12px;
    font-family: 'Roboto', sans-serif;
    font-weight: 500;
    font-size: 14px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    text-decoration: none;
    min-height: 40px;
    justify-content: center;
  }

  .uets-text-button:hover {
    background: rgba(103, 80, 164, 0.08);
  }

  .uets-fab {
    background: var(--md-primary-container);
    color: var(--md-on-primary-container);
    border: none;
    border-radius: 16px;
    width: 56px;
    height: 56px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 3px 5px rgba(0,0,0,0.2), 0 6px 10px rgba(0,0,0,0.14), 0 1px 18px rgba(0,0,0,0.12);
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    font-size: 24px;
  }

  .uets-fab:hover {
    box-shadow: 0 5px 5px rgba(0,0,0,0.2), 0 9px 18px rgba(0,0,0,0.14), 0 3px 14px rgba(0,0,0,0.12);
    transform: scale(1.05);
  }

  .uets-fab.uets-mods-hidden-state {
    background: transparent;
    box-shadow: none;
  }

  .uets-fab.uets-mods-hidden-state:hover {
    background: rgba(103, 80, 164, 0.08);
    box-shadow: none;
    transform: scale(1.05);
  }

  .uets-success-button {
    background: #a6e3a1;
    color: white;
  }

  .uets-warning-button {
    background: #fab387;
    color: white;
  }

  .uets-purple-button {
    background: #cba6f7;
    color: white;
  }

  .uets-ddg-link, .uets-gemini-button, .uets-copy-prompt-button, .uets-ai-button, .uets-ddg-button, .uets-get-answer-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    color: var(--md-on-primary);
    text-decoration: none;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    text-align: center;
    vertical-align: middle;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    border: none;
    font-family: 'Roboto', sans-serif;
    min-height: 40px;
    margin: 1px;
    justify-content: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
  }

  .uets-ddg-link:hover, .uets-gemini-button:hover, .uets-copy-prompt-button:hover,
  .uets-ai-button:hover, .uets-ddg-button:hover, .uets-get-answer-button:hover {
    box-shadow: 0 4px 8px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.1);
    transform: translateY(-2px);
  }

  .uets-ddg-link, .uets-ddg-button { 
    background: #a6e3a1 !important;
    color: white !important;
  }

  .uets-gemini-button, .uets-ai-button { 
    background: #74c7ec !important;
    color: white !important;
  }

  .uets-copy-prompt-button { 
    background: #fab387 !important;
    color: white !important;
  }

  .uets-get-answer-button { 
    background: #cba6f7 !important;
    color: white !important;
  }

  .uets-ddg-link::before, .uets-ddg-button::before {
    content: 'search';
    font-family: 'Material Icons Outlined';
    font-size: 18px;
  }

  .uets-gemini-button::before, .uets-ai-button::before {
    content: 'psychology';
    font-family: 'Material Icons Outlined';
    font-size: 18px;
  }

  .uets-copy-prompt-button::before {
    content: 'content_copy';
    font-family: 'Material Icons Outlined';
    font-size: 18px;
  }

  .uets-get-answer-button::before {
    content: 'lightbulb';
    font-family: 'Material Icons Outlined';
    font-size: 18px;
  }

  .uets-option-wrapper {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: space-between;
    height: 100%;
  }

  .uets-option-wrapper > button.option {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    min-height: 0;
    width: 100%;
  }

  .uets-ddg-link-option-item {
    width: 100%;
    box-sizing: border-box;
    margin-top: 12px;
    padding: 8px 0;
    border-radius: 0 0 12px 12px;
    flex-shrink: 0;
  }

  .uets-main-question-buttons-container {
    display: flex;
    justify-content: center;
    gap: 4px;
    background: #313244;
    border-radius: 12px;
    margin: 1px;
    flex-wrap: wrap;
    padding: 2px;
  }

  .uets-response-popup {
    position: fixed;
    top: 20%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--md-surface-container-high);
    color: var(--md-on-surface);
    border-radius: 28px;
    padding: 0;
    z-index: 10004;
    min-width: 320px;
    max-width: 90vh;
    max-height: 80vh;
    overflow: hidden;
    box-shadow: 0 10px 25px rgba(0,0,0,0.35), 0 6px 10px rgba(0,0,0,0.25);
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 14px;
  }

  .uets-welcome-popup {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--md-surface-container-high);
    color: var(--md-on-surface);
    border-radius: 28px;
    padding: 0;
    z-index: 10004;
    min-width: 320px;
    max-width: 90vh;
    max-height: 80vh;
    overflow: hidden;
    box-shadow: 0 10px 25px rgba(0,0,0,0.35), 0 6px 10px rgba(0,0,0,0.25);
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif !important;
    font-size: 18px;
  }

  .uets-response-popup-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24px 24px 0 24px;
    margin-bottom: 16px;
  }

  .uets-response-popup-title {
    font-weight: 600;
    font-size: 22px;
    color: var(--md-on-surface);
    line-height: 28px;
  }

  .uets-response-popup-close {
    background: none;
    border: none;
    width: 48px;
    height: 48px;
    border-radius: 24px;
    cursor: pointer;
    color: var(--md-on-surface-variant);
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Material Icons Outlined';
    font-size: 24px;
  }

  .uets-response-popup-close::before {
    content: 'close';
  }

  .uets-response-popup-close:hover {
    background: rgba(103, 80, 164, 0.08);
    color: var(--md-primary);
  }

  .uets-response-popup-content {
    white-space: pre-wrap;
    font-size: 14px;
    line-height: 20px;
    color: var(--md-on-surface);
    padding: 0 24px 24px 24px;
    max-height: calc(80vh - 120px);
    overflow-y: auto;
  }

  .uets-response-popup-content strong,
  .uets-response-popup-content b {
    color: var(--md-primary);
    font-weight: 600;
  }

  .uets-response-popup-loading {
    text-align: center;
    font-style: normal;
    color: var(--md-on-surface-variant);
    padding: 40px 24px;
    font-size: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .uets-loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--md-outline-variant);
    border-top: 3px solid var(--md-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  #uets-toggle-ui-button {
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 10002;
    background: var(--md-primary-container);
    color: var(--md-on-primary-container);
    border: none;
    border-radius: 16px;
    width: 56px;
    height: 56px;
    cursor: pointer;
    box-shadow: 0 3px 5px rgba(0,0,0,0.2), 0 6px 10px rgba(0,0,0,0.14), 0 1px 18px rgba(0,0,0,0.12);
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Material Icons Outlined';
    font-size: 24px;
  }

  #uets-toggle-ui-button:hover {
    box-shadow: 0 5px 5px rgba(0,0,0,0.2), 0 9px 18px rgba(0,0,0,0.14), 0 3px 14px rgba(0,0,0,0.12);
    transform: scale(1.05);
  }

  #uets-toggle-ui-button.uets-mods-hidden-state {
    background: transparent;
    box-shadow: none;
  }

  #uets-toggle-ui-button.uets-mods-hidden-state:hover {
    background: rgba(103, 80, 164, 0.08);
    box-shadow: none;
  }

  .uets-correct-answer {
    background: rgba(76, 175, 80, 0.12) !important;
    border: 2px solid #4CAF50 !important;
    border-radius: 12px !important;
  }

  .uets-answer-indicator {
    position: absolute;
    top: 8px;
    right: 8px;
    background: #4CAF50;
    color: white;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
    z-index: 1000;
    font-family: 'Material Icons Outlined';
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .uets-answer-indicator::before {
    content: 'check';
    font-size: 16px;
  }

  .uets-streak-bonus {
    margin-left: 8px;
    color: #FFD700;
    font-weight: 600;
    font-size: 14px;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
    font-family: 'Roboto', sans-serif;
  }

  .uets-config-gui {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--md-surface);
    color: var(--md-on-surface);
    border-radius: 28px;
    padding: 0;
    z-index: 10003;
    width: 640px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: hidden;
    box-shadow: 0 24px 38px rgba(0,0,0,0.14), 0 9px 46px rgba(0,0,0,0.12), 0 11px 15px rgba(0,0,0,0.20);
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
  }

  .uets-config-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24px 24px 12px 24px;
    border-bottom: 1px solid var(--md-outline-variant);
  }

  .uets-config-title {
    font-size: 24px;
    font-weight: 400;
    color: var(--md-on-surface);
    line-height: 32px;
    letter-spacing: 0px;
  }

  .uets-config-close {
    background: none;
    border: none;
    width: 40px;
    height: 40px;
    border-radius: 20px;
    cursor: pointer;
    color: var(--md-on-surface-variant);
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Material Icons Outlined';
    font-size: 20px;
  }

  .uets-config-close::before {
    content: 'close';
  }

  .uets-config-close:hover {
    background: var(--md-surface-container-highest);
    color: var(--md-on-surface);
  }

  .uets-config-content {
    max-height: calc(90vh - 200px);
    overflow-y: auto;
  }

  .uets-config-section {
    margin-bottom: 8px;
    padding: 16px 24px;
  }

  .uets-config-section-title {
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 16px;
    color: var(--md-primary);
    line-height: 24px;
    letter-spacing: 0.1px;
  }

  .uets-config-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    min-height: 56px;
  }

  .uets-config-label-container {
    display: flex;
    align-items: center;
    flex: 1;
    margin-right: 16px;
  }

  .uets-config-label {
    font-size: 16px;
    font-weight: 400;
    color: var(--md-on-surface);
    margin-left: 12px;
    line-height: 24px;
    letter-spacing: 0.5px;
  }

  .uets-config-input, .uets-config-select {
    background: var(--md-surface-container-highest);
    border: 1px solid var(--md-outline);
    border-radius: 4px;
    padding: 16px;
    color: var(--md-on-surface);
    font-size: 16px;
    font-family: 'Roboto', sans-serif;
    width: 200px;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    box-sizing: border-box;
  }

  .uets-config-input:focus, .uets-config-select:focus {
    outline: none;
    border-color: var(--md-primary);
    border-width: 2px;
    padding: 15px;
  }

  .uets-config-input:disabled {
    background: var(--md-surface-variant);
    color: var(--md-on-surface-variant);
    border-color: var(--md-outline-variant);
  }

  .uets-switch {
    position: relative;
    display: inline-block;
    width: 52px;
    height: 32px;
    cursor: pointer;
  }

  .uets-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .uets-switch-slider {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--md-outline);
    border-radius: 16px;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    border: 2px solid var(--md-outline);
  }

  .uets-switch-slider:before {
    position: absolute;
    content: "";
    height: 20px;
    width: 20px;
    left: 4px;
    bottom: 4px;
    background: var(--md-surface-container-highest);
    border-radius: 50%;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }

  .uets-switch input:checked + .uets-switch-slider {
    background: var(--md-primary);
    border-color: var(--md-primary);
  }

  .uets-switch input:checked + .uets-switch-slider:before {
    transform: translateX(20px);
    background: var(--md-on-primary);
  }

  .uets-switch:hover .uets-switch-slider {
    box-shadow: 0 0 0 8px rgba(103, 80, 164, 0.04);
  }

  .uets-switch input:checked:hover + .uets-switch-slider {
    box-shadow: 0 0 0 8px rgba(103, 80, 164, 0.08);
  }

  .uets-config-info {
    background: var(--md-secondary-container);
    color: var(--md-on-secondary-container);
    border: none;
    border-radius: 50%;
    width: 22px;
    height: 22px;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Material Icons Outlined';
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    font-weight: 500;
  }

  .uets-config-info::before {
    content: 'help';
    font-size: 20px;
  }

  .uets-config-info:hover {
    background: var(--md-secondary);
    color: var(--md-on-secondary);
    transform: scale(1.1);
  }

  .uets-config-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 24px 24px 24px;
    border-top: 1px solid var(--md-outline-variant);
    background: var(--md-surface-container-low);
  }

  .uets-config-button {
    padding: 10px 24px;
    border: none;
    border-radius: 20px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    font-family: 'Roboto', sans-serif;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    justify-content: center;
    letter-spacing: 0.1px;
  }

  .uets-config-save {
    background: var(--md-primary);
    color: var(--md-on-primary);
  }

  .uets-config-save::before {
    content: 'save';
    font-family: 'Material Icons Outlined';
    font-size: 18px;
  }

  .uets-config-save:hover {
    box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
    background: #5a4089;
  }

  .uets-config-reset {
    background: var(--md-error);
    color: var(--md-on-error);
  }

  .uets-config-reset::before {
    content: 'refresh';
    font-family: 'Material Icons Outlined';
    font-size: 18px;
  }

  .uets-config-reset:hover {
    box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
    background: #a02117;
  }

  .uets-config-cancel {
    background: transparent;
    color: var(--md-primary);
    border: 1px solid var(--md-outline);
  }

  .uets-config-cancel::before {
    content: 'cancel';
    font-family: 'Material Icons Outlined';
    font-size: 18px;
  }

  .uets-config-cancel:hover {
    background: var(--md-surface-container-highest);
    border-color: var(--md-primary);
  }

  .uets-config-content::-webkit-scrollbar {
    width: 8px;
  }

  .uets-config-content::-webkit-scrollbar-track {
    background: var(--md-surface-container-low);
  }

  .uets-config-content::-webkit-scrollbar-thumb {
    background: var(--md-outline-variant);
    border-radius: 4px;
  }

  .uets-config-content::-webkit-scrollbar-thumb:hover {
    background: var(--md-outline);
  }

  .uets-profile-selector {
    margin: 4px 4px 4px 4px;
    padding: 16px;
    background: var(--md-surface-container-low);
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  }

  .uets-profile-list {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--md-outline-variant) transparent;
  }

  .uets-profile-list::-webkit-scrollbar {
    height: 6px;
  }

  .uets-profile-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .uets-profile-list::-webkit-scrollbar-thumb {
    background: var(--md-outline-variant);
    border-radius: 3px;
  }

  .uets-profile-list::-webkit-scrollbar-thumb:hover {
    background: var(--md-outline);
  }

  .uets-profile-button {
    background: var(--md-surface-container-highest);
    color: var(--md-on-surface);
    border: 1px solid var(--md-outline);
    border-radius: 20px;
    padding: 8px 16px;
    font-family: 'Roboto', sans-serif;
    font-weight: 500;
    font-size: 14px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    flex-shrink: 0;
  }

  .uets-profile-button:hover {
    background: var(--md-surface-container);
    border-color: var(--md-primary);
  }

  .uets-profile-button.active {
    background: var(--md-primary);
    color: var(--md-on-primary);
    border-color: var(--md-primary);
  }

  .uets-profile-button.active:hover {
    background: #5a4089;
  }

  /* Dark mode overrides */
  @media (prefers-color-scheme: dark) {
    :root {
      --md-primary: #D0BCFF;
      --md-primary-container: #4F378B;
      --md-on-primary: #371E73;
      --md-on-primary-container: #EADDFF;
      --md-secondary: #CCC2DC;
      --md-secondary-container: #4A4458;
      --md-on-secondary: #332D41;
      --md-on-secondary-container: #E8DEF8;
      --md-tertiary: #EFB8C8;
      --md-tertiary-container: #633B48;
      --md-on-tertiary: #492532;
      --md-on-tertiary-container: #FFD8E4;
      --md-surface: #141218;
      --md-surface-dim: #141218;
      --md-surface-bright: #3B383E;
      --md-surface-container-lowest: #0F0D13;
      --md-surface-container-low: #1D1B20;
      --md-surface-container: #211F26;
      --md-surface-container-high: #2B2930;
      --md-surface-container-highest: #36343B;
      --md-on-surface: #E6E0E9;
      --md-on-surface-variant: #CAC4D0;
      --md-outline: #938F99;
      --md-outline-variant: #49454F;
      --md-error: #F2B8B5;
      --md-error-container: #8C1D18;
      --md-on-error: #601410;
      --md-on-error-container: #F9DEDC;
      --md-shadow: #000000;
    }
  }

  /* Add Kahoot-specific styles */
  .kahoot-answer-indicator {
    position: absolute;
    top: 12px;
    right: 18px;
    min-width: 24px;
    height: 24px;
    background: linear-gradient(135deg, rgba(0,0,0,0.85) 60%, rgba(0,0,0,0.7) 100%);
    color: #fff;
    padding: 0 8px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: bold;
    box-shadow: 0 2px 8px rgba(0,0,0,0.18);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #fff2;
    z-index: 1000;
    pointer-events: none;
    user-select: none;
    transition: transform 0.15s;
  }
  .kahoot-answer-button {
    position: relative;
  }

  .uets-testportal-invisible {
    opacity: 0 !important;
    pointer-events: auto !important;
  }
  `)

  // === WELCOME POPUP FOR NEW USERS ===
  const showWelcomePopup = () => {
    if (!sharedState.uiModificationsEnabled) return;

    const popup = document.createElement("div");
    popup.classList.add("uets-welcome-popup");
    popup.id = "uets-welcome-popup";

    const header = document.createElement("div");
    header.classList.add("uets-response-popup-header");

    const title = document.createElement("span");
    title.classList.add("uets-response-popup-title");
    title.textContent = "Welcome to UETS!";

    const closeButton = document.createElement("button");
    closeButton.classList.add("uets-response-popup-close");
    closeButton.onclick = () => popup.remove();

    header.appendChild(title);
    header.appendChild(closeButton);
    popup.appendChild(header);

    const content = document.createElement("div");
    content.classList.add("uets-response-popup-content");
    content.innerHTML = `<p>- Press the floating button (bottom-left) to activate/deactivate visual changes on the page.\n- Press and release the button 3 times within 2 seconds to open the settings menu.\n- In the settings, click on the info button on the left side of each option to get some insight into the setting.</p>`;
    popup.appendChild(content);

    document.body.appendChild(popup);
  };

  // === SHARED UTILITIES ===
  const createButton = (text, className, onClick) => {
    const button = document.createElement("button");
    button.textContent = text;
    button.classList.add(...className.split(" "));
    button.type = "button";
    button.onclick = onClick;
    return button;
  };

  const createLink = (text, href, className, onClick) => {
    const link = document.createElement("a");
    link.textContent = text;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.classList.add(...className.split(" "));
    if (onClick) link.onclick = onClick;
    return link;
  };

  const addQuestionButtons = (
    container,
    questionText,
    options,
    imageUrl,
    platform,
    includeGetAnswer = false,
    ddgText = "DDG",
  ) => {
    const buttonsContainer = document.createElement("div");
    buttonsContainer.classList.add("uets-main-question-buttons-container");
    sharedState.elementsToCleanup.push(buttonsContainer);

    const ddgLink = createLink(
      ddgText,
      `https://duckduckgo.com/?q=${encodeURIComponent(questionText || "question")}`,
      "uets-ddg-link uets-ddg-link-main-question",
    );
    buttonsContainer.appendChild(ddgLink);

    const copyPromptButton = createButton(
      "Prompt",
      "uets-copy-prompt-button uets-copy-prompt-button-main-question",
      async (event) => {
        event.preventDefault(); // Prevent form submission
        event.stopPropagation(); // Stop event bubbling
        const prompt = buildGeminiPrompt(
          questionText || "(See attached image)",
          options,
          !!imageUrl,
          platform,
        );
        try {
          await navigator.clipboard.writeText(prompt);
          copyPromptButton.textContent = "Copied!";
          setTimeout(
            () => (copyPromptButton.textContent = "Prompt"),
            2000,
          );
        } catch (err) {
          alert("Failed to copy prompt.");
        }
      },
    );
    copyPromptButton.type = "button"; // Explicitly set button type
    buttonsContainer.appendChild(copyPromptButton);

    const geminiButton = createButton(
      "Ask AI",
      "uets-gemini-button uets-gemini-button-main-question",
      async (event) => {
        event.preventDefault(); // Prevent form submission
        event.stopPropagation(); // Stop event bubbling
        let imageData = null;
        if (imageUrl && sharedState.config.includeImages) {
          try {
            imageData = await fetchImageAsBase64(imageUrl);
          } catch (error) {
            showResponsePopup(
              `Failed to fetch image: ${error}\nProceeding with text only.`,
            );
          }
        }
        askGemini(
          questionText || "(See attached image)",
          options,
          imageData,
          platform,
        );
      },
    );
    geminiButton.type = "button"; // Explicitly set button type
    buttonsContainer.appendChild(geminiButton);

    if (includeGetAnswer) {
      const getAnswerButton = createButton(
        "Get Answer",
        "uets-get-answer-button",
        async (event) => {
          event.preventDefault(); // Prevent form submission
          event.stopPropagation(); // Stop event bubbling
          const questionData =
            sharedState.quizData[sharedState.currentQuestionId];
          if (questionData) {
            const response = await sendQuestionToServer(
              sharedState.currentQuestionId,
              questionData.type,
              questionData.structure.options
                ? questionData.structure.options.map((opt) => opt.id)
                : [],
            );
            if (response && response.hasAnswer) {
              GM_log("[*] Received answer from server:", response);
              highlightCorrectAnswers(
                response.correctAnswers,
                response.questionType,
              );
            } else {
              showResponsePopup("No answer available yet.");
            }
          } else {
            showResponsePopup("Question data not found.");
          }
        },
      );
      getAnswerButton.type = "button";
      buttonsContainer.appendChild(getAnswerButton);
    }

    container.appendChild(buttonsContainer);
  };

  const processProceedGameRequest = (data) => {
    if (data.response && data.response.timeTaken !== undefined && sharedState.config.enableTimeTakenEdit) {
      const timetakenforce =
        Math.floor(Math.random() * (sharedState.config.timeTakenMax - sharedState.config.timeTakenMin + 1)) + sharedState.config.timeTakenMin;
      data.response.timeTaken = timetakenforce;

      if (sharedState.config.enableTimerHijack) {
        data.response.provisional.scoreBreakups.correct.timer = sharedState.config.timerBonusPoints;
        data.response.provisional.scoreBreakups.correct.total = sharedState.config.timerBonusPoints + data.response.provisional.scoreBreakups.correct.base + data.response.provisional.scoreBreakups.correct.streak;
        data.response.provisional.scores.correct = sharedState.config.timerBonusPoints + data.response.provisional.scoreBreakups.correct.base + data.response.provisional.scoreBreakups.correct.streak;
      }
      GM_log(
        `[+] timeTaken modified from ${data.response.timeTaken} to ${timetakenforce}`,
      );
    }
    return data;
  };

  const processProceedGameResponse = (data) => {
    try {
      var questionId = data.response.questionId;
      var correctAnswer = data.question.structure.answer;
      if (correctAnswer == 0 && data.question.structure.options !== undefined) {
        correctAnswer = data.question.structure.options[0].text;
      }
    }
    catch (e) {
      var questionId = data.data.response.questionId;
      var correctAnswer = data.data.question.structure.answer;
      if (correctAnswer == 0 && data.data.question.structure.options !== undefined) {
        correctAnswer = data.data.question.structure.options[0].text;
      }
    }
    GM_log(`[*] Sending correct answer (${questionId} <${correctAnswer}>) to server`);
    sendAnswerToServer(questionId, correctAnswer);

  };

  // === SPOOF FULLSCREEN AND FOCUS ===
  const spoofFullscreenAndFocus = () => {
    // Spoof fullscreen properties
    Object.defineProperty(document, "fullscreenElement", {
      get: () => document.documentElement,
      configurable: true,
    });
    Object.defineProperty(document, "fullscreen", {
      get: () => true,
      configurable: true,
    });

    // Spoof focus properties - hasFocus is a method
    Object.defineProperty(document, "hasFocus", {
      value: () => true,
      writable: true,
      configurable: true,
    });

    // Override window.focus to do nothing
    const originalFocus = window.focus;
    window.focus = () => {
      // Simulate focus without actually focusing
    };

    // Spoof visibility state
    Object.defineProperty(document, "visibilityState", {
      get: () => "visible",
      configurable: true,
    });

    // Prevent visibilitychange events from firing or handle them
    const originalDispatchEvent = document.dispatchEvent;
    document.dispatchEvent = function (event) {
      if (event.type === "visibilitychange") {
        // Suppress or modify visibilitychange events
        return true;
      }
      return originalDispatchEvent.call(this, event);
    };

    // Remove toast manager to prevent spam
    const removeToastManager = () => {
      const toastManager = document.querySelector(".toast-manager");
      if (toastManager) toastManager.remove();
    };

    // Observe for toast manager
    const toastObserver = new MutationObserver(() => {
      removeToastManager();
    });
    toastObserver.observe(document.body, { childList: true, subtree: true });

    // Initial check
    removeToastManager();

    GM_log("[+] Fullscreen and focus spoofing enabled.");
  };

  // === SERVER COMMUNICATION ===
  const sendQuestionToServer = async (questionId, questionType, answerIds) => {
    try {
      const response = await fetch(`${sharedState.config.serverUrl}/api/question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, questionType, answerIds }),
      });
      return await response.json();
    } catch (error) {
      GM_log("[!] Error sending question to server:", error);
      return null;
    }
  };

  const sendAnswerToServer = async (questionId, correctAnswers) => {
    try {
      const response = await fetch(`${sharedState.config.serverUrl}/api/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, correctAnswers }),
      });
      return await response.json();
    } catch (error) {
      GM_log("[!] Error sending answer to server:", error);
      return null;
    }
  };

  // === ANSWER HIGHLIGHTING ===
  const highlightCorrectAnswers = (correctAnswers, questionType) => {
    if (!sharedState.uiModificationsEnabled) return;

    const optionButtons = document.querySelectorAll("button.option");
    optionButtons.forEach((button) => {
      button.classList.remove("uets-correct-answer");
      const indicator = button.querySelector(".uets-answer-indicator");
      if (indicator) indicator.remove();
    });

    if (questionType === "BLANK") {
      showCorrectAnswersModal(correctAnswers, questionType);
      return;
    }

    // Get the current question data to match answer IDs to text
    const currentQuestion =
      sharedState.questionsPool[sharedState.currentQuestionId];
    if (!currentQuestion) {
      showCorrectAnswersModal(correctAnswers, questionType);
      return;
    }

    // Display the correct answers in a modal
    showCorrectAnswersModal(correctAnswers, questionType, currentQuestion);

    // Still highlight the buttons if possible
    optionButtons.forEach((button) => {
      const optionId =
        button.getAttribute("data-option-id") ||
        button
          .querySelector("[data-option-id]")
          ?.getAttribute("data-option-id");

      if (optionId && correctAnswers.includes(optionId)) {
        button.classList.add("uets-correct-answer");
        button.style.position = "relative";

        const indicator = document.createElement("div");
        indicator.className = "uets-answer-indicator";
        indicator.textContent = "✓";
        button.appendChild(indicator);
      }
    });
  };

  // === NEW: SHOW CORRECT ANSWERS MODAL ===
  const showCorrectAnswersModal = (
    correctAnswers,
    questionType,
    questionData = null,
  ) => {
    if (!sharedState.uiModificationsEnabled) return;

    let content = "";

    if (questionType === "BLANK") {
      content = `${correctAnswers}`;
    } else if (questionType === "MCQ") {
      const correctIndex = correctAnswers;

      if (!questionData && sharedState.currentQuestionId) {
        questionData = sharedState.questionsPool[sharedState.currentQuestionId];
      }

      if (
        questionData &&
        questionData.structure &&
        questionData.structure.options &&
        questionData.structure.options[correctIndex]
      ) {
        const div = document.createElement("div");
        div.innerHTML = questionData.structure.options[correctIndex].text;
        content = `${div.textContent.trim()}`;
      } else {
        content = `Option ${correctIndex + 1}`;
      }
    } else if (questionType === "MSQ") {
      if (!questionData && sharedState.currentQuestionId) {
        questionData = sharedState.questionsPool[sharedState.currentQuestionId];
      }

      if (
        questionData &&
        questionData.structure &&
        questionData.structure.options
      ) {
        const correctOptions = correctAnswers.map((index) => {
          if (questionData.structure.options[index]) {
            const div = document.createElement("div");
            div.innerHTML = questionData.structure.options[index].text;
            return div.textContent.trim();
          }
          return `Option ${index + 1}`;
        });
        content = `${correctOptions.join("\n")}`;
      } else {
        content = `Options ${correctAnswers.map((i) => i + 1).join(", ")}`;
      }
    } else {
      if (Array.isArray(correctAnswers)) {
        content = `${correctAnswers.join(", ")}`;
      } else {
        content = `${correctAnswers}`;
      }
    }

    showResponsePopup(content, false, "Correct Answers");
  };

  // === CONFIG MANAGEMENT ===
  const saveConfig = () => {
    GM_setValue(CONFIG_STORAGE_KEY, sharedState.config);
    GM_setValue(GEMINI_API_KEY_STORAGE, sharedState.config.geminiApiKey);
  };

  const resetConfig = () => {
    sharedState.config = { ...DEFAULT_CONFIG };
    saveConfig();
  };

  const createConfigGui = () => {
    if (sharedState.uiModificationsEnabled === false) {
      handleToggleUiClick();
    }
    if (sharedState.configGui) return;

    const gui = document.createElement('div');
    gui.className = 'uets-config-gui';

    gui.innerHTML = `
  <div class="uets-config-header">
    <span class="uets-config-title">UETS Configuration</span>
    <button class="uets-config-close"></button>
  </div>

  <div class="uets-config-content">
    <div class="uets-profile-selector">
      <div class="uets-profile-list">
        <button class="uets-profile-button" data-profile="Custom">Custom</button>
        <button class="uets-profile-button" data-profile="Stealthy">Stealthy</button>
        <button class="uets-profile-button" data-profile="Creator's choice">Creator's choice</button>
        <button class="uets-profile-button" data-profile="LMAO">LMAO</button>
      </div>
    </div>

    <div class="uets-card" style="margin-left: 4px; margin-right: 4px;">
      <div class="uets-config-section">
        <div class="uets-config-section-title">General Settings</div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Makes the website think that it's in fullscreen mode AND focused. Recommended on Testportal and Wayground (if the teacher enabled extra protections)." title="Info"></button>
            <label class="uets-config-label">Fullscreen spoofing</label>
          </div>
          <label class="uets-switch">
            <input type="checkbox" id="enableSpoofFullscreen">
            <span class="uets-switch-slider"></span>
          </label>
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="URL of the server for storing and retrieving answers." title="Info"></button>
            <label class="uets-config-label">Server URL</label>
          </div>
          <input type="text" class="uets-config-input" id="serverUrl" style="width: 200px;">
        </div>
      </div>
    </div>

    <div class="uets-card" style="margin-top: 6px; margin-left: 4px; margin-right: 4px;">
      <div class="uets-config-section">
        <div class="uets-config-section-title">Wayground Settings</div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Allows you to spoof the time taken to answer a question. You have 20 seconds to get a ~100-400 point bonus per question, this option forces the site to give you bonus points." title="Info"></button>
            <label class="uets-config-label">Hijack timeTaken</label>
          </div>
          <label class="uets-switch">
            <input type="checkbox" id="enableTimeTakenEdit">
            <span class="uets-switch-slider"></span>
          </label>
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Minimum time in milliseconds for randomized time taken. I recommend keeping it between 6000 and 9000. Very low values will alert the teacher." title="Info"></button>
            <label class="uets-config-label">timeTaken min (ms)</label>
          </div>
          <input type="number" class="uets-config-input" id="timeTakenMin" min="100" max="60000">
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Maximum time in milliseconds for randomized time taken. I recommend keeping it between 7000 and 12000. Very low values will alert the teacher." title="Info"></button>
            <label class="uets-config-label">timeTaken max (ms)</label>
          </div>
          <input type="number" class="uets-config-input" id="timeTakenMax" min="100" max="60000">
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Enables timer hijacking, this adds bonus points to your score, I recommend keeping it between 200 and 350 points to seem legitimate." title="Info"></button>
            <label class="uets-config-label">Hijack timer for points</label>
          </div>
          <label class="uets-switch">
            <input type="checkbox" id="enableTimerHijack">
            <span class="uets-switch-slider"></span>
          </label>
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Timer bonus that you'll recieve if you enable timer hijacking. Values above 6000 are problematic and will cause issues. Maximum value that's guaranteed to work is 5000, but I don't recommend setting it to anything above 350." title="Info"></button>
            <label class="uets-config-label">Timer bonus points</label>
          </div>
          <input type="number" class="uets-config-input" id="timerBonusPoints" min="0" max="5000">
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="DANGER: Enabling this and clicking any reaction will trigger a wave of reactions being shown on the teacher's screen, alongside potentially freezing your browser. If you want to use it, try your best not to get caught." title="Info"></button>
            <label class="uets-config-label">Enable reaction spam</label>
          </div>
          <label class="uets-switch">
            <input type="checkbox" id="enableReactionSpam">
            <span class="uets-switch-slider"></span>
          </label>
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="How many reactions should be set per one reaction." title="Info"></button>
            <label class="uets-config-label">Reaction spam count</label>
          </div>
          <input type="number" class="uets-config-input" id="reactionSpamCount" min="0" max="10">
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Delay in milliseconds between each resend." title="Info"></button>
            <label class="uets-config-label">Reaction spam delay (ms)</label>
          </div>
          <input type="number" class="uets-config-input" id="reactionSpamDelay" min="50" max="1000">
        </div>
      </div>
    </div>

    <div class="uets-card" style="margin-top: 6px; margin-left: 4px; margin-right: 4px;">
      <div class="uets-config-section">
        <div class="uets-config-section-title">Gemini AI Settings</div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Your Gemini API key for AI assistance. You can get it on https://aistudio.google.com/apikey." title="Info"></button>
            <label class="uets-config-label">API Key</label>
          </div>
          <input type="password" class="uets-config-input" id="geminiApiKey" style="width: 200px;">
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="The Gemini model to use for AI queries. I recommend using the flash or lite series of models for quick answers. Breakdown (Requests/min / Tokens/min):\n\n2.5 Pro - Slower responses, costs more tokens, best quality. 5/250k.\n2.5 Flash - Fast responses, lower ratelimit, good quality. 10/250k.\n2.5 Flash-Lite - Fastest responses, lowest ratelimit, okay quality. 15/250k.\n2.0 Flash - Fast responses, lower ratelimit, acceptable quality. 15/1M.\n2.0 Flash-Lite - Fastest responses, lowest ratelimit, acceptable quality. 30/1M." title="Info"></button>
            <label class="uets-config-label">Model</label>
          </div>
          <select class="uets-config-input" id="geminiModel"><option>Loading models...</option></select>
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Whether to include question images in AI prompts." title="Info"></button>
            <label class="uets-config-label">Include images</label>
          </div>
          <label class="uets-switch">
            <input type="checkbox" id="includeImages">
            <span class="uets-switch-slider"></span>
          </label>
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Budget for thinking in the AI model (0 disables thinking). Can increase output response quality, but increases the waiting time for the answer. I recommend 256 or 512 tokens." title="Info"></button>
            <label class="uets-config-label">Thinking budget</label>
          </div>
          <input type="number" class="uets-config-input" id="thinkingBudget" min="0" max="4096">
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Maximum number of tokens in AI responses (1-8192). A token is roughly equal to a word, or a punctuation mark." title="Info"></button>
            <label class="uets-config-label">Max output tokens</label>
          </div>
          <input type="number" class="uets-config-input" id="maxOutputTokens" min="1" max="8192">
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Controls randomness (or creativity) in AI responses (0-2). Lower values will be coherant and predictable, while larger values will be more creating. A value between 0.2 and 0.5 is recommended." title="Info"></button>
            <label class="uets-config-label">Temperature</label>
          </div>
          <input type="number" class="uets-config-input" id="temperature" min="0" max="2" step="0.1">
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Computes the cumulative probability distribution, and cut off as soon as that distribution exceeds the value of topP. Basically how many words can be computed and considered. I recommend a value between 0.90 and 1.00 for a better quality output." title="Info"></button>
            <label class="uets-config-label">Top P</label>
          </div>
          <input type="number" class="uets-config-input" id="topP" min="0" max="1" step="0.05">
        </div>
        <div class="uets-config-item">
          <div class="uets-config-label-container">
            <button class="uets-config-info" data-info="Helps balance creativity and coherence in generated text by introducing controlled randomness while avoiding less likely or nonsensical words. Basically avoids obscure words, I recommend a value between 40 and 64." title="Info"></button>
            <label class="uets-config-label">Top K</label>
          </div>
          <input type="number" class="uets-config-input" id="topK" min="1" max="100">
        </div>
      </div>
    </div>
  </div>

  <div class="uets-config-buttons">
    <button class="uets-config-button uets-config-save">Save</button>
    <button class="uets-config-button uets-config-reset">Reset to Defaults</button>
    <button class="uets-config-button uets-config-cancel">Cancel</button>
  </div>
`;

    // Populate current values
    const populateValues = () => {
      document.getElementById('enableTimeTakenEdit').checked = sharedState.config.enableTimeTakenEdit;
      document.getElementById('timeTakenMin').value = sharedState.config.timeTakenMin;
      document.getElementById('timeTakenMax').value = sharedState.config.timeTakenMax;
      document.getElementById('enableTimerHijack').checked = sharedState.config.enableTimerHijack;
      document.getElementById('timerBonusPoints').value = sharedState.config.timerBonusPoints;
      document.getElementById('enableSpoofFullscreen').checked = sharedState.config.enableSpoofFullscreen;
      document.getElementById('serverUrl').value = sharedState.config.serverUrl;
      document.getElementById('geminiApiKey').value = sharedState.config.geminiApiKey;
      document.getElementById('includeImages').checked = sharedState.config.includeImages;
      document.getElementById('thinkingBudget').value = sharedState.config.thinkingBudget;
      document.getElementById('maxOutputTokens').value = sharedState.config.maxOutputTokens;
      document.getElementById('temperature').value = sharedState.config.temperature;
      document.getElementById('topP').value = sharedState.config.topP;
      document.getElementById('topK').value = sharedState.config.topK;
      document.getElementById('enableReactionSpam').checked = sharedState.config.enableReactionSpam;
      document.getElementById('reactionSpamCount').value = sharedState.config.reactionSpamCount;
      document.getElementById('reactionSpamDelay').value = sharedState.config.reactionSpamDelay;
      // Set active profile button
      const profileButtons = gui.querySelectorAll('.uets-profile-button');
      profileButtons.forEach(btn => btn.classList.remove('active'));
      const customBtn = gui.querySelector('.uets-profile-button[data-profile="Custom"]');
      if (customBtn) customBtn.classList.add('active');
    };

    // Event handlers
    gui.querySelector('.uets-config-close').onclick = () => closeConfigGui();
    gui.querySelector('.uets-config-cancel').onclick = () => closeConfigGui();

    gui.querySelector('.uets-config-save').onclick = () => {
      // Collect values
      sharedState.config.enableTimeTakenEdit = document.getElementById('enableTimeTakenEdit').checked;
      sharedState.config.timeTakenMin = parseInt(document.getElementById('timeTakenMin').value);
      sharedState.config.timeTakenMax = parseInt(document.getElementById('timeTakenMax').value);
      sharedState.config.enableTimerHijack = document.getElementById('enableTimerHijack').checked;
      sharedState.config.timerBonusPoints = parseInt(document.getElementById('timerBonusPoints').value);
      sharedState.config.enableSpoofFullscreen = document.getElementById('enableSpoofFullscreen').checked;
      sharedState.config.serverUrl = document.getElementById('serverUrl').value;
      sharedState.config.geminiApiKey = document.getElementById('geminiApiKey').value;
      sharedState.config.geminiModel = document.getElementById('geminiModel').value;
      sharedState.config.includeImages = document.getElementById('includeImages').checked;
      sharedState.config.thinkingBudget = parseInt(document.getElementById('thinkingBudget').value);
      sharedState.config.maxOutputTokens = parseInt(document.getElementById('maxOutputTokens').value);
      sharedState.config.temperature = parseFloat(document.getElementById('temperature').value);
      sharedState.config.topP = parseFloat(document.getElementById('topP').value);
      sharedState.config.topK = parseInt(document.getElementById('topK').value);
      sharedState.config.enableReactionSpam = document.getElementById('enableReactionSpam').checked;
      sharedState.config.reactionSpamCount = parseInt(document.getElementById('reactionSpamCount').value);
      sharedState.config.reactionSpamDelay = parseInt(document.getElementById('reactionSpamDelay').value);

      saveConfig();
      closeConfigGui();
      alert('Configuration saved!');
    };

    gui.querySelector('.uets-config-reset').onclick = () => {
      if (confirm('Reset all settings to defaults?')) {
        resetConfig();
        populateValues();
        // Re-fetch models after reset
        fetchGeminiModels().then(models => {
          const select = document.getElementById('geminiModel');
          if (select) {
            select.innerHTML = models.map(m => `<option value="${m.name.replace('models/', '')}">${m.displayName}</option>`).join('');
            select.value = sharedState.config.geminiModel;
          }
        });
      }
    };

    // Add event listeners for profile buttons
    const profileButtons = gui.querySelectorAll('.uets-profile-button');
    profileButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Remove active class from all
        profileButtons.forEach(b => b.classList.remove('active'));
        // Add to clicked
        btn.classList.add('active');
        const selectedProfile = btn.getAttribute('data-profile');
        if (selectedProfile !== 'Custom' && PROFILES[selectedProfile]) {
          const profile = PROFILES[selectedProfile];
          document.getElementById('enableTimeTakenEdit').checked = profile.enableTimeTakenEdit;
          document.getElementById('timeTakenMin').value = profile.timeTakenMin;
          document.getElementById('timeTakenMax').value = profile.timeTakenMax;
          document.getElementById('enableTimerHijack').checked = profile.enableTimerHijack;
          document.getElementById('timerBonusPoints').value = profile.timerBonusPoints;
          document.getElementById('enableSpoofFullscreen').checked = profile.enableSpoofFullscreen;
        }
      });
    });

    document.body.appendChild(gui);
    sharedState.configGui = gui;
    populateValues();

    // Fetch and populate models
    fetchGeminiModels().then(models => {
      const select = document.getElementById('geminiModel');
      if (select) {
        select.innerHTML = models.map(m => `<option value="${m.name.replace('models/', '')}">${m.displayName}</option>`).join('');
        select.value = sharedState.config.geminiModel;
      }
    }).catch(() => {
      const select = document.getElementById('geminiModel');
      if (select) {
        select.innerHTML = '<option value="">Failed to load models</option>';
      }
    });

    // Add event listeners for info buttons
    const infoButtons = gui.querySelectorAll('.uets-config-info');
    infoButtons.forEach(btn => {
      btn.onclick = () => {
        const info = btn.getAttribute('data-info');
        showResponsePopup(info, false, "Option Info");
      };
    });
  };

  const closeConfigGui = () => {
    if (sharedState.configGui) {
      sharedState.configGui.remove();
      sharedState.configGui = null;
    }
  };

  // === SHARED API KEY MANAGEMENT ===
  GM_registerMenuCommand("Set Gemini API Key", () => {
    const currentKey = GM_getValue(GEMINI_API_KEY_STORAGE, "");
    const newKey = prompt("Enter your Gemini API Key:", currentKey);
    if (newKey !== null) {
      GM_setValue(GEMINI_API_KEY_STORAGE, newKey.trim());
      sharedState.config.geminiApiKey = newKey.trim();
      GM_log("[+] Gemini API Key updated.");
      alert("Gemini API Key saved!");
    }
  });

  const getApiKey = async () => {
    let apiKey = sharedState.config.geminiApiKey || GM_getValue(GEMINI_API_KEY_STORAGE, null);
    if (!apiKey || apiKey.trim() === "") {
      apiKey = prompt("Gemini API Key not set. Please enter your API Key:");
      if (apiKey && apiKey.trim() !== "") {
        sharedState.config.geminiApiKey = apiKey.trim();
        GM_setValue(GEMINI_API_KEY_STORAGE, apiKey.trim());
        saveConfig();
        return apiKey.trim();
      } else {
        alert("Gemini API Key is required. Set it via the configuration or Tampermonkey menu.");
        return null;
      }
    }
    return apiKey.trim();
  };


  // === SHARED MODEL FETCHING ===
  const fetchGeminiModels = async () => {
    const apiKey = sharedState.config.geminiApiKey;
    if (!apiKey || apiKey.trim() === "") return [];

    let models = [];
    let pageToken = '';

    do {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}${pageToken ? '&pageToken=' + pageToken : ''}`;
      try {
        const response = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: "GET",
            url: url,
            onload: (res) => {
              if (res.status === 200) {
                resolve(JSON.parse(res.responseText));
              } else {
                reject(new Error(`HTTP ${res.status}: ${res.responseText}`));
              }
            },
            onerror: (err) => reject(err),
          });
        });

        const filteredModels = response.models.filter(
          (m) =>
            m.supportedGenerationMethods.includes("generateContent") &&
            m.supportedGenerationMethods.includes("countTokens") &&
            m.name.includes('gemini') &&
            m.name.includes('2.') &&
            !m.name.toLowerCase().includes('tts') &&
            !m.name.toLowerCase().includes('live')
        );
        models.push(...filteredModels);
        pageToken = response.nextPageToken;
      } catch (error) {
        GM_log("[!] Error fetching Gemini models:", error);
        break;
      }
    } while (pageToken);

    // Sort: models without 'preview' or 'experimental' first, then with 'preview' or 'experimental'
    models.sort((a, b) => {
      const aHasPreviewOrExperimental = a.name.toLowerCase().includes('preview') || a.name.toLowerCase().includes('experimental');
      const bHasPreviewOrExperimental = b.name.toLowerCase().includes('preview') || b.name.toLowerCase().includes('experimental');
      if (aHasPreviewOrExperimental && !bHasPreviewOrExperimental) return 1;
      if (!aHasPreviewOrExperimental && bHasPreviewOrExperimental) return -1;
      return 0;
    });

    return models;
  };

  // === SHARED IMAGE FETCHING ===
  const fetchImageAsBase64 = (imageUrl) =>
    new Promise((resolve, reject) => {
      GM_log(`[*] Fetching image: ${imageUrl}...`);
      GM_xmlhttpRequest({
        method: "GET",
        url: imageUrl,
        responseType: "blob",
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            const blob = response.response;
            const reader = new FileReader();
            reader.onloadend = () => {
              const dataUrl = reader.result;
              const mimeType = dataUrl.substring(
                dataUrl.indexOf(":") + 1,
                dataUrl.indexOf(";"),
              );
              const base64Data = dataUrl.substring(dataUrl.indexOf(",") + 1);
              GM_log(`[+] Image fetched successfully. MIME type: ${mimeType}`);
              resolve({ base64Data, mimeType });
            };
            reader.onerror = () =>
              reject("FileReader error while processing image.");
            reader.readAsDataURL(blob);
          } else {
            reject(`Failed to fetch image. Status: ${response.status}`);
          }
        },
        onerror: () => reject("Network error while fetching image."),
        ontimeout: () => reject("Image fetch request timed out."),
      });
    });

  // === SHARED GEMINI INTERACTION ===
  const buildGeminiPrompt = (
    question,
    options,
    hasImage,
    platform = "quiz",
  ) => {
    const contextMap = {
      quiz: "You are an AI assistant helping a user with a quiz.",
      test: "You are an AI assistant helping a user with a test.",
      form: "You are an AI assistant helping a user with a form.",
    };

    return `
Context: ${contextMap[platform] || contextMap.quiz}
The user needs to identify the correct answer(s) from the given options for the following question.
${hasImage ? "An image is associated with this question; please consider it in your analysis." : ""}

Question: "${question}"

Available Options:
${options.map((opt, i) => `${i + 1}. ${opt}`).join("\n")}

Please perform the following:
1. Identify the correct answer or answers from the "Available Options" list.
2. Provide a concise reasoning for your choice(s).
3. Format your response clearly. Start with "Correct Answer(s):" followed by the answer(s), and then "Reasoning:" followed by your explanation. Be brief and to the point.
`;
  };

  const askGemini = async (question, options, imageData, platform = "quiz") => {
    const apiKey = await getApiKey();
    if (!apiKey) return;

    const promptText = buildGeminiPrompt(
      question,
      options,
      !!imageData,
      platform,
    );
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${sharedState.config.geminiModel}:generateContent?key=${apiKey}`;

    const requestPayloadContents = [{ parts: [{ text: promptText }] }];
    if (sharedState.config.includeImages && imageData && imageData.base64Data && imageData.mimeType) {
      requestPayloadContents[0].parts.push({
        inline_data: {
          mime_type: imageData.mimeType,
          data: imageData.base64Data,
        },
      });
    }

    const apiPayload = {
      contents: requestPayloadContents,
      generationConfig: {
        temperature: sharedState.config.temperature,
        topP: sharedState.config.topP,
        topK: sharedState.config.topK,
        maxOutputTokens: sharedState.config.maxOutputTokens,
        thinkingConfig: {
          thinkingBudget: sharedState.config.thinkingBudget,
        },
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
      ],
    };

    showResponsePopup("Loading AI insights...", true, "AI Assistant");

    GM_xmlhttpRequest({
      method: "POST",
      url: apiUrl,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(apiPayload),
      onload: (response) => {
        try {
          const result = JSON.parse(response.responseText);
          if (
            result.candidates &&
            result.candidates.length > 0 &&
            result.candidates[0].content &&
            result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0
          ) {
            const geminiText = result.candidates[0].content.parts[0].text;
            GM_log("[+] Gemini API Response:", geminiText);
            showResponsePopup(geminiText, false, "AI Assistant");
          } else if (result.error) {
            GM_log("[!] Gemini API Error:", result.error.message);
            showResponsePopup(
              `Gemini API Error: ${result.error.message}`,
              false,
              "AI Assistant",
            );
          } else {
            showResponsePopup(
              "Gemini API Error: Could not parse a valid response.",
              false,
              "AI Assistant",
            );
          }
        } catch (e) {
          showResponsePopup(
            "Gemini API Error: Failed to parse response.\n" + e.message,
            false,
            "AI Assistant",
          );
        }
      },
      onerror: (response) => {
        showResponsePopup(
          `Gemini API Error: Request failed. Status: ${response.status}`,
          false,
          "AI Assistant",
        );
      },
      ontimeout: () =>
        showResponsePopup(
          "Gemini API Error: Request timed out.",
          false,
          "AI Assistant",
        ),
    });
  };

  const showResponsePopup = (
    content,
    isLoading = false,
    title = "AI Assistant",
  ) => {
    if (!sharedState.uiModificationsEnabled) {
      if (sharedState.geminiPopup) {
        sharedState.geminiPopup.remove();
        sharedState.geminiPopup = null;
      }
      return;
    }

    let popup = document.getElementById("uets-gemini-popup");
    if (!popup) {
      popup = document.createElement("div");
      popup.id = "uets-gemini-popup";
      popup.classList.add("uets-response-popup");

      const header = document.createElement("div");
      header.classList.add("uets-response-popup-header");

      const titleElement = document.createElement("span");
      titleElement.classList.add("uets-response-popup-title");
      titleElement.textContent = title;

      const closeButton = document.createElement("button");
      closeButton.classList.add("uets-response-popup-close");
      closeButton.onclick = () => {
        popup.remove();
        sharedState.geminiPopup = null;
      };

      header.appendChild(titleElement);
      header.appendChild(closeButton);
      popup.appendChild(header);

      const contentDiv = document.createElement("div");
      contentDiv.classList.add("uets-response-popup-content");
      popup.appendChild(contentDiv);

      document.body.appendChild(popup);
      sharedState.geminiPopup = popup;
    } else {
      const titleElement = popup.querySelector(".uets-response-popup-title");
      if (titleElement) titleElement.textContent = title;
    }

    const contentDiv = popup.querySelector(".uets-response-popup-content");
    if (isLoading) {
      contentDiv.innerHTML = `
        <div class="uets-response-popup-loading">
          <div class="uets-loading-spinner"></div>
          ${content}
        </div>
      `;
    } else {
      let formattedContent = content.replace(
        /^(Correct Answer\(s\):)/gim,
        "<strong>$1</strong>",
      );
      formattedContent = formattedContent.replace(
        /^(Reasoning:)/gim,
        "<br><br><strong>$1</strong>",
      );
      contentDiv.innerHTML = formattedContent;
    }
    popup.style.display = "block";
  };

  // === SHARED UI TOGGLE ===
  const updateToggleButtonAppearance = () => {
    if (!sharedState.toggleButton) return;
    if (sharedState.uiModificationsEnabled) {
      sharedState.toggleButton.innerHTML = "";
      sharedState.toggleButton.style.fontFamily = "'Material Icons Outlined'";
      sharedState.toggleButton.style.fontSize = "24px";
      sharedState.toggleButton.style.setProperty("--icon", "'close'");
      sharedState.toggleButton.setAttribute("data-icon", "close");
      sharedState.toggleButton.title = "Hide Tool Modifications";
      sharedState.toggleButton.classList.remove("uets-mods-hidden-state");
    } else {
      sharedState.toggleButton.innerHTML = "";
      sharedState.toggleButton.style.fontFamily = "'Material Icons Outlined'";
      sharedState.toggleButton.style.fontSize = "24px";
      sharedState.toggleButton.style.setProperty("--icon", "'add'");
      sharedState.toggleButton.setAttribute("data-icon", "add");
      sharedState.toggleButton.title = "Show Tool Modifications";
      sharedState.toggleButton.classList.add("uets-mods-hidden-state");
    }

    // Set the icon content
    sharedState.toggleButton.style.setProperty("content", sharedState.uiModificationsEnabled ? "'close'" : "'add'");
    const icon = sharedState.uiModificationsEnabled ? "close" : "add";
    sharedState.toggleButton.textContent = icon;
  };

  const handleToggleUiClick = () => {
    sharedState.uiModificationsEnabled = !sharedState.uiModificationsEnabled;
    GM_setValue(UI_MODS_ENABLED_KEY, sharedState.uiModificationsEnabled);
    updateToggleButtonAppearance();

    const isTestPortal = sharedState.currentDomain.includes("testportal.net") ||
      sharedState.currentDomain.includes("testportal.pl");

    if (!sharedState.uiModificationsEnabled) {
      if (isTestPortal) {
        // On TestPortal: just hide elements with opacity
        document.querySelectorAll(
          ".uets-ddg-link, .uets-gemini-button, .uets-copy-prompt-button, .uets-get-answer-button, .uets-main-question-buttons-container, .uets-streak-bonus"
        ).forEach((el) => el.classList.add("uets-testportal-invisible"));

        if (sharedState.geminiPopup) {
          sharedState.geminiPopup.classList.add("uets-testportal-invisible");
        }
      } else {
        // On other sites: remove elements as before
        document.querySelectorAll(
          ".uets-ddg-link, .uets-gemini-button, .uets-copy-prompt-button, .uets-get-answer-button, .uets-main-question-buttons-container, .uets-streak-bonus"
        ).forEach((el) => el.remove());

        if (sharedState.geminiPopup) {
          sharedState.geminiPopup.remove();
          sharedState.geminiPopup = null;
        }

        document.querySelectorAll(".uets-option-wrapper").forEach((wrapper) => {
          const button = wrapper.querySelector("button.option");
          if (button && wrapper.parentNode) {
            wrapper.parentNode.insertBefore(button, wrapper);
          }
          wrapper.remove();
        });

        sharedState.elementsToCleanup.forEach((el) => {
          if (el && el.parentNode && !el.querySelector("button.option")) {
            el.remove();
          }
        });
        sharedState.elementsToCleanup = [];

        if (sharedState.currentDomain.includes("wayground.com") || sharedState.currentDomain.includes("quizizz.com")) {
          // Revert text edits
          if (sharedState.originalTabLeaveHTML !== null) {
            const ruleDiv = document.querySelector('.test-mode-container');
            if (ruleDiv) {
              ruleDiv.innerHTML = sharedState.originalTabLeaveHTML;
            }
            sharedState.originalTabLeaveHTML = null;
          }
          if (sharedState.originalStartButtonText !== null) {
            const startButton = document.querySelector('.start-game');
            if (startButton) {
              const span = startButton.querySelector('span');
              if (span) {
                span.textContent = sharedState.originalStartButtonText;
              }
            }
            sharedState.originalStartButtonText = null;
          }
        }

        if (sharedState.currentDomain.includes("docs.google.com")) {
          const questionBlocks = document.querySelectorAll(
            'div[role="listitem"] > div[jsmodel]',
          );
          questionBlocks.forEach((block) => {
            delete block.dataset.uetsButtonsAdded;
          });
        }

        if (
          sharedState.currentDomain.includes("testportal.net") ||
          sharedState.currentDomain.includes("testportal.pl")
        ) {
          const questionElements = document.querySelectorAll(".question_essence");
          questionElements.forEach((el) => {
            delete el.dataset.enhancementsAdded;
          });
        }
      }
    } else {
      if (isTestPortal) {
        // On TestPortal: show elements by removing opacity class
        document.querySelectorAll(
          ".uets-ddg-link, .uets-gemini-button, .uets-copy-prompt-button, .uets-get-answer-button, .uets-main-question-buttons-container, .uets-streak-bonus"
        ).forEach((el) => el.classList.remove("uets-testportal-invisible"));

        if (sharedState.geminiPopup) {
          sharedState.geminiPopup.classList.remove("uets-testportal-invisible");
        }
      } else {
        setTimeout(() => {
          initializeDomainSpecific();
        }, 100);
      }
    }
  };

  // Add cleanup on navigation (beforeunload event):
  window.addEventListener("beforeunload", () => {
    const isTestPortal = sharedState.currentDomain.includes("testportal.net") ||
      sharedState.currentDomain.includes("testportal.pl");

    if (isTestPortal) {
      // Remove all UETS elements before navigating away from TestPortal
      document.querySelectorAll(
        ".uets-ddg-link, .uets-gemini-button, .uets-copy-prompt-button, .uets-get-answer-button, .uets-main-question-buttons-container, .uets-streak-bonus, .uets-response-popup, .uets-welcome-popup, .uets-config-gui"
      ).forEach((el) => el.remove());

      sharedState.elementsToCleanup.forEach((el) => {
        if (el && el.parentNode) {
          el.remove();
        }
      });

      // Remove toggle button on TestPortal before navigation
      if (sharedState.toggleButton) {
        sharedState.toggleButton.remove();
      }

      // Restore original RegExp.prototype.test
      RegExp.prototype.test = sharedState.originalRegExpTest;
    }
  });

  const createToggleButton = () => {
    if (document.getElementById("uets-toggle-ui-button")) return;

    sharedState.toggleButton = document.createElement("button");
    sharedState.toggleButton.id = "uets-toggle-ui-button";
    updateToggleButtonAppearance();

    // Tap/click counter for config GUI
    let lastTapTime = 0;
    let tapCount = 0;
    const TAP_WINDOW_MS = 500;

    const handleTap = () => {
      const now = Date.now();
      if (now - lastTapTime < TAP_WINDOW_MS) {
        tapCount += 1;
      } else {
        tapCount = 1;
      }
      lastTapTime = now;

      if (tapCount === 4) {
        createConfigGui();
        tapCount = 0;
      } else if (tapCount === 1) {
        handleToggleUiClick();
      }
    };

    sharedState.toggleButton.addEventListener("click", handleTap);
    sharedState.toggleButton.addEventListener("touchend", handleTap);

    document.body.appendChild(sharedState.toggleButton);
  };

  // === DOMAIN-SPECIFIC MODULES ===

  // KAHOOT MODULE
  const kahootModule = {
    QUIZ_TYPES: ['quiz', 'multiple_select_quiz'],
    CONTROLLER_CHANNEL: '/service/controller',
    COLORS: ['red', 'blue', 'yellow', 'green'],

    loadSocketIO: () => {
      return new Promise((resolve, reject) => {
        if (window.io) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.8.1/socket.io.min.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Socket.IO'));
        document.head.appendChild(script);
      });
    },

    isCometDEndpoint: url => url.includes('/cometd/') && url.includes('kahoot.it'),

    parseJSON: data => {
      try {
        return typeof data === 'string' ? JSON.parse(data) : data;
      } catch {
        return null;
      }
    },

    extractQuizData: content => {
      const parsed = kahootModule.parseJSON(content);
      return parsed && kahootModule.QUIZ_TYPES.includes(parsed.type) && 'choice' in parsed ? parsed : null;
    },

    containsQuizAnswer: data => {
      const parsed = kahootModule.parseJSON(data);
      return Array.isArray(parsed) && parsed.some(item =>
        item.channel === kahootModule.CONTROLLER_CHANNEL &&
        item.data?.content &&
        kahootModule.extractQuizData(item.data.content)
      );
    },

    connectToServer: async () => {
      if (!sharedState.kahootClientId || !sharedState.kahootGameId) return;

      // Better connection state checking
      if (sharedState.kahootSocket) {
        if (sharedState.kahootSocket.connected) {
          GM_log("[*] Already connected to UETS-server");
          return;
        } else {
          // Clean up existing socket
          sharedState.kahootSocket.disconnect();
          sharedState.kahootSocket = null;
        }
      }

      if (sharedState.kahootHasConnected) {
        GM_log("[*] Connection already established to UETS-server");
        return;
      }

      try {
        await kahootModule.loadSocketIO();
        GM_log(`[*] Connecting to UETS-server with clientId: ${sharedState.kahootClientId}, gameId: ${sharedState.kahootGameId}`);

        sharedState.kahootSocket = io(sharedState.config.serverUrl, {
          transports: ['websocket', 'polling'],
          forceNew: true, // Force a new connection
          timeout: 10000
        });

        sharedState.kahootSocket.on('connect', () => {
          GM_log("[+] Connected to UETS-server");
          sharedState.kahootHasConnected = true;
          sharedState.kahootSocket.emit('identify', {
            clientId: sharedState.kahootClientId,
            gameId: sharedState.kahootGameId
          });
        });

        sharedState.kahootSocket.on('answer_counts', (data) => {
          GM_log("[*] Received answer counts:", data);
          sharedState.kahootCurrentQuestion = data.questionIndex;
          sharedState.kahootAnswerCounts = data.counts;
          kahootModule.updateAnswerIndicators();

        });

        sharedState.kahootSocket.on('question_reset', (data) => {
          GM_log("[*] Question reset:", data);
          if (data.questionIndex === sharedState.kahootCurrentQuestion) {
            sharedState.kahootAnswerCounts = {};
            kahootModule.updateAnswerIndicators();
          }
        });

        sharedState.kahootSocket.on('error', (error) => {
          GM_log("[!] Kahoot server error:", error);
        });

        sharedState.kahootSocket.on('disconnect', () => {
          GM_log("[!] Kahoot server connection closed");
          sharedState.kahootHasConnected = false;
          sharedState.kahootSocket = null;
        });

      } catch (error) {
        GM_log("[!] Failed to connect to UETS-server:", error);
        sharedState.kahootHasConnected = false;
        // Reduce retry frequency
        setTimeout(() => {
          if (!sharedState.kahootHasConnected && sharedState.kahootClientId && sharedState.kahootGameId) {
            kahootModule.connectToServer();
          }
        }, 5000); // Increased from 3000 to 5000
      }
    },

    sendAnswerToServer: (questionIndex, choices) => {
      GM_log(`[*] Sending Kahoot answer: Q${questionIndex} = ${choices}`);
      sharedState.kahootSocket.emit('answer', {
        questionIndex: questionIndex,
        choices: choices,
        clientId: sharedState.kahootClientId,
        gameId: sharedState.kahootGameId
      });

    },

    updateAnswerIndicators: () => {
      if (window.location.pathname !== "/gameblock") return;

      const buttons = document.querySelectorAll('[data-functional-selector^="answer-"]');
      buttons.forEach((button, index) => {
        const existingIndicator = button.querySelector('.kahoot-answer-indicator');
        if (existingIndicator) {
          existingIndicator.remove();
        }
        button.classList.add('kahoot-answer-button');
        const count = sharedState.kahootAnswerCounts[index] || 0;
        if (count > 0) {
          const indicator = document.createElement('div');
          indicator.className = 'kahoot-answer-indicator';
          indicator.textContent = count;
          indicator.style.backgroundColor = kahootModule.getColorForChoice(index);
          button.appendChild(indicator);
        }
      });
    },

    getColorForChoice: (index) => {
      const colorMap = {
        0: '#ff0000', // red
        1: '#0066cc', // blue  
        2: '#ffcc00', // yellow
        3: '#00cc00'  // green
      };
      return colorMap[index] || '#666666';
    },

    logQuizAnswer: (data, direction = "SEND") => {
      const parsed = kahootModule.parseJSON(data);
      if (!Array.isArray(parsed)) return;

      parsed.forEach(item => {
        if (item.channel !== kahootModule.CONTROLLER_CHANNEL || !item.data?.content) return;

        const quizData = kahootModule.extractQuizData(item.data.content);
        if (!quizData) return;

        const isMultiple = quizData.type === 'multiple_select_quiz';
        const choices = Array.isArray(quizData.choice) ? quizData.choice : [quizData.choice];
        const choiceStr = choices.length > 1 ? `[${choices.join(',')}]` : choices[0];

        GM_log(`[*] ${isMultiple ? 'MULTI' : 'SINGLE'} Q${quizData.questionIndex} = ${choiceStr} (${direction})`);

        if (direction === "SEND") {
          kahootModule.sendAnswerToServer(quizData.questionIndex, choices);
        }
      });
    },

    extractIdentifiers: (data) => {
      const parsed = kahootModule.parseJSON(data);
      if (!Array.isArray(parsed)) return;

      let shouldConnect = false;

      parsed.forEach(item => {
        if (item.clientId && !sharedState.kahootClientId) {
          sharedState.kahootClientId = item.clientId;
          GM_log(`[*] Kahoot Client ID: ${sharedState.kahootClientId}`);
          shouldConnect = true;
        }

        if (item.data && item.data.gameid && !sharedState.kahootGameId) {
          sharedState.kahootGameId = item.data.gameid;
          GM_log(`[*] Kahoot Game ID: ${sharedState.kahootGameId}`);
          shouldConnect = true;
        }
      });

      // Only connect once when we have both IDs and haven't connected yet
      if (shouldConnect &&
        sharedState.kahootClientId &&
        sharedState.kahootGameId &&
        !sharedState.kahootHasConnected &&
        !sharedState.kahootSocket) {
        kahootModule.connectToServer();
      }
    },

    injectScript: () => {
      const script = document.createElement('script');
      script.textContent = `
      (() => {
        const NativeWebSocket = window.WebSocket;
        const QUIZ_TYPES = ['quiz', 'multiple_select_quiz'];
        const CONTROLLER_CHANNEL = '/service/controller';
        
        const isCometDEndpoint = url => url.includes('/cometd/') && url.includes('kahoot.it');
        const parseJSON = data => { try { return typeof data === 'string' ? JSON.parse(data) : data; } catch { return null; } };
        const extractQuizData = content => { const parsed = parseJSON(content); return parsed && QUIZ_TYPES.includes(parsed.type) && 'choice' in parsed ? parsed : null; };
        const containsQuizAnswer = data => { const parsed = parseJSON(data); return Array.isArray(parsed) && parsed.some(item => item.channel === CONTROLLER_CHANNEL && item.data?.content && extractQuizData(item.data.content)); };
        
        const logQuizAnswer = (data, direction) => {
          const parsed = parseJSON(data);
          if (!Array.isArray(parsed)) return;
          
          parsed.forEach(item => {
            if (item.channel !== CONTROLLER_CHANNEL || !item.data?.content) return;
            const quizData = extractQuizData(item.data.content);
            if (!quizData) return;
            
            const isMultiple = quizData.type === 'multiple_select_quiz';
            const choices = Array.isArray(quizData.choice) ? quizData.choice : [quizData.choice];
            const choiceStr = choices.length > 1 ? \`[\${choices.join(',')}]\` : choices[0];
            console.log(\`[*] \${isMultiple ? 'MULTI' : 'SINGLE'} CHOICE Q\${quizData.questionIndex} = \${choiceStr} (\${direction})\`);
            
            window.dispatchEvent(new CustomEvent('kahootAnswer', { 
              detail: { data, direction, quizData, choices } 
            }));
          });
        };
        
        const extractIdentifiers = (data) => {
          window.dispatchEvent(new CustomEvent('kahootData', { detail: data }));
        };
        
        window.WebSocket = function(url, protocols) {
          const ws = new NativeWebSocket(url, protocols);
          if (!isCometDEndpoint(url)) return ws;
          
          console.log("[+] CometD WebSocket created");
          
          return new Proxy(ws, {
            get(target, prop) {
              const value = Reflect.get(target, prop);
              
              if (prop === 'send' && typeof value === 'function') {
                return function(...args) {
                  extractIdentifiers(args[0]);
                  if (containsQuizAnswer(args[0])) logQuizAnswer(args[0], "SEND");
                  return value.apply(target, args);
                };
              }
              
              if (prop === 'addEventListener' && typeof value === 'function') {
                return function(type, listener, options) {
                  const wrappedListener = type === 'message' ? function(event) {
                    extractIdentifiers(event.data);
                    if (containsQuizAnswer(event.data)) logQuizAnswer(event.data, "RECEIVE");
                    return listener?.call(this, event);
                  } : listener;
                  return value.call(target, type, wrappedListener, options);
                };
              }
              
              return value;
            },
            
            set(target, prop, value) {
              if (prop === 'onmessage' && typeof value === 'function') {
                const wrappedHandler = function(event) {
                  extractIdentifiers(event.data);
                  if (containsQuizAnswer(event.data)) logQuizAnswer(event.data, "RECEIVE");
                  return value.call(this, event);
                };
                return Reflect.set(target, prop, wrappedHandler);
              }
              return Reflect.set(target, prop, value);
            }
          });
        };
        
        Object.setPrototypeOf(window.WebSocket, NativeWebSocket);
        Object.defineProperty(window.WebSocket, 'prototype', { value: NativeWebSocket.prototype });
        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(prop => {
          window.WebSocket[prop] = NativeWebSocket[prop];
        });
        
        console.log("[+] Kahoot quiz answer interceptor active");
      })();

      (document.head || document.documentElement).appendChild(script);
      script.remove();
    `;

      (document.head || document.documentElement).appendChild(script);
      script.remove();
      `;

      (document.head || document.documentElement).appendChild(script);
      script.remove();
    `;
    },

    setupHTTPInterceptors: () => {

      const originalXHRSend = XMLHttpRequest.prototype.send;
      const kahootXHRSendHandler = function (data) {
        if (kahootModule.isCometDEndpoint(this._interceptedUrl)) {
          kahootModule.extractIdentifiers(data);
          if (kahootModule.containsQuizAnswer(data)) {
            kahootModule.logQuizAnswer(data, "XHR SEND");
          }
        }
        return originalXHRSend.call(this, data);
      };

      const originalXHROpen = XMLHttpRequest.prototype.open;
      const kahootXHROpenHandler = function (method, url, ...args) {
        this._interceptedUrl = url;
        return originalXHROpen.call(this, method, url, ...args);
      };

      if (!XMLHttpRequest.prototype.send._kahootPatched) {
        XMLHttpRequest.prototype.send = kahootXHRSendHandler;
        XMLHttpRequest.prototype.send._kahootPatched = true;
      }

      if (!XMLHttpRequest.prototype.open._kahootPatched) {
        XMLHttpRequest.prototype.open = kahootXHROpenHandler;
        XMLHttpRequest.prototype.open._kahootPatched = true;
      }

      const kahootOriginalFetch = window.fetch;
      if (!window.fetch._kahootPatched) {
        window.fetch = function (input, init) {
          const url = typeof input === 'string' ? input : input.url;
          if (kahootModule.isCometDEndpoint(url) && init?.body) {
            kahootModule.extractIdentifiers(init.body);
            if (kahootModule.containsQuizAnswer(init.body)) {
              kahootModule.logQuizAnswer(init.body, "FETCH SEND");
            }
          }
          return kahootOriginalFetch.apply(this, arguments);
        };
        window.fetch._kahootPatched = true;
      }
    },

    initialize: () => {

      kahootModule.injectScript();
      kahootModule.setupHTTPInterceptors();

      // Listen for events from injected script
      window.addEventListener('kahootData', (event) => {
        kahootModule.extractIdentifiers(event.detail);
      });

      window.addEventListener('kahootAnswer', (event) => {
        const { direction, quizData, choices } = event.detail;
        if (direction === "SEND") {
          kahootModule.sendAnswerToServer(quizData.questionIndex, choices);
        }
      });

      // Periodically update indicators
      setInterval(() => {
        kahootModule.updateAnswerIndicators();
      }, 200);
    }
  };


  // WAYGROUND MODULE
  const waygroundModule = {
    selectors: {
      questionContainer: 'div[data-testid="question-container-text"]',
      questionText:
        'div[data-testid="question-container-text"] .question-text-color',
      questionImage:
        'div[data-testid="question-container-text"] img, div[class*="question-media-container"] img, img[data-testid="question-container-image"], .question-image',
      optionButtons: "button.option",
      optionText: "div#optionText div.resizeable, .option-text div.resizeable, div.resizeable",
      pageInfo: 'div.pill p, div[class*="question-counter"] p',
      quizContainer: "div[data-quesid]",
    },

    lastPageInfo: "INITIAL_STATE",

    debounce: (func, wait) => {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    },

    getCurrentQuestionId: () => {
      const quizContainer = document.querySelector(
        waygroundModule.selectors.quizContainer,
      );
      return quizContainer ? quizContainer.getAttribute("data-quesid") : null;
    },

    extractAndProcess: async () => {
      if (!sharedState.uiModificationsEnabled) return;

      document
        .querySelectorAll(
          ".uets-ddg-link, .uets-gemini-button, .uets-copy-prompt-button, .uets-get-answer-button, .uets-main-question-buttons-container, .uets-streak-bonus",
        )
        .forEach((el) => el.remove());

      document.querySelectorAll(".uets-option-wrapper").forEach((wrapper) => {
        const button = wrapper.querySelector("button.option");
        if (button && wrapper.parentNode) {
          wrapper.parentNode.insertBefore(button, wrapper);
        }
        wrapper.remove();
      });

      sharedState.elementsToCleanup = sharedState.elementsToCleanup.filter(
        (el) => {
          return el && el.parentNode;
        },
      );

      const currentQuestionId = waygroundModule.getCurrentQuestionId();
      if (currentQuestionId !== sharedState.currentQuestionId) {
        sharedState.currentQuestionId = currentQuestionId;

        if (currentQuestionId && sharedState.quizData[currentQuestionId]) {
          const questionData = sharedState.quizData[currentQuestionId];
          const response = await sendQuestionToServer(
            currentQuestionId,
            questionData.type,
            questionData.structure.options
              ? questionData.structure.options.map((opt) => opt.id)
              : [],
          );

          if (response && response.hasAnswer) {
            highlightCorrectAnswers(
              response.correctAnswers,
              response.questionType,
            );
          }
        }
      }

      let questionTitle = "";
      let optionTexts = [];
      let questionImageUrl = null;

      const questionImageElement = document.querySelector(
        waygroundModule.selectors.questionImage,
      );
      if (questionImageElement?.src) {
        questionImageUrl = questionImageElement.src.startsWith("/")
          ? window.location.origin + questionImageElement.src
          : questionImageElement.src;
      }

      const questionTitleTextElement = document.querySelector(
        waygroundModule.selectors.questionText,
      );
      const questionTextOuterContainer = document.querySelector(
        waygroundModule.selectors.questionContainer,
      );

      // Extract options first
      const optionButtons = document.querySelectorAll(
        waygroundModule.selectors.optionButtons,
      );
      optionButtons.forEach((button) => {
        const text = button
          .querySelector(waygroundModule.selectors.optionText)
          ?.textContent.trim();
        if (text) optionTexts.push(text);
      });

      if (questionTitleTextElement && questionTextOuterContainer) {
        questionTitle = questionTitleTextElement.textContent.trim();

        if (questionTitle || questionImageUrl || optionTexts.length > 0) {
          addQuestionButtons(
            questionTextOuterContainer,
            questionTitle,
            optionTexts,
            questionImageUrl,
            "quiz",
            true,
            "DDG",
          );
        }
      }
    },

    checkPageInfoAndReprocess: () => {
      const pageInfoElement = document.querySelector(
        waygroundModule.selectors.pageInfo,
      );
      let currentPageInfoText = pageInfoElement
        ? pageInfoElement.textContent.trim()
        : "";

      if (currentPageInfoText !== waygroundModule.lastPageInfo) {
        waygroundModule.lastPageInfo = currentPageInfoText;
        waygroundModule.extractAndProcess();
      }
    },

    enhanceStreakCounter: () => {
      const streakSpan = document.querySelector(
        'span[data-testid="streak-pill-level"]',
      );
      if (
        streakSpan &&
        !streakSpan.nextSibling?.classList?.contains("uets-streak-bonus")
      ) {
        const bonusSpan = document.createElement("span");
        bonusSpan.classList.add("uets-streak-bonus");
        streakSpan.parentNode.insertBefore(bonusSpan, streakSpan.nextSibling);

        const updateBonus = () => {
          const level = parseInt(streakSpan.textContent.trim()) || 0;
          let bonus = 0;
          if (level >= 1 && level <= 3) bonus = 100;
          else if (level >= 4 && level <= 6) bonus = 200;
          else if (level >= 7) bonus = 300;
          bonusSpan.textContent = `+${bonus}`;
        };

        updateBonus();

        // Observe changes to the streak span's text
        const observer = new MutationObserver(updateBonus);
        observer.observe(streakSpan, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
    },

    modifyTabLeaveWarning: () => {
      const ruleDiv = document.querySelector('.test-mode-container');
      if (ruleDiv) {
        if (sharedState.originalTabLeaveHTML === null) {
          sharedState.originalTabLeaveHTML = ruleDiv.innerHTML;
        }
        ruleDiv.innerHTML = "<h4 data-v-aceb3d94=\"\" class=\"heading\">Teacher rules bypassed:  </h4><div data-v-aceb3d94=\"\" class=\"test-mode-rules\"><!----><div data-v-aceb3d94=\"\" class=\"rule\">You can leave the Wayground tab during this session. To remove fullscreen warnings enable fullscreen spoofing in settings.</div></div>";
      }
    },

    modifyStartButton: () => {
      const startButton = document.querySelector('.start-game');
      if (startButton) {
        const span = startButton.querySelector('span');
        if (span && span.textContent.includes('Start in fullscreen mode')) {
          if (sharedState.originalStartButtonText === null) {
            sharedState.originalStartButtonText = span.textContent;
          }
          span.textContent = 'Start game';
        }
      }
    },

    initialize: () => {
      waygroundModule.lastPageInfo = "INITIAL_STATE";

      if (sharedState.observer) sharedState.observer.disconnect();

      sharedState.observer = new MutationObserver(
        waygroundModule.debounce(() => {
          if (sharedState.uiModificationsEnabled) {
            waygroundModule.checkPageInfoAndReprocess();
            waygroundModule.enhanceStreakCounter();
            waygroundModule.modifyTabLeaveWarning();
            waygroundModule.modifyStartButton();
          }
        }, 500),
      );

      sharedState.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      if (sharedState.uiModificationsEnabled) {
        waygroundModule.extractAndProcess();
        waygroundModule.enhanceStreakCounter();
        waygroundModule.modifyTabLeaveWarning();
        waygroundModule.modifyStartButton();
        // Add delay to check for existing streak element
        // NOTE: this may not be enough on shitty connections
        setTimeout(() => waygroundModule.enhanceStreakCounter(), 1000);
      }
    },
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
      if (
        !sharedState.uiModificationsEnabled ||
        qEssenceEl.dataset.enhancementsAdded
      )
        return;

      let questionTextContent = (
        qEssenceEl.innerText ||
        qEssenceEl.textContent ||
        ""
      ).trim();
      if (!questionTextContent) return;

      const questionContainer = qEssenceEl.closest(
        ".question_container_wrapper, .question-view, .question-content, form, div.row, .question_row_content_container, .question_item_view_v2, .q_tresc_pytania_mock, .question_essence_fs",
      );
      let answerElements = [];

      if (questionContainer) {
        answerElements = Array.from(
          questionContainer.querySelectorAll(
            ".answer_body, .answer-body, .odpowiedz_tresc",
          ),
        );
      } else {
        const formElement = qEssenceEl.closest("form");
        if (formElement) {
          answerElements = Array.from(
            formElement.querySelectorAll(
              ".answer_body, .answer-body, .odpowiedz_tresc",
            ),
          );
        }
      }

      const options = answerElements
        .map((optEl) => (optEl.innerText || optEl.textContent || "").trim())
        .filter(Boolean);

      let questionImageElement = qEssenceEl.querySelector("img");
      if (!questionImageElement && questionContainer) {
        questionImageElement = questionContainer.querySelector(
          "img.question-image, img.question_image_preview, .question_media img, .question-body__attachment img, .image_area img",
        );
      }

      const imageUrl = questionImageElement ? questionImageElement.src : null;

      if (questionTextContent || imageUrl || options.length > 0) {
        addQuestionButtons(
          qEssenceEl,
          questionTextContent,
          options,
          imageUrl,
          "test",
          false,
          "DDG",
        );
      }

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
            if (mutation.type === "childList") {
              for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  if (
                    node.classList &&
                    (node.classList.contains("question_essence") ||
                      node.querySelector(".question_essence"))
                  ) {
                    if (node.classList.contains("question_essence")) {
                      testportalModule.processQuestionElement(node);
                    } else {
                      const qElements =
                        node.getElementsByClassName("question_essence");
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

        sharedState.observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      } else {
        RegExp.prototype.test = sharedState.originalRegExpTest;
      }
    },
  };

  // GOOGLE FORMS MODULE
  const googleFormsModule = {
    handleCopyClick: (event) => {
      event.preventDefault();
      const button = event.target;
      const questionBlock = button.closest("div[jsmodel]");
      if (!questionBlock) return;

      const questionTitleEl = questionBlock.querySelector(
        'div[role="heading"] > span:first-child',
      );
      const questionTitle = questionTitleEl
        ? questionTitleEl.textContent.trim()
        : "Question not found";

      let promptText = "";
      let questionType = "Unknown Type";
      let options = [];

      const radioOptions = questionBlock.querySelectorAll('div[role="radio"]');
      if (radioOptions.length > 0) {
        questionType = "Single Choice";
        radioOptions.forEach((radio) => {
          const label = radio.getAttribute("aria-label");
          if (label) options.push(`- ${label}`);
        });
      } else {
        const checkOptions = questionBlock.querySelectorAll(
          'div[role="checkbox"]',
        );
        if (checkOptions.length > 0) {
          questionType = "Multi Choice (Select all that apply)";
          checkOptions.forEach((check) => {
            const label =
              check.getAttribute("aria-label") ||
              check.getAttribute("data-answer-value");
            if (label) options.push(`- ${label}`);
          });
        } else {
          const textInput = questionBlock.querySelector(
            'div[role="textbox"], textarea, input[type="text"]',
          );
          if (textInput) {
            questionType = "Free Text";
          }
        }
      }

      promptText = `[${questionType}]\nQuestion: ${questionTitle}`;
      if (options.length > 0) {
        promptText += "\n\nOptions:\n" + options.join("\n");
      }

      const instructionText =
        "Reply with the correct answer and a quick reasoning why it is the correct answer. Don't over-complicate stuff.";
      promptText += `\n\n${instructionText}`;

      GM_setClipboard(promptText);

      const originalText = button.textContent;
      button.textContent = "Copied!";
      button.disabled = true;
      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1500);
    },

    handleAiClick: async (event) => {
      event.preventDefault();
      const button = event.target;
      const questionBlock = button.closest("div[jsmodel]");
      if (!questionBlock) return;

      const questionTitleEl = questionBlock.querySelector(
        'div[role="heading"] > span:first-child',
      );
      const questionTitle = questionTitleEl
        ? questionTitleEl.textContent.trim()
        : "Question not found";

      let options = [];

      const radioOptions = questionBlock.querySelectorAll('div[role="radio"]');
      if (radioOptions.length > 0) {
        radioOptions.forEach((radio) => {
          const label = radio.getAttribute("aria-label");
          if (label) options.push(label);
        });
      } else {
        const checkOptions = questionBlock.querySelectorAll(
          'div[role="checkbox"]',
        );
        if (checkOptions.length > 0) {
          checkOptions.forEach((check) => {
            const label =
              check.getAttribute("aria-label") ||
              check.getAttribute("data-answer-value");
            if (label) options.push(label);
          });
        }
      }

      askGemini(questionTitle, options, null, "form");
    },

    handleDdgClick: (event) => {
      event.preventDefault();
      const button = event.target;
      const questionBlock = button.closest("div[jsmodel]");
      if (!questionBlock) return;

      const questionTitleEl = questionBlock.querySelector(
        'div[role="heading"] > span:first-child',
      );
      const questionTitle = questionTitleEl
        ? questionTitleEl.textContent.trim()
        : "Question not found";

      window.open(
        `https://duckduckgo.com/?q=${encodeURIComponent(questionTitle)}`,
        "_blank",
      );
    },

    addButtons: () => {
      if (!sharedState.uiModificationsEnabled) return;

      const questionBlocks = document.querySelectorAll(
        'div[role="listitem"] > div[jsmodel]',
      );

      questionBlocks.forEach((block) => {
        if (block.dataset.uetsButtonsAdded) return;
        block.dataset.uetsButtonsAdded = "true";

        // Find the heading container (the question text/title)
        const headingContainer = block.querySelector('div[role="heading"]');
        if (!headingContainer) return;

        // Extract question text
        const questionTitleEl = headingContainer.querySelector('span');
        const questionText = questionTitleEl
          ? questionTitleEl.textContent.trim()
          : "Question not found";

        // Extract options
        let options = [];
        const radioOptions = block.querySelectorAll('div[role="radio"]');
        if (radioOptions.length > 0) {
          radioOptions.forEach((radio) => {
            const label = radio.getAttribute("aria-label");
            if (label) options.push(label);
          });
        } else {
          const checkOptions = block.querySelectorAll('div[role="checkbox"]');
          if (checkOptions.length > 0) {
            checkOptions.forEach((check) => {
              const label =
                check.getAttribute("aria-label") ||
                check.getAttribute("data-answer-value");
              if (label) options.push(label);
            });
          }
        }

        // Extract image URL if present (assuming images are in the block)
        let imageUrl = null;
        const imageElement = block.querySelector('img');
        if (imageElement && imageElement.src) {
          imageUrl = imageElement.src.startsWith("/")
            ? window.location.origin + imageElement.src
            : imageElement.src;
        }

        // Use addQuestionButtons to add the buttons
        const buttonsContainer = document.createElement("div");
        buttonsContainer.classList.add("uets-main-question-buttons-container");
        addQuestionButtons(
          buttonsContainer,
          questionText,
          options,
          imageUrl,
          "form",
          false,
          "DDG",
        );

        // Insert the buttonsContainer directly after the headingContainer
        if (headingContainer.parentNode === block) {
          block.insertBefore(buttonsContainer, headingContainer.nextSibling);
        } else {
          headingContainer.parentNode.insertBefore(buttonsContainer, headingContainer.nextSibling);
        }
        sharedState.elementsToCleanup.push(buttonsContainer);
      });
    },

    initialize: () => {
      if (sharedState.observer) sharedState.observer.disconnect();

      sharedState.observer = new MutationObserver(() => {
        googleFormsModule.addButtons();
      });

      sharedState.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      googleFormsModule.addButtons();
    },
  };

  // === SHARED QUIZ DATA PROCESSOR ===
  const processQuizData = (data) => {
    GM_log("[*] Trying to get all questions...");
    try {
      var questionKeys = Object.keys(data.data.room.questions);
    } catch (e) {
      var questionKeys = Object.keys(data.room.questions);
    }
    for (const questionKey of questionKeys) {
      GM_log("[*] ----------------");
      try {
        var questionData = data.data.room.questions[questionKey];
      } catch (e) {
        var questionData = data.room.questions[questionKey];
      }
      sharedState.quizData[questionKey] = questionData;

      // Store the complete question data in questionsPool
      sharedState.questionsPool[questionKey] = questionData;

      GM_log(`[+] Question ID: ${questionKey}`);
      GM_log(`[+] Question Type: ${questionData.type}`);
      GM_log(`[+] Question Text: ${questionData.structure.query.text}`);
      if (questionData.structure.query.media) {
        for (const media of questionData.structure.query.media) {
          GM_log(`[+] Media URL: ${media.url} (Type: ${media.type})`);
        }
      }
      const options = questionData.structure.options || [];
      for (const option of options) {
        GM_log(`[+] Option: ${option.text} (${option.id})`);
        if (option.media) {
          for (const media of option.media) {
            GM_log(`[+] Media URL: ${media.url} (Type: ${media.type})`);
          }
        }
      }
    }
  };

  // === REQUEST INTERCEPTION ===
  const originalXMLHttpRequestOpen = XMLHttpRequest.prototype.open;
  const originalXMLHttpRequestSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this._method = method;
    this._url = url;

    if (
      typeof url === "string" &&
      (url.includes("play-api/createTestGameActivity") && (url.includes("wayground.com") || url.includes("quizizz.com")))
    ) {
      this._blocked = true;
      GM_log("[+] Blocked cheating detection request to createTestGameActivity");
    }

    if (
      typeof url === "string" &&
      (url.includes("play-api") &&
        (url.includes("soloJoin") || url.includes("rejoinGame") || url.includes("join")) &&
        (url.includes("wayground.com") || url.includes("quizizz.com")))
    ) {
      this.addEventListener("load", function () {
        if (this.status === 200) {
          try {
            const data = JSON.parse(this.responseText);
            processQuizData(data);
          } catch (e) {
            GM_log("[!] Failed to parse response:", e);
          }
        }
      });
    }

    if (
      typeof url === "string" &&
      (url.includes("play-api") &&
        (url.includes("proceedGame") || url.includes("soloProceed")) &&
        (url.includes("wayground.com") || url.includes("quizizz.com")))
    ) {
      this.addEventListener("load", function () {
        if (this.status === 200) {
          try {
            const data = JSON.parse(this.responseText);
            processProceedGameResponse(data);
          } catch (e) {
            GM_log("[!] Failed to parse proceedGame response:", e);
          }
        }
      });
    }

    return originalXMLHttpRequestOpen.call(this, method, url, ...args);
  };

  XMLHttpRequest.prototype.send = function (data) {
    // Block cheating detection requests
    if (this._blocked) {
      GM_log("[+] Cheating detection request blocked - not sending data");
      return;
    }

    // Intercept TestPortal requests and force wb=0
    if (
      this._method === "POST" &&
      this._url &&
      (this._url.includes("testportal.net") || this._url.includes("testportal.pl")) &&
      this._url.includes("DoTestQuestion.html") &&
      data &&
      typeof data === "string"
    ) {
      try {
        const urlParams = new URLSearchParams(data);
        if (urlParams.has('wb')) {
          const originalWb = urlParams.get('wb');
          urlParams.set('wb', '0');
          const modifiedData = urlParams.toString();
          GM_log(`[+] Modified TestPortal wb parameter from ${originalWb} to 0`);
          return originalXMLHttpRequestSend.call(this, modifiedData);
        }
      } catch (e) {
        GM_log("[!] Failed to modify TestPortal request:", e);
      }
    }

    // Intercept POST requests to proceedGame and modify timeTaken
    if (
      this._method === "POST" &&
      this._url &&
      (this._url.includes("play-api") &&
        (this._url.includes("proceedGame") || this._url.includes("soloProceed")) &&
        (this._url.includes("wayground.com") || this._url.includes("quizizz.com")))
    ) {
      if (data) {
        try {
          let requestData = JSON.parse(data);

          requestData = processProceedGameRequest(requestData);

          const modifiedData = JSON.stringify(requestData);

          return originalXMLHttpRequestSend.call(this, modifiedData);
        } catch (e) {
          GM_log("[!] Failed to parse/modify proceedGame request:", e);
          return originalXMLHttpRequestSend.call(this, data);
        }
      }
    }

    // Intercept requests to reaction-update and resend twice
    if (
      this._method === "POST" &&
      this._url &&
      (this._url.includes("wayground.com") || this._url.includes("quizizz.com")) &&
      this._url.includes("_gameapi/main/public/v1/games/",) &&
      this._url.includes("/reaction-update")
    ) {
      // Send original request
      const result = originalXMLHttpRequestSend.call(this, data);
      // Resend based on config
      if (sharedState.config.enableReactionSpam) {
        for (let i = 1; i <= sharedState.config.reactionSpamCount; i++) {
          setTimeout(() => {
            const xhr = new XMLHttpRequest();
            xhr.open(this._method, this._url);
            xhr.send(data);
          }, sharedState.config.reactionSpamDelay * i);
        }
      }
      return result;
    }

    return originalXMLHttpRequestSend.call(this, data);
  };

  const originalFetch = window.fetch;
  window.fetch = function (url, options) {
    // Block cheating detection requests
    if (
      typeof url === "string" &&
      (url.includes("play-api/createTestGameActivity") && (url.includes("wayground.com") || url.includes("quizizz.com")))
    ) {
      GM_log("[+] Blocked cheating detection request to createTestGameActivity");
      return Promise.resolve(
        new Response(JSON.stringify({}), { status: 200, statusText: "OK" }),
      );
    }

    // Intercept TestPortal requests via fetch and force wb=0
    if (
      typeof url === "string" &&
      (url.includes("testportal.net") || url.includes("testportal.pl")) &&
      url.includes("DoTestQuestion.html") &&
      options &&
      options.method === "POST" &&
      options.body &&
      typeof options.body === "string"
    ) {
      try {
        const urlParams = new URLSearchParams(options.body);
        if (urlParams.has('wb')) {
          const originalWb = urlParams.get('wb');
          urlParams.set('wb', '0');
          const modifiedOptions = {
            ...options,
            body: urlParams.toString(),
          };
          GM_log(`[+] Modified TestPortal wb parameter from ${originalWb} to 0`);
          return originalFetch.call(this, url, modifiedOptions);
        }
      } catch (e) {
        GM_log("[!] Failed to modify TestPortal fetch request:", e);
      }
    }

    // Intercept POST requests to proceedGame via fetch
    if (
      typeof url === "string" &&
      (url.includes("play-api") &&
        (url.includes("proceedGame") || url.includes("soloProceed")) &&
        (url.includes("wayground.com") || url.includes("quizizz.com"))) &&
      options &&
      options.method === "POST" &&
      options.body
    ) {
      try {
        let requestData = JSON.parse(options.body);

        requestData = processProceedGameRequest(requestData);

        const modifiedOptions = {
          ...options,
          body: JSON.stringify(requestData),
        };

        return originalFetch.call(this, url, modifiedOptions);
      } catch (e) {
        GM_log("[!] Failed to parse/modify proceedGame fetch request:", e);
      }
    }

    // Intercept requests to reaction-update via fetch
    if (
      typeof url === "string" &&
      (url.includes("wayground.com") || url.includes("quizizz.com")) &&
      url.includes("_gameapi/main/public/v1/games/") &&
      url.includes("/reaction-update") &&
      options &&
      options.method === "POST" &&
      options.body &&
      sharedState.config.enableReactionSpam
    ) {
      // Send original request
      const result = originalFetch.call(this, url, options);
      // Resend based on config
      for (let i = 1; i <= sharedState.config.reactionSpamCount; i++) {
        setTimeout(() => {
          originalFetch.call(this, url, options);
        }, sharedState.config.reactionSpamDelay * i);
      }
      return result;
    }

    if (
      typeof url === "string" &&
      (url.includes("play-api") &&
        (url.includes("soloJoin") || url.includes("rejoinGame") || url.includes("join")) &&
        (url.includes("wayground.com") || url.includes("quizizz.com")))
    ) {
      return originalFetch.call(this, url, options).then((response) => {
        if (response.ok) {
          return response
            .clone()
            .json()
            .then((data) => {
              processQuizData(data);
              return response;
            })
            .catch(() => response);
        }
        return response;
      });
    }

    if (
      typeof url === "string" &&
      (url.includes("play-api") &&
        (url.includes("proceedGame") || url.includes("soloProceed")) &&
        (url.includes("wayground.com") || url.includes("quizizz.com")))
    ) {
      return originalFetch.call(this, url, options).then((response) => {
        if (response.ok) {
          return response
            .clone()
            .json()
            .then((data) => {
              processProceedGameResponse(data);
              return response;
            })
            .catch(() => response);
        }
        return response;
      });
    }

    return originalFetch.call(this, url, options);
  };

  // === DOMAIN DETECTION AND INITIALIZATION ===
  const initializeDomainSpecific = () => {
    const hostname = window.location.hostname;

    if (hostname.includes("kahoot.it")) {
      GM_log("[*] Initializing Kahoot module...");
      kahootModule.initialize();
    } else if (
      hostname.includes("quizizz.com") ||
      hostname.includes("wayground.com")
    ) {
      GM_log("[*] Initializing Wayground module...");
      if (sharedState.config.enableSpoofFullscreen) {
        spoofFullscreenAndFocus();
      }
      waygroundModule.initialize();
    } else if (
      hostname.includes("testportal.net") ||
      hostname.includes("testportal.pl")
    ) {
      GM_log("[*] Initializing Testportal module...");
      if (sharedState.config.enableSpoofFullscreen) {
        spoofFullscreenAndFocus();
      }
      testportalModule.initialize();
    } else if (
      hostname.includes("docs.google.com") &&
      window.location.pathname.includes("/forms/")
    ) {
      GM_log("[*] Initializing Google Forms module...");
      googleFormsModule.initialize();
    }
  };

  // === MAIN INITIALIZATION ===
  const main = () => {
    // Load config on startup
    const savedConfig = GM_getValue(CONFIG_STORAGE_KEY, null);
    if (savedConfig) {
      sharedState.config = { ...DEFAULT_CONFIG, ...savedConfig };
    }
    // Sync API key from old storage if config doesn't have it
    if (!sharedState.config.geminiApiKey) {
      sharedState.config.geminiApiKey = GM_getValue(GEMINI_API_KEY_STORAGE, "");
    }

    createToggleButton();
    initializeDomainSpecific();
    GM_log(`[+] UETS loaded on ${sharedState.currentDomain}`);
    GM_log(`[+] Made by Nyx (with the slight help of GH Copilot)`);

    // Check for first run and show welcome popup
    if (!GM_getValue(sharedState.firstRunKey, false)) {
      GM_setValue(sharedState.firstRunKey, true);
      setTimeout(() => showWelcomePopup(), 1000); // Delay to ensure page is loaded
    }
  };

  if (document.body) {
    main();
  } else {
    window.addEventListener("DOMContentLoaded", main);
  }
})();
