// --- DOM Elements ---
const video = document.getElementById('video');
const scanButton = document.getElementById('scanButton');
const canvas = document.getElementById('canvas');
const debugCanvas = document.getElementById('debug-canvas');
const resultsPanel = document.getElementById('results-panel');
const closeButton = document.getElementById('close-results');
const outputEl = document.getElementById('output');
const totalScoreEl = document.getElementById('total-score');

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
    const cameraReady = await setupCamera();
    if (!cameraReady) return;

    const dictionaryReady = await loadDictionary();
    if (!dictionaryReady) return;

    const ocrReady = await setupTesseract();
    if (!ocrReady) return;

    scanButton.textContent = 'Scan Grid';
    scanButton.disabled = false;
}

async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        
        await new Promise((resolve, reject) => {
            video.onloadedmetadata = () => {
                video.play();
                const isStreamLandscape = video.videoWidth > video.videoHeight;
                video.style.transform = isStreamLandscape ? 'rotate(90deg)' : 'none';
                debugCanvas.width = video.clientWidth;
                debugCanvas.height = video.clientHeight;
                resolve();
            };
            video.onerror = () => reject(new Error("Video element failed to load stream."));
        });
        return true;
    } catch (err) {
        console.error("Error accessing camera: ", err);
        if (err.name === "NotAllowedError") {
            scanButton.textContent = 'Camera Blocked';
            alert('Camera access was blocked. You need to go into your browser settings for this site and manually allow camera permission.');
        } else if (err.name === "NotFoundError") {
            scanButton.textContent = 'No Camera';
            alert('No camera was found on this device.');
        } else {
            scanButton.textContent = 'No Camera';
            alert('Could not access the camera. Please ensure you are on a secure (https) connection and grant permission.');
        }
        return false;
    }
}

async function loadDictionary() {
    try {
        const response = await fetch('dictionary.txt');
        const text = await response.text();
        dictionary = new Set(text.split('\n').map(word => word.trim().toLowerCase()));
        return true;
    } catch (error) {
        console.error('Dictionary load error:', error);
        scanButton.textContent = 'Error!';
        alert('Could not load the dictionary file. Please check your connection and refresh.');
        return false;
    }
}

async function setupTesseract() {
    try {
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
        scanButton.textContent = 'Error!';
        alert("Failed to initialize the OCR engine. Please check your internet connection and refresh.");
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

        const words = extractWordsFromGrid(grid);
        await yieldToMainThread();

        highlightFinalWords(words, letterMap);
        
        processWords(words);

    } catch (error) {
        console.error("An error occurred during the scan:", error);
        alert("An error occurred during the scan. Please try again.");
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

function highlightFinalWords(words, letterMap) {
    const debugCtx = debugCanvas.getContext('2d');
    const scaleX = debugCanvas.width / canvas.width;
    const scaleY = debugCanvas.height / canvas.height;
    
    debugCtx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    debugCtx.lineWidth = 4;

    const lettersInWords = new Set();
    letterMap.forEach((letter, key) => {
        for (const word of words) {
            if (word.includes(letter.text)) { 
                lettersInWords.add(key);
            }
        }
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
    if (symbols.length === 0) return { grid: new Map(), letterMap: new Map() };

    const letters = symbols
        .map(s => ({ text: s.text.trim().toUpperCase(), bbox: s.bbox }))
        .filter(s => /^[A-Z]$/.test(s.text));
    
    if (letters.length === 0) return { grid: new Map(), letterMap: new Map() };

    const widths = letters.map(s => s.bbox.x1 - s.bbox.x0).sort((a, b) => a - b);
    const heights = letters.map(s => s.bbox.y1 - s.bbox.y0).sort((a, b) => a - b);
    const medianWidth = widths[Math.floor(widths.length / 2)] || 20;
    const medianHeight = heights[Math.floor(heights.length / 2)] || 20;

    const grid = new Map();
    const letterMap = new Map();
    for (const letter of letters) {
        const gridX = Math.round(letter.bbox.x0 / medianWidth);
        const gridY = Math.round(letter.bbox.y0 / medianHeight);
        const key = `${gridX},${gridY}`;
        grid.set(key, letter.text);
        letterMap.set(key, letter);
    }
    return { grid, letterMap };
}

function extractWordsFromGrid(grid) {
    if (grid.size === 0) return new Set();

    const foundWords = new Set();
    const coords = Array.from(grid.keys()).map(k => k.split(',').map(Number));
    const xCoords = coords.map(c => c[0]);
    const yCoords = coords.map(c => c[1]);
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);

    const isConnected = (x, y, isHorizontal) => {
        if (isHorizontal) {
            return grid.has(`${x},${y - 1}`) || grid.has(`${x},${y + 1}`);
        } else {
            return grid.has(`${x - 1},${y}`) || grid.has(`${x + 1},${y}`);
        }
    };

    for (let y = minY; y <= maxY; y++) {
        let currentWord = '';
        let wordIsConnected = false;
        for (let x = minX; x <= maxX + 1; x++) {
            if (grid.has(`${x},${y}`)) {
                currentWord += grid.get(`${x},${y}`);
                if (isConnected(x, y, true)) wordIsConnected = true;
            } else {
                if (currentWord.length > 1 && wordIsConnected) foundWords.add(currentWord);
                currentWord = '';
                wordIsConnected = false;
            }
        }
    }

    for (let x = minX; x <= maxX; x++) {
        let currentWord = '';
        let wordIsConnected = false;
        for (let y = minY; y <= maxY + 1; y++) {
            if (grid.has(`${x},${y}`)) {
                currentWord += grid.get(`${x},${y}`);
                if (isConnected(x, y, false)) wordIsConnected = true;
            } else {
                if (currentWord.length > 1 && wordIsConnected) foundWords.add(currentWord);
                currentWord = '';
                wordIsConnected = false;
            }
        }
    }
    
    if (foundWords.size === 0) {
        const allWords = new Set();
        for (let y = minY; y <= maxY; y++) {
            let currentWord = '';
            for (let x = minX; x <= maxX + 1; x++) {
                if (grid.has(`${x},${y}`)) currentWord += grid.get(`${x},${y}`);
                else { if (currentWord.length > 1) allWords.add(currentWord); currentWord = ''; }
            }
        }
        for (let x = minX; x <= maxX; x++) {
            let currentWord = '';
            for (let y = minY; y <= maxY + 1; y++) {
                if (grid.has(`${x},${y}`)) currentWord += grid.get(`${x},${y}`);
                else { if (currentWord.length > 1) allWords.add(currentWord); currentWord = ''; }
            }
        }
        if (allWords.size >= 1) return allWords;
    }

    return foundWords;
}

function processWords(words) {
    outputEl.innerHTML = '';
    let totalScore = 0;

    if (words.size === 0) {
        totalScoreEl.textContent = "No valid words found";
        resultsPanel.classList.add('visible');
        return;
    }

    const validWords = [];
    words.forEach(word => {
        if (dictionary.has(word.toLowerCase())) {
            const score = Array.from(word).reduce((acc, char) => acc + (letterScores[char] || 0), 0);
            validWords.push({ word, score });
            totalScore += score;
        }
    });

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
