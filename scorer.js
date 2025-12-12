// --- DOM Elements ---
const video = document.getElementById('video');
const mainButton = document.getElementById('mainButton');
const canvas = document.getElementById('canvas');
const debugCanvas = document.getElementById('debug-canvas');
const resultsPanel = document.getElementById('results-panel');
const closeButton = document.getElementById('close-results');
const outputEl = document.getElementById('output');
const totalScoreEl = document.getElementById('total-score');
const overlayText = document.querySelector('#overlay p');

// --- State and Constants ---
const AppState = { INITIALIZING: 'INITIALIZING', IDLE: 'IDLE', LIVE_VIEW: 'LIVE_VIEW', SCORING: 'SCORING' };
let currentState = AppState.INITIALIZING;
let liveViewIntervalId = null;
let lastRecognizedWordsData = [];

const CONFIDENCE_THRESHOLD = 65; // Stricter confidence
const SIZE_DEVIATION_THRESHOLD = 0.5; // Allow 50% deviation from median size

const letterScores = {
    'A': 1, 'B': 3, 'C': 3, 'D': 2, 'E': 1, 'F': 4, 'G': 2, 'H': 4, 'I': 1,
    'J': 8, 'K': 5, 'L': 1, 'M': 3, 'N': 1, 'O': 1, 'P': 3, 'Q': 10, 'R': 1,
    'S': 1, 'T': 1, 'U': 1, 'V': 4, 'W': 4, 'X': 8, 'Y': 4, 'Z': 10
};
let dictionary = new Set();
let tesseractScheduler;

// --- Initialization and State Machine ---
async function initialize() {
    if (!await setupCamera()) return;
    if (!await loadDictionary()) return;
    if (!await setupTesseract()) return;
    setState(AppState.IDLE);
}

function setState(newState) {
    currentState = newState;
    mainButton.disabled = false;
    switch (newState) {
        case AppState.INITIALIZING:
            mainButton.disabled = true; mainButton.textContent = 'Starting...'; overlayText.textContent = 'Initializing...';
            break;
        case AppState.IDLE:
            mainButton.textContent = 'Start Live View'; overlayText.textContent = 'Press "Start" to begin recognition';
            if (liveViewIntervalId) clearInterval(liveViewIntervalId);
            break;
        case AppState.LIVE_VIEW:
            mainButton.textContent = 'Score Grid'; overlayText.textContent = 'Align your grid, then press "Score"';
            startLiveRecognition();
            break;
        case AppState.SCORING:
            mainButton.disabled = true; mainButton.textContent = 'Scoring...';
            if (liveViewIntervalId) clearInterval(liveViewIntervalId);
            processWords(lastRecognizedWordsData);
            break;
    }
}

mainButton.addEventListener('click', () => {
    if (currentState === AppState.IDLE) setState(AppState.LIVE_VIEW);
    else if (currentState === AppState.LIVE_VIEW) setState(AppState.SCORING);
});

closeButton.addEventListener('click', () => {
    resultsPanel.classList.remove('visible');
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    setState(AppState.IDLE);
});

// --- Live Recognition Loop ---
function startLiveRecognition() {
    if (liveViewIntervalId) clearInterval(liveViewIntervalId);
    liveViewIntervalId = setInterval(runRecognition, 750);
}

async function runRecognition() {
    if (currentState !== AppState.LIVE_VIEW) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = avg; data[i + 1] = avg; data[i + 2] = avg;
    }
    ctx.putImageData(imageData, 0, 0);

    const { data: ocrData } = await tesseractScheduler.addJob('recognize', canvas, {
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    });

    const { grid, letterMap, allLetters } = reconstructGrid(ocrData.symbols);
    const wordsData = extractWordsFromGrid(grid);
    
    lastRecognizedWordsData = wordsData;

    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    drawDebugBoxes(allLetters);
    highlightFinalWords(wordsData, letterMap);
}

// --- Core Logic: Coordinate Mapping and Grid Reconstruction ---

/**
 * **IMPROVEMENT 1: Robust Coordinate Mapping**
 * Correctly maps a bounding box from the video's intrinsic resolution
 * to the on-screen debug canvas, accounting for `object-fit: cover`.
 */
function mapBoxToCanvas(box) {
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const canvasWidth = debugCanvas.clientWidth;
    const canvasHeight = debugCanvas.clientHeight;

    const videoAspect = videoWidth / videoHeight;
    const canvasAspect = canvasWidth / canvasHeight;

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    if (videoAspect > canvasAspect) { // Video is wider than canvas, letterboxed top/bottom
        scale = canvasWidth / videoWidth;
        offsetY = (canvasHeight - videoHeight * scale) / 2;
    } else { // Video is taller than canvas, letterboxed left/right
        scale = canvasHeight / videoHeight;
        offsetX = (canvasWidth - videoWidth * scale) / 2;
    }

    return {
        x: box.x0 * scale + offsetX,
        y: box.y0 * scale + offsetY,
        w: (box.x1 - box.x0) * scale,
        h: (box.y1 - box.y0) * scale,
    };
}

