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
    await setupCamera();
    await loadDictionary();
    tesseractScheduler = Tesseract.createScheduler();
    const worker = await Tesseract.createWorker('eng', 1, {
        logger: m => {
            // Update the button text with OCR progress
            if (m.status === 'recognizing text') {
                scanButton.textContent = `Reading... ${Math.round(m.progress * 100)}%`;
            }
        }
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
closeButton.addEventListener('click', () => {
    resultsPanel.classList.remove('visible');
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
});

// --- Core Logic ---
async function handleScan() {
    scanButton.disabled = true;
    scanButton.textContent = 'Capturing...';
    
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    // Yield to allow the UI to update before the heavy OCR starts.
    await yieldToMainThread();

    // Tesseract runs in a worker, so this part is non-blocking.
    const { data } = await tesseractScheduler.addJob('recognize', canvas);

    // --- Start of the potentially blocking section ---
    scanButton.textContent = 'Processing...';
    await yieldToMainThread(); // Yield again before heavy CPU work!

    drawDebugBoxes(data.symbols);
    await yieldToMainThread(); // Yield after drawing

    const { grid, letterMap } = reconstructGrid(data.symbols);
    await yieldToMainThread(); // Yield after grid reconstruction

    const words = extractWordsFromGrid(grid);
    await yieldToMainThread(); // Yield after word extraction

    highlightFinalWords(words, letterMap);
    
    processWords(words);
    // --- End of the potentially blocking section ---

    scanButton.disabled = false;
    scanButton.textContent = 'Scan Grid';
}

function drawDebugBoxes(symbols) { /* ... same as before ... */ }
function highlightFinalWords(words, letterMap) { /* ... same as before ... */ }
function reconstructGrid(symbols) { /* ... same as before ... */ }
function extractWordsFromGrid(grid) { /* ... same as before ... */ }
function processWords(words) { /* ... same as before ... */ }

// --- Start the App ---
scanButton.disabled = true;
scanButton.textContent = '...';
initialize();
