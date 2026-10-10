/* ============================================================
   app.js — HAFIZ AI Push-to-Talk
   ============================================================ */

'use strict';

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
    webhookUrl:    'http://localhost:5678/webhook/jarvis-chat',
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
// ICOSAHEDRON GEOMETRY BUILDER
// ============================================================

/**
 * Returns the 12 vertices of a unit icosahedron scaled by `r`.
 * Golden ratio φ = (1 + √5) / 2
 */
function buildIcosahedronVertices(r) {
    const phi = (1 + Math.sqrt(5)) / 2;
    const pts = [
        [-1,  phi,  0], [ 1,  phi,  0], [-1, -phi,  0], [ 1, -phi,  0],
        [ 0, -1,  phi], [ 0,  1,  phi], [ 0, -1, -phi], [ 0,  1, -phi],
        [ phi,  0, -1], [ phi,  0,  1], [-phi,  0, -1], [-phi,  0,  1],
    ];
    const len = Math.sqrt(1 + phi * phi);
    return pts.map(([x, y, z]) => [x / len * r, y / len * r, z / len * r]);
}

/**
 * 20 triangular faces of an icosahedron (vertex index triples).
 */
const ICO_FACES = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
];

function buildGeometry() {
    const stage = document.getElementById('geo-stage-inner');
    stage.innerHTML = '';

    const R = 85; // radius in px
    const verts = buildIcosahedronVertices(R);

    // Determine size of the SVG viewport — faces span roughly 2*R
    const svgSize = R * 2.4;
    const half = svgSize / 2;

    // Render each face as an SVG polygon + vertex dots
    ICO_FACES.forEach(([ai, bi, ci]) => {
        const [ax, ay, az] = verts[ai];
        const [bx, by, bz] = verts[bi];
        const [cx, cy, cz] = verts[ci];

        // Centre of the triangle face (for positioning the div)
        const mx = (ax + bx + cx) / 3;
        const my = (ay + by + cy) / 3;
        const mz = (az + bz + cz) / 3;

        const face = document.createElement('div');
        face.className = 'geo-face';

        // Push face outward to its centroid position in 3D space
        face.style.transform = `translate3d(${mx}px, ${my}px, ${mz}px)`;

        // SVG triangle: vertices relative to the face origin
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('width', svgSize);
        svg.setAttribute('height', svgSize);
        svg.setAttribute('viewBox', `${-half} ${-half} ${svgSize} ${svgSize}`);

        const poly = document.createElementNS(ns, 'polygon');
        // Offset each vertex relative to the face centroid
        const pts = [
            [ax - mx, ay - my],
            [bx - mx, by - my],
            [cx - mx, cy - my],
        ].map(([x, y]) => `${x},${y}`).join(' ');
        poly.setAttribute('points', pts);
        svg.appendChild(poly);
        face.appendChild(svg);
        stage.appendChild(face);
    });

    // Render a glowing dot at each unique vertex
    verts.forEach(([x, y, z]) => {
        const dot = document.createElement('div');
        dot.className = 'geo-vertex';
        dot.style.transform = `translate3d(${x}px, ${y}px, ${z}px) translate(-50%, -50%)`;
        stage.appendChild(dot);
    });
}

// ============================================================
// STATE MANAGER
// ============================================================
function setState(state) {
    currentState = state;

    // Drive all CSS state visuals via a single data-state class
    let baseClass = state === State.STANDBY ? '' : `state-${state.toLowerCase()}`;
    if (isSystemActive) {
        baseClass = `system-active ${baseClass}`;
    }
    el.app.className = baseClass.trim();

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
// IOT DEVICE MANAGER
// ============================================================
window.setDeviceStatus = function(deviceId, isOn) {
    const badge = document.getElementById(`device-${deviceId}`);
    if (!badge) return;

    const active = ['true', 'on', '1'].includes(
        String(isOn).toLowerCase()
    );

    badge.className = active ? 'badge badge-green' : 'badge badge-off';
    badge.textContent = active ? 'ON' : 'OFF';
};

const ESP32_STATUS_URL =
    'http://172.20.10.3/api?endpoint=status';

const deviceMapping = {
    ac: 'led_1',
    tv: 'led_2',
    lampu: 'led_3',
    radio: 'led_4',
    mesincuci: 'led_5',
    kulkas: 'led_6'
};

async function syncDeviceStatuses() {
    try {
        const response = await fetch(ESP32_STATUS_URL, {
            cache: 'no-store'
        });

        if (!response.ok) throw new Error('Gagal membaca status LED');

        const statuses = await response.json();

        Object.entries(deviceMapping).forEach(([device, led]) => {
            if (statuses[led] !== undefined) {
                window.setDeviceStatus(device, statuses[led]);
            }
        });
    } catch (error) {
        console.error('Sinkronisasi ESP32 gagal:', error);
    }
}

syncDeviceStatuses();
setInterval(syncDeviceStatuses, 2000);

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

        // ── UPDATE IOT DEVICES IF PROVIDED IN RESPONSE ──
        if (data.devices && typeof data.devices === 'object') {
            Object.entries(data.devices).forEach(([dev, status]) => {
                window.setDeviceStatus(dev, status);
            });
        }

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
buildGeometry();

// ============================================================
// PANEL TOGGLE
// ============================================================
window.toggleSection = function(header) {
    const content = header.nextElementSibling;
    const chevron = header.querySelector(".chevron");
    
    if (content.style.display === "none") {
        content.style.display = "block";
        chevron.style.transform = "rotate(0deg)";
    } else {
        content.style.display = "none";
        chevron.style.transform = "rotate(-90deg)";
    }
};


window.toggleSection = function(header) {
    const content = header.nextElementSibling;
    const chevron = header.querySelector(".chevron");
    
    if (window.getComputedStyle(content).display === "none") {
        content.style.display = "block";
        chevron.style.transform = "rotate(0deg)";
    } else {
        content.style.display = "none";
        chevron.style.transform = "rotate(-90deg)";
    }
};