function drawDebugBoxes(letters) {
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
    debugCtx.lineWidth = 2;

    for (const letter of letters) {
        const mappedBox = mapBoxToCanvas(letter.bbox);
        debugCtx.strokeRect(mappedBox.x, mappedBox.y, mappedBox.w, mappedBox.h);
    }
}

function highlightFinalWords(wordsData, letterMap) {
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.strokeStyle = 'rgba(0, 255, 0, 1)';
    debugCtx.lineWidth = 4;

    const lettersInWords = new Set();
    wordsData.forEach(wordData => {
        wordData.path.forEach(coordKey => lettersInWords.add(coordKey));
    });

    lettersInWords.forEach(key => {
        const letter = letterMap.get(key);
        if (letter) {
            const mappedBox = mapBoxToCanvas(letter.bbox);
            debugCtx.strokeRect(mappedBox.x, mappedBox.y, mappedBox.w, mappedBox.h);
        }
    });
}

/**
 * **IMPROVEMENT 2: Filtering by Confidence AND Size**
 * This function now filters out symbols that are too small or too large
 * compared to the median size of all other detected letters.
 */
function reconstructGrid(symbols) {
    if (!symbols || symbols.length === 0) return { grid: new Map(), letterMap: new Map(), allLetters: [] };

    // Step 1: Filter by confidence and basic format
    let letters = symbols
        .filter(s => s.confidence > CONFIDENCE_THRESHOLD && /^[A-Z]$/.test(s.text.trim()))
        .map(s => ({
            text: s.text.trim(),
            bbox: s.bbox,
            cx: (s.bbox.x0 + s.bbox.x1) / 2,
            cy: (s.bbox.y0 + s.bbox.y1) / 2,
            width: s.bbox.x1 - s.bbox.x0,
            height: s.bbox.y1 - s.bbox.y0,
        }));

    if (letters.length < 2) return { grid: new Map(), letterMap: new Map(), allLetters: letters };

    // Step 2: Filter by size. Calculate median size first.
    const heights = letters.map(l => l.height).sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)];
    const minHeight = medianHeight * (1 - SIZE_DEVIATION_THRESHOLD);
    const maxHeight = medianHeight * (1 + SIZE_DEVIATION_THRESHOLD);

    letters = letters.filter(l => l.height >= minHeight && l.height <= maxHeight);
    
    const allFilteredLetters = [...letters]; // Keep a copy for drawing debug boxes

    if (letters.length < 2) return { grid: new Map(), letterMap: new Map(), allLetters: allFilteredLetters };

    // Step 3: Cluster remaining letters into a grid (same as before)
    const tolerance = medianHeight * 0.5;
    const findCoordinateLanes = (coords) => {
        coords.sort((a, b) => a - b);
        if (coords.length === 0) return [];
        const lanes = [[coords[0]]];
        for (let i = 1; i < coords.length; i++) {
            if (coords[i] - lanes[lanes.length - 1][0] < tolerance) lanes[lanes.length - 1].push(coords[i]);
            else lanes.push([coords[i]]);
        }
        return lanes.map(lane => lane.reduce((a, b) => a + b, 0) / lane.length);
    };
    const xLanes = findCoordinateLanes(letters.map(l => l.cx));
    const yLanes = findCoordinateLanes(letters.map(l => l.cy));
    const findClosestLaneIndex = (coord, lanes) => {
        let closestIndex = 0, minDiff = Infinity;
        for (let i = 0; i < lanes.length; i++) {
            const diff = Math.abs(coord - lanes[i]);
            if (diff < minDiff) { minDiff = diff; closestIndex = i; }
        }
        return closestIndex;
    };

    const grid = new Map(), letterMap = new Map();
    for (const letter of letters) {
        const gridX = findClosestLaneIndex(letter.cx, xLanes);
        const gridY = findClosestLaneIndex(letter.cy, yLanes);
        const key = `${gridX},${gridY}`;
        if (!grid.has(key)) {
            grid.set(key, letter.text);
            letterMap.set(key, letter);
        }
    }
    return { grid, letterMap, allLetters: allFilteredLetters };
}

// --- Setup and other functions (unchanged from previous correct versions) ---

async function setupCamera() {
    try {
        overlayText.textContent = 'Requesting camera...';
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        await new Promise((resolve, reject) => {
            const waitTimeout = setTimeout(() => reject(new Error("Camera setup timed out.")), 10000);
            video.onloadedmetadata = () => { clearTimeout(waitTimeout); resolve(); };
            video.onerror = () => { clearTimeout(waitTimeout); reject(new Error("Video element failed to load stream.")); };
        });
        video.play();
        const isStreamLandscape = video.videoWidth > video.videoHeight;
        video.style.transform = isStreamLandscape ? 'rotate(90deg)' : 'none';
        // Set canvas size once video is playing and has dimensions
        debugCanvas.width = debugCanvas.clientWidth;
        debugCanvas.height = debugCanvas.clientHeight;
        return true;
    } catch (err) {
        console.error("Error accessing camera: ", err);
        let errorMessage = 'Could not access camera.';
        if (err.name === "NotAllowedError") errorMessage = 'Camera access was blocked. Please allow camera in your browser settings.';
        else if (err.name === "NotFoundError") errorMessage = 'No camera was found on this device.';
        else if (err.message.includes("timed out")) errorMessage = 'Camera failed to start in time. Please refresh.';
        overlayText.textContent = errorMessage;
        mainButton.textContent = 'Error';
        return false;
    }
}

