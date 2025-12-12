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
        await new Promise(resolve => video.onloadedmetadata = resolve);
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

    // Get the guide box's position relative to the viewport
    const guideRect = overlay.getBoundingClientRect();
    
    // Calculate the crop area based on the video's actual dimensions
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;

    // Find the scale factor between the video and the viewport
    const scaleX = videoWidth / viewWidth;
    const scaleY = videoHeight / viewHeight;

    // Apply the scale to the guide box dimensions to get the crop coordinates
    const cropX = guideRect.left * scaleX;
    const cropY = guideRect.top * scaleY;
    const cropWidth = guideRect.width * scaleX;
    const cropHeight = guideRect.height * scaleY;

    // Draw the full video frame to the canvas, then clear and draw only the cropped part
    const ctx = canvas.getContext('2d');
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    ctx.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

    // Perform OCR on the cropped canvas
    const { data: { text } } = await tesseractScheduler.addJob('recognize', canvas, {
        // Tell Tesseract to treat the image as a single line of text. This is crucial!
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });

    processRecognizedText(text);

    scanButton.disabled = false;
    scanButton.textContent = 'Scan';
}

function processRecognizedText(text) {
    // Clean up the recognized text: uppercase, remove non-alphabetic chars, take the first "word"
    const word = text.trim().toUpperCase().replace(/[^A-Z]/g, '');

    if (word.length < 2 || scannedWords.has(word)) {
        // Ignore short words, empty strings, or duplicates
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

    // Add the new word to the top of the list
    outputEl.prepend(wordDiv);
    updateTotalScore();
    
    // Show the results panel if it's not already visible
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
