// --- DOM Elements ---
const video = document.getElementById('video');
const scanButton = document.getElementById('scanButton');
const canvas = document.getElementById('canvas');
const debugCanvas = document.getElementById('debug-canvas');
const resultsPanel = document.getElementById('results-panel');
const closeButton = document.getElementById('close-results');
const outputEl = document.getElementById('output');
const totalScoreEl = document.getElementById('total-score');
const overlayText = document.querySelector('#overlay p');

// --- State and Constants ---
const letterScores = {
    'A': 1, 'B': 3, 'C': 3, 'D': 2, 'E': 1, 'F': 4, 'G': 2, 'H': 4, 'I': 1,
    'J': 8, 'K': 5, 'L': 1, 'M': 3, 'N': 1, 'O': 1, 'P': 3, 'Q': 10, 'R': 1,
    'S': 1, 'T': 1, 'U': 1, 'V': 4, 'W': 4, 'X': 8, 'Y': 4, 'Z': 10
};
let dictionary = new Set();
let tesseractScheduler;

// --- Helper function to prevent UI freezing ---
function yieldToMainThread() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

// --- Initialization Flow ---
async function initialize() {
    // Each step will now update the UI and return true/false
    if (!await setupCamera()) return;
    if (!await loadDictionary()) return;
    if (!await setupTesseract()) return;

    // If all steps succeeded, the app is ready.
    overlayText.textContent = 'Fit the entire grid in the frame and press Scan';
    scanButton.textContent = 'Scan Grid';
    scanButton.disabled = false;
}

async function setupCamera() {
    try {
        overlayText.textContent = 'Requesting camera...';
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;

        // Wait for the video to be ready, but with a timeout.
        await new Promise((resolve, reject) => {
            const waitTimeout = setTimeout(() => {
                reject(new Error("Camera setup timed out."));
            }, 10000); // 10-second timeout

            video.onloadedmetadata = () => {
                clearTimeout(waitTimeout);
                resolve();
            };
            video.onerror = () => {
                clearTimeout(waitTimeout);
                reject(new Error("Video element failed to load stream."));
            };
        });

        video.play();
        const isStreamLandscape = video.videoWidth > video.videoHeight;
        video.style.transform = isStreamLandscape ? 'rotate(90deg)' : 'none';
        debugCanvas.width = video.clientWidth;
        debugCanvas.height = video.clientHeight;
        
        return true; // Success
    } catch (err) {
        console.error("Error accessing camera: ", err);
        let errorMessage = 'Could not access camera.';
        if (err.name === "NotAllowedError") {
            errorMessage = 'Camera access was blocked. Please allow camera in your browser settings.';
        } else if (err.name === "NotFoundError") {
            errorMessage = 'No camera was found on this device.';
        } else if (err.message.includes("timed out")) {
            errorMessage = 'Camera failed to start in time. Please refresh and try again.';
        }
        overlayText.textContent = errorMessage;
        scanButton.textContent = 'Error';
        return false; // Failure
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
        scanButton.textContent = 'Error';
        return false;
    }
}

async function setupTesseract() {
    try {
        overlayText.textContent = 'Initializing OCR engine...';
        tesseractScheduler = Tesseract.createScheduler();
        const worker = await Tesseract.createWorker('eng', 1, {
            logger: m => {
                if (m.status === 'recognizing text') {
                    scanButton.textContent = `Reading... ${Math.round(m.progress * 100)}%`;
                }
            }
        });
        tesseractScheduler.addWorker(worker);
        return true;
    } catch (error) {
        console.error("Could not set up Tesseract:", error);
        overlayText.textContent = 'Error: Failed to initialize OCR engine.';
        scanButton.textContent = 'Error';
        return false;
    }
}

// --- UI Interaction ---
closeButton.addEventListener('click', () => {
    resultsPanel.classList.remove('visible');
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
});

// --- Core Logic ---
async function handleScan() {
    scanButton.disabled = true;
    scanButton.textContent = 'Capturing...';

    try {
        const debugCtx = debugCanvas.getContext('2d');
        debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

        await yieldToMainThread();

        const { data } = await tesseractScheduler.addJob('recognize', canvas);

        scanButton.textContent = 'Processing...';
        await yieldToMainThread();

        drawDebugBoxes(data.symbols);
        await yieldToMainThread();

        const { grid, letterMap } = reconstructGrid(data.symbols);
        await yieldToMainThread();

        const wordsData = extractWordsFromGrid(grid);
        await yieldToMainThread();

        highlightFinalWords(wordsData, letterMap);
        
        processWords(wordsData);

    } catch (error) {
        console.error("An error occurred during the scan:", error);
        overlayText.textContent = 'An error occurred. Please try again.';
    } finally {
        scanButton.disabled = false;
        scanButton.textContent = 'Scan Grid';
    }
}

