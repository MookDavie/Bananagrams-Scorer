// Get references to our HTML elements
const video = document.getElementById('video');
const scanButton = document.getElementById('scanButton');
const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const outputEl = document.getElementById('output');

// Define letter scores
const letterScores = {
    'A': 1, 'B': 3, 'C': 3, 'D': 2, 'E': 1, 'F': 4, 'G': 2, 'H': 4, 'I': 1,
    'J': 8, 'K': 5, 'L': 1, 'M': 3, 'N': 1, 'O': 1, 'P': 3, 'Q': 10, 'R': 1,
    'S': 1, 'T': 1, 'U': 1, 'V': 4, 'W': 4, 'X': 8, 'Y': 4, 'Z': 10
};

let dictionary = new Set();

// --- 1. Initialization ---

async function loadDictionary() {
    try {
        const response = await fetch('dictionary.txt');
        const text = await response.text();
        const words = text.split('\n').map(word => word.trim().toLowerCase());
        dictionary = new Set(words);
        statusEl.textContent = 'Dictionary loaded. Ready to scan.';
    } catch (error) {
        statusEl.textContent = 'Error loading dictionary.';
        console.error('Dictionary load error:', error);
    }
}

async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                // This is key for phones: it requests the rear camera
                facingMode: 'environment' 
            }
        });
        video.srcObject = stream;
        video.addEventListener('loadedmetadata', () => video.play());
    } catch (err) {
        console.error("Error accessing camera: ", err);
        statusEl.textContent = 'Could not access camera. Please grant permission and refresh.';
    }
}

// --- 2. OCR and Scoring Logic ---

scanButton.addEventListener('click', async () => {
    if (dictionary.size === 0) {
        statusEl.textContent = 'Dictionary is not loaded yet. Please wait.';
        return;
    }

    scanButton.disabled = true;
    scanButton.textContent = 'Scanning...';
    outputEl.innerHTML = ''; // Clear previous results

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    const { data: { text } } = await Tesseract.recognize(
        canvas,
        'eng',
        {
            logger: m => {
                if (m.status === 'recognizing text') {
                    statusEl.textContent = `Recognizing text... ${Math.round(m.progress * 100)}%`;
                }
            }
        }
    );

    processRecognizedText(text);
    scanButton.disabled = false;
    scanButton.textContent = 'Scan Words';
});

function processRecognizedText(text) {
    const words = text
        .toUpperCase()
        .replace(/[^A-Z\s]/g, '') // Keep only letters and spaces
        .split(/\s+/)
        .filter(word => word.length > 1);

    if (words.length === 0) {
        statusEl.textContent = 'Scan complete. No words were recognized. Try a clearer picture.';
        return;
    }

    let totalScore = 0;
    let validWordsCount = 0;

    words.forEach(word => {
        const isValid = dictionary.has(word.toLowerCase());
        const wordDiv = document.createElement('div');
        wordDiv.classList.add('word-item');

        if (isValid) {
            const score = Array.from(word).reduce((acc, char) => acc + (letterScores[char] || 0), 0);
            totalScore += score;
            validWordsCount++;
            wordDiv.classList.add('valid');
            wordDiv.textContent = `${word} - Score: ${score}`;
        } else {
            wordDiv.classList.add('invalid');
            wordDiv.textContent = `${word} - (Invalid)`;
        }
        outputEl.appendChild(wordDiv);
    });

    statusEl.textContent = `Scan Complete! Found ${validWordsCount} valid word(s) for a total score of ${totalScore}.`;
}

// --- 3. Start the application ---
setupCamera();
loadDictionary();
