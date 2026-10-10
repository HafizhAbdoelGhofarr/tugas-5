/* ============================================================
   app.js — HAFIZ AI Push-to-Talk
   ============================================================ */

'use strict';

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
    webhookUrl:    'http://localhost:5678/webhook-test/jarvis-chat',
    sessionKey:    'hafiz_session_id',
    numParticles:  80,
    ttsRate:       0.9,
    ttsPitch:      1.0,
    ttsVolume:     1.0,
    cpuInterval:   1000,
};

// ============================================================
// STATE ENUM
// ============================================================
const State = Object.freeze({
    STANDBY:   'STANDBY',
    LISTENING: 'LISTENING',
    THINKING:  'THINKING',
    RESPONDING:'RESPONDING',
});

// ============================================================
// DOM REFERENCES
// ============================================================
const el = {
    app:       document.getElementById('app'),
    boot:      document.getElementById('boot-screen'),
    chatBox:   document.getElementById('chat-box'),
    placeholder: document.getElementById('chat-placeholder'),
    aiStatus:  document.getElementById('ai-status'),
    micStatus: document.getElementById('mic-status'),
    cpuValue:  document.getElementById('cpu-value'),
    sessionDisplay: document.getElementById('session-display'),
    talkBtn:   document.getElementById('talk-btn'),
    stopBtn:   document.getElementById('stop-btn'),
    ttsInfo:   document.getElementById('tts-info'),
};

// ============================================================
// RUNTIME STATE
// ============================================================
let isSystemActive = false;
let isAiSpeaking   = false;
let currentState   = State.STANDBY;

