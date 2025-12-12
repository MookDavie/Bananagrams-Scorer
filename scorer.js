// --- DOM Elements ---
const video = document.getElementById('video');
const scanButton = document.getElementById('scanButton');
const canvas = document.getElementById('canvas');
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

// --- Initialization ---
async function initialize() {
    await setupCamera();
    await loadDictionary();
    tesseractScheduler = Tesseract.createScheduler();
    const worker = await Tesseract.createWorker('eng', 1, {
        logger: m => console.log(m) // Optional: for debugging OCR progress
    });
    tesseractScheduler.addWorker(worker);
    scanButton.textContent = 'Scan Grid';
    scanButton.disabled = false;
}

async function loadDictionary() {
    try {
        const response = await fetch('dictionary.txt');
        const text = await response.text();
        dictionary = new Set(text.split('\n').map(word => word.trim().toLowerCase()));
    } catch (error) {
        console.error('Dictionary load error:', error);
        alert('Could not load dictionary.');
    }
}

async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        await new Promise(resolve => {
            video.onloadedmetadata = () => {
                video.play();
                const isStreamLandscape = video.videoWidth > video.videoHeight;
                video.style.transform = isStreamLandscape ? 'rotate(90deg)' : 'none';
                resolve();
            };
        });
    } catch (err) {
        console.error("Error accessing camera: ", err);
        alert('Could not access camera.');
    }
}

// --- UI Interaction ---
scanButton.addEventListener('click', handleScan);
closeButton.addEventListener('click', () => resultsPanel.classList.remove('visible'));

// --- Core Logic ---
async function handleScan() {
    scanButton.disabled = true;
    scanButton.textContent = 'Analyzing...';

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    const { data } = await tesseractScheduler.addJob('recognize', canvas);
    
    const grid = reconstructGrid(data.symbols);
    const words = extractWordsFromGrid(grid);
    processWords(words);

    scanButton.disabled = false;
    scanButton.textContent = 'Scan Grid';
}

function reconstructGrid(symbols) {
    if (symbols.length === 0) return new Map();

    const letters = symbols
        .map(s => ({ text: s.text.trim().toUpperCase(), bbox: s.bbox }))
        .filter(s => /^[A-Z]$/.test(s.text));
    
    if (letters.length === 0) return new Map();

    const widths = letters.map(s => s.bbox.x1 - s.bbox.x0).sort((a, b) => a - b);
    const heights = letters.map(s => s.bbox.y1 - s.bbox.y0).sort((a, b) => a - b);
    const medianWidth = widths[Math.floor(widths.length / 2)] || 20;
    const medianHeight = heights[Math.floor(heights.length / 2)] || 20;

    const grid = new Map();
    for (const letter of letters) {
        const gridX = Math.round(letter.bbox.x0 / medianWidth);
        const gridY = Math.round(letter.bbox.y0 / medianHeight);
        const key = `${gridX},${gridY}`;
        grid.set(key, letter.text);
    }
    return grid;
}

/**
 * A much smarter function to extract valid, interconnected words from the grid.
 * @param {Map<string, string>} grid - The reconstructed grid.
 * @returns {Set<string>} A Set of unique, validly connected words.
 */
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

    // --- Helper function to check for cross-connections ---
    const isConnected = (x, y, isHorizontal) => {
        if (isHorizontal) {
            // A horizontal word is connected if any of its letters
            // has a vertical neighbor.
            return grid.has(`${x},${y - 1}`) || grid.has(`${x},${y + 1}`);
        } else {
            // A vertical word is connected if any of its letters
            // has a horizontal neighbor.
            return grid.has(`${x - 1},${y}`) || grid.has(`${x + 1},${y}`);
        }
    };

    // --- Horizontal Scan ---
    for (let y = minY; y <= maxY; y++) {
        let currentWord = '';
        let startX = -1;
        let wordIsConnected = false;

        for (let x = minX; x <= maxX + 1; x++) { // Iterate one past the end
            const key = `${x},${y}`;
            if (grid.has(key)) {
                if (currentWord === '') startX = x; // Mark the start of a new word
                currentWord += grid.get(key);
                // Check for a connection for the current letter
                if (isConnected(x, y, true)) {
                    wordIsConnected = true;
                }
            } else {
                // End of a potential word
                if (currentWord.length > 1 && wordIsConnected) {
                    foundWords.add(currentWord);
                }
                // Reset for the next word
                currentWord = '';
                wordIsConnected = false;
            }
        }
    }

    // --- Vertical Scan ---
    for (let x = minX; x <= maxX; x++) {
        let currentWord = '';
        let startY = -1;
        let wordIsConnected = false;

        for (let y = minY; y <= maxY + 1; y++) { // Iterate one past the end
            const key = `${x},${y}`;
            if (grid.has(key)) {
                if (currentWord === '') startY = y;
                currentWord += grid.get(key);
                if (isConnected(x, y, false)) {
                    wordIsConnected = true;
                }
            } else {
                // End of a potential word
                if (currentWord.length > 1 && wordIsConnected) {
                    foundWords.add(currentWord);
                }
                // Reset for the next word
                currentWord = '';
                wordIsConnected = false;
            }
        }
    }
    
    // Final check: If only one word is found, it's valid by default.
    // This handles the very first word placed on the board.
    if (foundWords.size === 0) {
        const allWords = new Set();
        // Re-run the extraction without the connection check
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
        if (allWords.size === 1) return allWords;
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

    // Sort words alphabetically for consistent display
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
scanButton.textContent = '...';
initialize();