function drawDebugBoxes(symbols) {
    const debugCtx = debugCanvas.getContext('2d');
    const scaleX = debugCanvas.width / canvas.width;
    const scaleY = debugCanvas.height / canvas.height;
    debugCtx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    debugCtx.lineWidth = 2;
    for (const symbol of symbols) {
        if (!/^[A-Z]$/.test(symbol.text.trim().toUpperCase())) continue;
        const { x0, y0, x1, y1 } = symbol.bbox;
        debugCtx.strokeRect(x0 * scaleX, y0 * scaleY, (x1 - x0) * scaleX, (y1 - y0) * scaleY);
    }
}

function highlightFinalWords(wordsData, letterMap) {
    const debugCtx = debugCanvas.getContext('2d');
    const scaleX = debugCanvas.width / canvas.width;
    const scaleY = debugCanvas.height / canvas.height;
    debugCtx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    debugCtx.lineWidth = 4;
    const lettersInWords = new Set();
    wordsData.forEach(wordData => {
        wordData.path.forEach(coordKey => lettersInWords.add(coordKey));
    });
    lettersInWords.forEach(key => {
        const letter = letterMap.get(key);
        if (letter) {
            const { x0, y0, x1, y1 } = letter.bbox;
            debugCtx.strokeRect(x0 * scaleX, y0 * scaleY, (x1 - x0) * scaleX, (y1 - y0) * scaleY);
        }
    });
}

function reconstructGrid(symbols) {
    if (!symbols || symbols.length === 0) return { grid: new Map(), letterMap: new Map() };
    const letters = symbols
        .map(s => ({ text: s.text.trim().toUpperCase(), bbox: s.bbox }))
        .filter(s => /^[A-Z]$/.test(s.text));
    if (letters.length === 0) return { grid: new Map(), letterMap: new Map() };
    const widths = letters.map(s => s.bbox.x1 - s.bbox.x0).sort((a, b) => a - b);
    const heights = letters.map(s => s.bbox.y1 - s.bbox.y0).sort((a, b) => a - b);
    const medianWidth = widths[Math.floor(widths.length / 2)] || 20;
    const medianHeight = heights[Math.floor(heights.length / 2)] || 20;
    const grid = new Map(), letterMap = new Map();
    for (const letter of letters) {
        const gridX = Math.round(letter.bbox.x0 / medianWidth);
        const gridY = Math.round(letter.bbox.y0 / medianHeight);
        const key = `${gridX},${gridY}`;
        if (!grid.has(key)) {
            grid.set(key, letter.text);
            letterMap.set(key, letter);
        }
    }
    return { grid, letterMap };
}

function extractWordsFromGrid(grid) {
    if (grid.size < 2) return [];
    const foundWordsData = [];
    const coords = Array.from(grid.keys()).map(k => k.split(',').map(Number));
    const [minX, maxX] = [Math.min(...coords.map(c => c[0])), Math.max(...coords.map(c => c[0]))];
    const [minY, maxY] = [Math.min(...coords.map(c => c[1])), Math.max(...coords.map(c => c[1]))];
    const isConnected = (x, y, isHorizontal) => isHorizontal
        ? grid.has(`${x},${y - 1}`) || grid.has(`${x},${y + 1}`)
        : grid.has(`${x - 1},${y}`) || grid.has(`${x + 1},${y}`);
    for (let y = minY; y <= maxY; y++) {
        let currentWord = '', path = [], wordIsConnected = false;
        for (let x = minX; x <= maxX + 1; x++) {
            const key = `${x},${y}`;
            if (grid.has(key)) {
                currentWord += grid.get(key); path.push(key);
                if (isConnected(x, y, true)) wordIsConnected = true;
            } else {
                if (currentWord.length > 1 && wordIsConnected) foundWordsData.push({ word: currentWord, path });
                currentWord = ''; path = []; wordIsConnected = false;
            }
        }
    }
    for (let x = minX; x <= maxX; x++) {
        let currentWord = '', path = [], wordIsConnected = false;
        for (let y = minY; y <= maxY + 1; y++) {
            const key = `${x},${y}`;
            if (grid.has(key)) {
                currentWord += grid.get(key); path.push(key);
                if (isConnected(x, y, false)) wordIsConnected = true;
            } else {
                if (currentWord.length > 1 && wordIsConnected) foundWordsData.push({ word: currentWord, path });
                currentWord = ''; path = []; wordIsConnected = false;
            }
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

// --- Start the App ---
scanButton.disabled = true;
scanButton.textContent = 'Initializing...';
initialize();