// ============================================================
// SESSION MANAGEMENT
// ============================================================
function getSessionId() {
    const existing = sessionStorage.getItem(CONFIG.sessionKey);
    if (existing) return existing;
    const id = `usr_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
    sessionStorage.setItem(CONFIG.sessionKey, id);
    return id;
}

// ============================================================
// PARTICLE SYSTEM
// ============================================================
const particleCloud = document.getElementById('particle-cloud');
const particles = [];

function initParticles() {
    for (let i = 0; i < CONFIG.numParticles; i++) {
        const node   = document.createElement('div');
        node.className = 'particle';

        const theta  = Math.random() * 2 * Math.PI;
        const phi    = Math.acos(Math.random() * 2 - 1);
        const radius = 55 + Math.random() * 65;

        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.sin(phi) * Math.sin(theta);
        const z = radius * Math.cos(phi);

        node.style.transform = `translate3d(${x}px,${y}px,${z}px)`;
        particleCloud.appendChild(node);
        particles.push({ node, x, y, z });
    }
}

// ============================================================
// ANIMATION LOOP
// ============================================================
const coreOrb = document.getElementById('core-orb');

function startAnimationLoop() {
    function tick() {
        requestAnimationFrame(tick);
        const t   = Date.now() / 150;
        let total = 0;

        particles.forEach((p, i) => {
            const wave = Math.abs(Math.sin(t + i * 0.11));
            let expand = 1;
            let color  = 'var(--c-gold)';

            switch (currentState) {
                case State.LISTENING:
                    expand = 1 + wave * 0.55;
                    color  = wave > 0.65 ? '#fff' : 'var(--c-green)';
                    break;
                case State.THINKING:
                    expand = 1 + wave * 0.62;
                    color  = wave > 0.7 ? '#fff' : 'var(--c-blue)';
                    total += wave;
                    break;
                case State.RESPONDING:
                    expand = 1 + wave * 0.58;
                    color  = wave > 0.7 ? '#fff' : 'var(--c-orange)';
                    total += wave;
                    break;
            }

            p.node.style.transform = `translate3d(${p.x*expand}px,${p.y*expand}px,${p.z*expand}px) scale(${expand})`;
            p.node.style.background = color;
        });

        if (currentState === State.THINKING || currentState === State.RESPONDING) {
            coreOrb.style.transform = `scale(${1 + (total / CONFIG.numParticles) * 0.2})`;
        } else if (currentState === State.LISTENING) {
            coreOrb.style.transform = `scale(${Math.min(1 + Math.abs(Math.sin(t * 1.4)) * 0.13, 1.25)})`;
        } else {
            coreOrb.style.transform = 'scale(1)';
        }
    }
    tick();
}

// ============================================================
// STATE MANAGER
// ============================================================
function setState(state) {
    currentState = state;

    // Update app class for CSS-driven orb transitions
    el.app.dataset.state = state;
    el.app.className = state !== State.STANDBY && state !== State.RESPONDING
        ? `state-${state.toLowerCase()}`
        : '';

    el.aiStatus.textContent = state;

    const btnLabel = el.talkBtn.querySelector('.btn-label');

    switch (state) {
        case State.LISTENING:
            setMicStatus('RECORDING', 'var(--c-green)');
            btnLabel.textContent = 'Mendengarkan...';
            el.talkBtn.classList.add('recording');
            el.talkBtn.disabled = false;
            el.stopBtn.classList.remove('visible');
            break;

        case State.THINKING:
            setMicStatus('SYNC', 'var(--c-blue)');
            btnLabel.textContent = 'Memproses...';
            el.talkBtn.classList.remove('recording');
            el.talkBtn.disabled = true;
            el.stopBtn.classList.remove('visible');
            break;

        case State.RESPONDING:
            btnLabel.textContent = 'Tekan untuk Bicara';
            el.talkBtn.classList.remove('recording');
            el.talkBtn.disabled = false;
            el.stopBtn.classList.add('visible');
            break;

        default: // STANDBY
            setMicStatus('READY', 'var(--c-orange)');
            btnLabel.textContent = 'Tekan untuk Bicara';
            el.talkBtn.classList.remove('recording');
            el.talkBtn.disabled = false;
            el.stopBtn.classList.remove('visible');
            break;
    }
}

function setMicStatus(text, color) {
    el.micStatus.textContent = text;
    el.micStatus.style.color = color;
}

// ============================================================
// CHAT BUBBLE RENDERER
// ============================================================
function hidePlaceholder() {
    if (el.placeholder) {
        el.placeholder.style.display = 'none';
    }
}

function createBubble(type) {
    // type: 'user' | 'ai' | 'thinking' | 'error'
    const wrap = document.createElement('div');
    wrap.className = `bubble bubble-${type}`;

    const sender = document.createElement('div');
    sender.className = 'bubble-sender';
    sender.textContent = type === 'user' ? 'Kamu' : type === 'thinking' ? '' : 'HAFIZ.AI';

    const content = document.createElement('div');
    content.className = 'bubble-content';

    wrap.appendChild(sender);
    wrap.appendChild(content);
    return { wrap, content };
}

function appendBubble(wrap) {
    hidePlaceholder();
    el.chatBox.appendChild(wrap);
    el.chatBox.scrollTop = el.chatBox.scrollHeight;
}

function renderUserBubble(text) {
    const { wrap, content } = createBubble('user');
    content.textContent = text;
    appendBubble(wrap);
    return wrap;
}

function renderThinkingBubble() {
    const { wrap, content } = createBubble('thinking');
    wrap.id = 'thinking-bubble';
    content.innerHTML = `
        <div class="thinking-dots">
            <span></span><span></span><span></span>
        </div>
        Memproses...
    `;
    appendBubble(wrap);
    return wrap;
}

function removeThinkingBubble() {
    const b = document.getElementById('thinking-bubble');
    if (b) b.remove();
}

function renderAiBubble(text) {
    const { wrap, content } = createBubble('ai');
    // Convert line breaks to <br>
    content.innerHTML = text.replace(/\n/g, '<br>');
    appendBubble(wrap);
}

function renderErrorBubble(msg) {
    const { wrap, content } = createBubble('error');
    content.textContent = `⚠ ${msg}`;
    appendBubble(wrap);
}

// ============================================================
// SPEECH RECOGNITION
// ============================================================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = 'id-ID';
recognition.interimResults = false;
recognition.maxAlternatives = 1;

recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;

    renderUserBubble(transcript);
    const thinkBubble = renderThinkingBubble();
    setState(State.THINKING);

    try {
        const response = await fetch(CONFIG.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message:    transcript,
                chatInput:  transcript,
                session_id: getSessionId(),
            }),
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        const data   = await response.json();
        const raw    = data.reply || data.output || 'Reaktor tidak memberikan respons.';
        const cleaned = raw.replace(/[*#_`~<>\\]/g, ' ').trim();

        removeThinkingBubble();
        renderAiBubble(cleaned);
        setState(State.RESPONDING);
        speakText(cleaned);

    } catch (err) {
        removeThinkingBubble();
        renderErrorBubble(err.message);
        setState(State.STANDBY);
    }
};

