// --- DOM Elements ---
const video = document.getElementById('video');
const scanButton = document.getElementById('scanButton');
const canvas = document.getElementById('canvas');
const debugCanvas = document.getElementById('debug-canvas'); // New
const resultsPanel = document.getElementById('results-panel');
const closeButton = document.getElementById('close-results');
const outputEl = document.getElementById('output');
const totalScoreEl = document.getElementById('total-score');

// --- State and Constants ---
const letterScores = { /* ... same as before ... */ };
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

async function loadDictionary() { /* ... same as before ... */ }

async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        await new Promise(resolve => {
            video.onloadedmetadata = () => {
                video.play();
                const isStreamLandscape = video.videoWidth > video.videoHeight;
                video.style.transform = isStreamLandscape ? 'rotate(90deg)' : 'none';

                // Match debug canvas size to the video's display size
                debugCanvas.width = video.clientWidth;
                debugCanvas.height = video.clientHeight;
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
closeButton.addEventListener('click', () => {
    resultsPanel.classList.remove('visible');
    // Clear the debug view when closing results
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
});

// --- Core Logic ---
async function handleScan() {
    scanButton.disabled = true;
    scanButton.textContent = 'Analyzing...';

    // Clear previous debug drawings
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    const { data } = await tesseractScheduler.addJob('recognize', canvas);
    
    // Draw initial bounding boxes for all detected symbols
    drawDebugBoxes(data.symbols);

    const { grid, letterMap } = reconstructGrid(data.symbols);
    const words = extractWordsFromGrid(grid);
    
    // Highlight the final words found
    highlightFinalWords(words, letterMap);

    processWords(words);

    scanButton.disabled = false;
    scanButton.textContent = 'Scan Grid';
}

/**
 * Draws bounding boxes for all detected symbols onto the debug canvas.
 * @param {Array} symbols - The array of symbols from Tesseract.
 */
function drawDebugBoxes(symbols) {
    const debugCtx = debugCanvas.getContext('2d');
    const scaleX = debugCanvas.width / canvas.width;
    const scaleY = debugCanvas.height / canvas.height;

    debugCtx.strokeStyle = 'rgba(255, 0, 0, 0.5)'; // Red for all initial detections
    debugCtx.lineWidth = 2;

    for (const symbol of symbols) {
        if (!/^[A-Z]$/.test(symbol.text.trim().toUpperCase())) continue;
        
        const { x0, y0, x1, y1 } = symbol.bbox;
        debugCtx.strokeRect(
            x0 * scaleX, 
            y0 * scaleY, 
            (x1 - x0) * scaleX, 
            (y1 - y0) * scaleY
        );
    }
}

/**
 * Highlights the bounding boxes of letters that form the final valid words.
 * @param {Set<string>} words - The set of final valid words.
 * @param {Map<string, object>} letterMap - Map from grid coords to letter objects.
 */
function highlightFinalWords(words, letterMap) {
    const debugCtx = debugCanvas.getContext('2d');
    const scaleX = debugCanvas.width / canvas.width;
    const scaleY = debugCanvas.height / canvas.height;
    
    debugCtx.strokeStyle = 'rgba(0, 255, 0, 0.8)'; // Bright green for final words
    debugCtx.lineWidth = 4;

    const lettersInWords = new Set();
    
    // Find all unique grid coordinates that are part of a valid word
    letterMap.forEach((letter, key) => {
        for (const word of words) {
            // This is a simplified check; a more robust method would track indices
            if (word.includes(letter.text)) { 
                // A better approach would be to store the path of each word
                // For now, we just check if the letter is in any word.
                lettersInWords.add(key);
            }
        }
    });

    // Draw a highlight box for each letter in a final word
    lettersInWords.forEach(key => {
        const letter = letterMap.get(key);
        if (letter) {
            const { x0, y0, x1, y1 } = letter.bbox;
            debugCtx.strokeRect(
                x0 * scaleX, 
                y0 * scaleY, 
                (x1 - x0) * scaleX, 
                (y1 - y0) * scaleY
            );
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
    const letterMap = new Map(); // New: maps grid coords to the full letter object
    for (const letter of letters) {
        const gridX = Math.round(letter.bbox.x0 / medianWidth);
        const gridY = Math.round(letter.bbox.y0 / medianHeight);
        const key = `${gridX},${gridY}`;
        grid.set(key, letter.text);
        letterMap.set(key, letter); // Store the letter object with its bbox
    }
    return { grid, letterMap };
}

function extractWordsFromGrid(grid) { /* ... same as before ... */ }
function processWords(words) { /* ... same as before ... */ }

// --- Start the App ---
scanButton.disabled = true;
scanButton.textContent = '...';
initialize();
