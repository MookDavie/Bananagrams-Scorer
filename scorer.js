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
    // We will handle errors in the specific functions that can fail.
    const cameraReady = await setupCamera();
    if (!cameraReady) return; // Stop initialization if camera failed

    const dictionaryReady = await loadDictionary();
    if (!dictionaryReady) return; // Stop if dictionary failed

    const ocrReady = await setupTesseract();
    if (!ocrReady) return; // Stop if OCR setup failed

    // If all steps succeeded, enable the button.
    scanButton.textContent = 'Scan Grid';
    scanButton.disabled = false;
}

async function loadDictionary() {
    try {
        const response = await fetch('dictionary.txt');
        const text = await response.text();
        dictionary = new Set(text.split('\n').map(word => word.trim().toLowerCase()));
        return true; // Success
    } catch (error) {
        console.error('Dictionary load error:', error);
        scanButton.textContent = 'Error!';
        alert('Could not load the dictionary file. Please check your connection and refresh.');
        return false; // Failure
    }
}

async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        
        // This promise resolves when the video is ready to play.
        await new Promise((resolve, reject) => {
            video.onloadedmetadata = () => {
                video.play();
                const isStreamLandscape = video.videoWidth > video.videoHeight;
                video.style.transform = isStreamLandscape ? 'rotate(90deg)' : 'none';
                debugCanvas.width = video.clientWidth;
                debugCanvas.height = video.clientHeight;
                resolve(); // Signal success
            };
            // Add an error handler for the video element itself
            video.onerror = () => {
                reject(new Error("Video element failed to load stream."));
            };
        });
        return true; // Success
    } catch (err) {
        console.error("Error accessing camera: ", err);
        scanButton.textContent = 'No Camera';
        alert('Could not access the camera. Please grant permission and refresh the page.');
        return false; // Failure
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
        return true; // Success
    } catch (error) {
        console.error("Could not set up Tesseract:", error);
        scanButton.textContent = 'Error!';
        alert("Failed to initialize the OCR engine. Please check your internet connection and refresh.");
        return false; // Failure
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
        // The robust finally block is perfect here, ensuring the button is always re-enabled after a scan attempt.
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
scanButton.textContent = 'Initializing...';
initialize();