recognition.onerror = (e) => {
    console.error('Speech recognition error:', e.error);
    setState(State.STANDBY);
};

// ============================================================
// SPEECH SYNTHESIS (TTS)
// ============================================================
const synth = window.speechSynthesis;
let cachedVoices = [];

function loadVoices() {
    cachedVoices = synth.getVoices();
}

loadVoices();
if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = loadVoices;
}

function getBestVoice() {
    const voices = cachedVoices.length ? cachedVoices : synth.getVoices();
    return (
        voices.find(v => v.lang.includes('id') && /Online|Wavenet|Natural|Google/i.test(v.name)) ||
        voices.find(v => v.lang.includes('id') && /Female|Gadis/i.test(v.name)) ||
        voices.find(v => v.lang.includes('id')) ||
        voices[0]
    );
}

function speakText(text) {
    isAiSpeaking = true;
    synth.resume();
    synth.cancel();

    const chunks = text.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [text];
    let index = 0;

    function speakNext() {
        if (index >= chunks.length) {
            isAiSpeaking = false;
            el.ttsInfo.textContent = '[ TTS: SELESAI ]';
            setState(State.STANDBY);
            return;
        }

        const utt   = new SpeechSynthesisUtterance(chunks[index]);
        const voice = getBestVoice();
        if (voice) utt.voice = voice;
        utt.pitch  = CONFIG.ttsPitch;
        utt.rate   = CONFIG.ttsRate;
        utt.volume = CONFIG.ttsVolume;

        utt.onstart = () => {
            el.ttsInfo.textContent = `[ TTS ${index + 1}/${chunks.length} ]`;
        };
        utt.onend   = () => { index++; speakNext(); };
        utt.onerror = () => { index++; speakNext(); };

        synth.speak(utt);
    }

    speakNext();
}

// ============================================================
// EVENT LISTENERS
// ============================================================

// Boot screen click
el.boot.addEventListener('click', () => {
    el.boot.classList.add('hidden');
    isSystemActive = true;

    // Unlock audio context
    synth.resume();
    synth.cancel();
    const welcome = new SpeechSynthesisUtterance('Hafiz AI siap membantu belajar.');
    const voice = getBestVoice();
    if (voice) welcome.voice = voice;
    welcome.pitch  = CONFIG.ttsPitch;
    welcome.rate   = CONFIG.ttsRate;
    synth.speak(welcome);

    // Show session
    const sid = getSessionId();
    if (el.sessionDisplay) {
        el.sessionDisplay.textContent = sid;
    }

    setState(State.STANDBY);
});

// Talk button
el.talkBtn.addEventListener('click', () => {
    if (!isSystemActive || currentState === State.THINKING) return;
    if (isAiSpeaking) {
        synth.cancel();
        isAiSpeaking = false;
    }
    try {
        recognition.stop();
        setTimeout(() => {
            recognition.start();
            setState(State.LISTENING);
        }, 100);
    } catch (e) {
        console.warn('Recognition toggle:', e);
    }
});

// Stop button
el.stopBtn.addEventListener('click', () => {
    if (!isAiSpeaking) return;
    synth.cancel();
    isAiSpeaking = false;
    el.ttsInfo.textContent = '[ TTS: DIHENTIKAN ]';
    setState(State.STANDBY);
});

// ============================================================
// FAKE CPU METRICS
// ============================================================
setInterval(() => {
    if (isSystemActive && el.cpuValue) {
        el.cpuValue.textContent = (Math.random() * 5 + 12).toFixed(1) + '%';
    }
}, CONFIG.cpuInterval);

// ============================================================
// INIT
// ============================================================
initParticles();
startAnimationLoop();