async function loadDictionary() {
    try {
        overlayText.textContent = 'Loading dictionary...';
        const response = await fetch('dictionary.txt');
        if (!response.ok) throw new Error(`Dictionary file not found (404).`);
        const text = await response.text();
        dictionary = new Set(text.split('\n').map(word => word.trim().toLowerCase()));
        return true;
    } catch (error) {
        console.error('Dictionary load error:', error);
        overlayText.textContent = `Error: ${error.message}`;
        mainButton.textContent = 'Error';
        return false;
    }
}

async function setupTesseract() {
    try {
        overlayText.textContent = 'Initializing OCR engine...';
        tesseractScheduler = Tesseract.createScheduler();
        const worker = await Tesseract.createWorker('eng', 1);
        tesseractScheduler.addWorker(worker);
        return true;
    } catch (error) {
        console.error("Could not set up Tesseract:", error);
        overlayText.textContent = 'Error: Failed to initialize OCR engine.';
        mainButton.textContent = 'Error';
        return false;
    }
}

function processWords(wordsData) {
    outputEl.innerHTML = '';
    let totalScore = 0;
    if (!wordsData || wordsData.length === 0) {
        totalScoreEl.textContent = "No valid words found";
        resultsPanel.classList.add('visible'); return;
    }
    const validWords = [];
    wordsData.forEach(data => {
        if (dictionary.has(data.word.toLowerCase())) {
            const score = Array.from(data.word).reduce((acc, char) => acc + (letterScores[char] || 0), 0);
            validWords.push({ word: data.word, score });
            totalScore += score;
        }
    });
    if (validWords.length === 0) {
        totalScoreEl.textContent = "No valid words found";
        resultsPanel.classList.add('visible'); return;
    }
    validWords.sort((a, b) => a.word.localeCompare(b.word));
    validWords.forEach(({ word, score }) => {
        const wordDiv = document.createElement('div');
        wordDiv.classList.add('word-item', 'valid');
        wordDiv.textContent = `${word} - Score: ${score}`;
        outputEl.append(wordDiv);
    });
    totalScoreEl.textContent = `Total Score: ${totalScore}`;
    resultsPanel.classList.add('visible');
}

function extractWordsFromGrid(grid) {
    if (grid.size < 2) return [];
    const foundWordsData = [];
    const coords = Array.from(grid.keys()).map(k => k.split(',').map(Number));
    const [minX, maxX] = [Math.min(...coords.map(c => c[0])), Math.max(...coords.map(c => c[0]))];
    const [minY, maxY] = [Math.min(...coords.map(c => c[1])), Math.max(...coords.map(c => c[1]))];
    const isConnected = (x, y, isHorizontal) => isHorizontal ? grid.has(`${x},${y - 1}`) || grid.has(`${x},${y + 1}`) : grid.has(`${x - 1},${y}`) || grid.has(`${x + 1},${y}`);
    for (let y = minY; y <= maxY; y++) {
        let currentWord = '', path = [], wordIsConnected = false;
        for (let x = minX; x <= maxX + 1; x++) {
            const key = `${x},${y}`;
            if (grid.has(key)) { currentWord += grid.get(key); path.push(key); if (isConnected(x, y, true)) wordIsConnected = true; }
            else { if (currentWord.length > 1 && wordIsConnected) foundWordsData.push({ word: currentWord, path }); currentWord = ''; path = []; wordIsConnected = false; }
        }
    }
    for (let x = minX; x <= maxX; x++) {
        let currentWord = '', path = [], wordIsConnected = false;
        for (let y = minY; y <= maxY + 1; y++) {
            const key = `${x},${y}`;
            if (grid.has(key)) { currentWord += grid.get(key); path.push(key); if (isConnected(x, y, false)) wordIsConnected = true; }
            else { if (currentWord.length > 1 && wordIsConnected) foundWordsData.push({ word: currentWord, path }); currentWord = ''; path = []; wordIsConnected = false; }
        }
    }
    if (foundWordsData.length === 0) {
        const allWords = [];
        for (let y = minY; y <= maxY; y++) {
            let currentWord = '', path = [];
            for (let x = minX; x <= maxX + 1; x++) {
                const key = `${x},${y}`;
                if (grid.has(key)) { currentWord += grid.get(key); path.push(key); }
                else { if (currentWord.length > 1) allWords.push({ word: currentWord, path }); currentWord = ''; path = []; }
            }
        }
        if (allWords.length === 1) return allWords;
    }
    const uniqueWords = new Map();
    foundWordsData.forEach(data => uniqueWords.set(data.word, data));
    return Array.from(uniqueWords.values());
}

// --- Start the App ---
setState(AppState.INITIALIZING);
initialize();
