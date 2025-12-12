// --- DOM Elements ---
const video = document.getElementById('video');
const scanButton = document.getElementById('scanButton');
const canvas = document.getElementById('canvas');
const resultsPanel = document.getElementById('results-panel');
const closeButton = document.getElementById('close-results');
const outputEl = document.getElementById('output');
const totalScoreEl = document.getElementById('total-score');
const overlay = document.getElementById('scan-overlay');

// --- State and Constants ---
const letterScores = {
    'A': 1, 'B': 3, 'C': 3, 'D': 2, 'E': 1, 'F': 4, 'G': 2, 'H': 4, 'I': 1,
    'J': 8, 'K': 5, 'L': 1, 'M': 3, 'N': 1, 'O': 1, 'P': 3, 'Q': 10, 'R': 1,
    'S': 1, 'T': 1, 'U': 1, 'V': 4, 'W': 4, 'X': 8, 'Y': 4, 'Z': 10
};
let dictionary = new Set();
let scannedWords = new Set(); // Use a Set to avoid duplicate words
let totalScore = 0;
let tesseractScheduler;

// --- Initialization ---
async function initialize() {
    await setupCamera();
    await loadDictionary();
    tesseractScheduler = Tesseract.createScheduler();
    const worker = await Tesseract.createWorker('eng');
    tesseractScheduler.addWorker(worker);
    scanButton.textContent = 'Scan';
    scanButton.disabled = false;
}

async function loadDictionary() {
    try {
        const response = await fetch('dictionary.txt');
        const text = await response.text();
        dictionary = new Set(text.split('\n').map(word => word.trim().toLowerCase()));
    } catch (error) {
        console.error('Dictionary load error:', error);
        alert('Could not load dictionary. Please check the connection and refresh.');
    }
}

async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
        });
        video.srcObject = stream;
        
        await new Promise(resolve => {
            video.onloadedmetadata = () => {
                video.play();

                const isStreamLandscape = video.videoWidth > video.videoHeight;
                
                // --- THIS IS THE CORRECTED PART ---
                // Flexbox is handling centering, so JS only needs to handle rotation.
                if (isStreamLandscape) {
                    video.style.transform = 'rotate(90deg)';
                } else {
                    video.style.transform = 'none';
                }
                // --- END OF CORRECTION ---
                resolve();
            };
        });
    } catch (err) {
        console.error("Error accessing camera: ", err);
        alert('Could not access camera. Please grant permission and refresh.');
    }
}

// --- UI Interaction ---
scanButton.addEventListener('click', handleScan);
closeButton.addEventListener('click', () => resultsPanel.classList.remove('visible'));

// --- Core Logic ---
async function handleScan() {
    scanButton.disabled = true;
    scanButton.textContent = '...';

    const guideRect = overlay.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    canvas.width = guideRect.width;
    canvas.height = guideRect.height;

    // The most reliable way to crop is to draw the video to the canvas
    // and let the browser handle the complex transformations.
    // We draw the entire video, then crop from it.
    
    // Create a temporary canvas that's the size of the viewport
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = window.innerWidth;
    tempCanvas.height = window.innerHeight;
    const tempCtx = tempCanvas.getContext('2d');

    // Draw the video onto the temporary canvas. The browser will render it
    // exactly as it appears on screen (centered and rotated by our CSS/JS).
    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    // Now, crop the guide box area from this perfectly rendered temporary canvas.
    ctx.drawImage(tempCanvas, guideRect.left, guideRect.top, guideRect.width, guideRect.height, 0, 0, canvas.width, canvas.height);

    // Perform OCR on the final cropped canvas
    const { data: { text } } = await tesseractScheduler.addJob('recognize', canvas, {
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });

    processRecognizedText(text);

    scanButton.disabled = false;
    scanButton.textContent = 'Scan';
}

function processRecognizedText(text) {
    const word = text.trim().toUpperCase().replace(/[^A-Z]/g, '');

    if (word.length < 2 || scannedWords.has(word)) {
        return;
    }

    scannedWords.add(word);
    const isValid = dictionary.has(word.toLowerCase());
    
    const wordDiv = document.createElement('div');
    wordDiv.classList.add('word-item');

    if (isValid) {
        const score = Array.from(word).reduce((acc, char) => acc + (letterScores[char] || 0), 0);
        totalScore += score;
        wordDiv.classList.add('valid');
        wordDiv.textContent = `${word} - Score: ${score}`;
    } else {
        wordDiv.classList.add('invalid');
        wordDiv.textContent = `${word} - (Invalid)`;
    }

    outputEl.prepend(wordDiv);
    updateTotalScore();
    
    if (!resultsPanel.classList.contains('visible')) {
        resultsPanel.classList.add('visible');
    }
}

function updateTotalScore() {
    totalScoreEl.textContent = `Total Score: ${totalScore}`;
}

// --- Start the App ---
scanButton.disabled = true;
scanButton.textContent = '...';
initialize();
