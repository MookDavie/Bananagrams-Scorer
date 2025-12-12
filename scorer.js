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
        logger: m => console.log(m)
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
    scanButton.textContent = '...';

    // 1. Capture Image
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    // 2. Positional OCR
    const { data } = await tesseractScheduler.addJob('recognize', canvas);
    
    // 3. Reconstruct Grid
    const grid = reconstructGrid(data.symbols);

    // 4. Extract Words
    const words = extractWordsFromGrid(grid);

    // 5. Validate and Score
    processWords(words);

    scanButton.disabled = false;
    scanButton.textContent = 'Scan Grid';
}

/**
 * Takes a list of Tesseract symbols (char + bbox) and snaps them to a virtual grid.
 * @param {Array} symbols - The array of symbols from Tesseract.
 * @returns {Map<string, string>} A map where the key is "x,y" and value is the character.
 */
function reconstructGrid(symbols) {
    if (symbols.length === 0) return new Map();

    // Filter for valid uppercase letters and get their bounding boxes
    const letters = symbols
        .map(s => ({ text: s.text.trim().toUpperCase(), bbox: s.bbox }))
        .filter(s => /^[A-Z]$/.test(s.text));
    
    if (letters.length === 0) return new Map();

    // Estimate the median tile size to create a robust grid system
    const widths = letters.map(s => s.bbox.x1 - s.bbox.x0).sort((a, b) => a - b);
    const heights = letters.map(s => s.bbox.y1 - s.bbox.y0).sort((a, b) => a - b);
    const medianWidth = widths[Math.floor(widths.length / 2)] || 20;
    const medianHeight = heights[Math.floor(heights.length / 2)] || 20;

    const grid = new Map();
    for (const letter of letters) {
        // Calculate the grid coordinates by "snapping" the tile's position to the grid
        const gridX = Math.round(letter.bbox.x0 / medianWidth);
        const gridY = Math.round(letter.bbox.y0 / medianHeight);
        const key = `${gridX},${gridY}`;
        grid.set(key, letter.text);
    }
    return grid;
}

/**
 * Traverses the virtual grid horizontally and vertically to find word sequences.
 * @param {Map<string, string>} grid - The reconstructed grid from reconstructGrid.
 * @returns {Set<string>} A Set of unique potential words found in the grid.
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

    // Horizontal scan
    for (let y = minY; y <= maxY; y++) {
        let currentWord = '';
        for (let x = minX; x <= maxX + 1; x++) { // Go one past the end to terminate words
            const key = `${x},${y}`;
            if (grid.has(key)) {
                currentWord += grid.get(key);
            } else {
                if (currentWord.length > 1) {
                    foundWords.add(currentWord);
                }
                currentWord = '';
            }
        }
    }

    // Vertical scan
    for (let x = minX; x <= maxX; x++) {
        let currentWord = '';
        for (let y = minY; y <= maxY + 1; y++) { // Go one past the end to terminate words
            const key = `${x},${y}`;
            if (grid.has(key)) {
                currentWord += grid.get(key);
            } else {
                if (currentWord.length > 1) {
                    foundWords.add(currentWord);
                }
                currentWord = '';
            }
        }
    }
    return foundWords;
}

function processWords(words) {
    outputEl.innerHTML = '';
    let totalScore = 0;

    if (words.size === 0) {
        totalScoreEl.textContent = "No words found";
        resultsPanel.classList.add('visible');
        return;
    }

    words.forEach(word => {
        const isValid = dictionary.has(word.toLowerCase());
        if (!isValid) return; // Only show valid words for grid scan

        const score = Array.from(word).reduce((acc, char) => acc + (letterScores[char] || 0), 0);
        totalScore += score;
        
        const wordDiv = document.createElement('div');
        wordDiv.classList.add('word-item', 'valid');
        wordDiv.textContent = `${word} - Score: ${score}`;
        outputEl.prepend(wordDiv);
    });

    totalScoreEl.textContent = `Total Score: ${totalScore}`;
    resultsPanel.classList.add('visible');
}

// --- Start the App ---
scanButton.disabled = true;
scanButton.textContent = '...';
initialize();
