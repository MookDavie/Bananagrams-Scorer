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

// --- Initialization ---
async function initialize() {
    try {
        await setupCamera();
        await loadDictionary();
        tesseractScheduler = Tesseract.createScheduler();
        const worker = await Tesseract.createWorker('eng', 1, {
            logger: m => {
                if (m.status === 'recognizing text') {
                    scanButton.textContent = `Reading... ${Math.round(m.progress * 100)}%`;
                }
            }
        });
        tesseractScheduler.addWorker(worker);
    } catch (error) {
        console.error("Initialization failed:", error);
        scanButton.textContent = 'Error!';
        alert("Initialization failed. Please refresh the page. Check the console for details.");
    } finally {
        scanButton.textContent = 'Scan Grid';
        scanButton.disabled = false;
    }
}

async function loadDictionary() { /* ... same as before ... */ }
async function setupCamera() { /* ... same as before ... */ }

// --- UI Interaction ---
closeButton.addEventListener('click', () => {
    resultsPanel.classList.remove('visible');
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
});

// --- Core Logic ---
async function handleScan() {
    // Disable the button immediately. The 'finally' block will re-enable it.
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
        // If anything goes wrong, log it and inform the user.
        console.error("An error occurred during the scan:", error);
        alert("An error occurred during the scan. Please try again. Check the console for more details.");
    } finally {
        // This block is GUARANTEED to run, ensuring the button is always re-enabled.
        scanButton.disabled = false;
        scanButton.textContent = 'Scan Grid';
    }
}

function drawDebugBoxes(symbols) { /* ... same as before ... */ }
function highlightFinalWords(words, letterMap) { /* ... same as before ... */ }
function reconstructGrid(symbols) { /* ... same as before ... */ }
function extractWordsFromGrid(grid) { /* ... same as before ... */ }
function processWords(words) { /* ... same as before ... */ }

// --- Start the App ---
scanButton.disabled = true;
scanButton.textContent = 'Initializing...'; // New initial state
initialize();
