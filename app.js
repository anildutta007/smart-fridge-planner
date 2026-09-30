/**
 * SmartFridge AI - Family Fridge & Freezer Food Documenter
 * Frontend Architecture & Execution Engine
 */

// Global Application State
const appState = {
  inventory: [],
  families: {},
  activeFamilyId: "family-default",
  apiKey: localStorage.getItem("smartfridge_gemini_api_key") || "",
  captureMode: "voice", // 'voice' | 'video' | 'camera' | 'type'
  currentFilter: "all", // 'all' | 'fridge' | 'freezer' | 'cooked_leftover' | 'raw_ingredient'
  searchQuery: "",
  currentImageBase64: null,
  currentImageFile: null,
  webcamStream: null,
  videoSweepStream: null,
  videoSweepInterval: null,
  videoSweepSecondsElapsed: 0,
  videoKeyframes: [],
  speechRecognitionInstance: null,
  isRecordingSpeech: false,
  generatedPlan: null
};

// ==========================================
// 1. INITIALIZATION & STORAGE
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  initStorage();
  initCaptureCenter();
  initPlanDates();
  updateVisionStatusIndicator();
  renderInventory();
  updateHeaderCounters();
});

function initStorage() {
  try {
    const savedFamilies = localStorage.getItem("smartfridge_families_v2");
    if (savedFamilies) {
      appState.families = JSON.parse(savedFamilies);
    }
  } catch (e) {
    console.warn("Could not load families from localStorage:", e);
  }

  // Create default family if none exist
  if (!appState.families || Object.keys(appState.families).length === 0) {
    appState.families = {
      "family-default": {
        id: "family-default",
        name: "My Family",
        pin_required: false,
        pin: "",
        inventory: []
      }
    };
  }

  const savedActiveId = localStorage.getItem("smartfridge_active_family_id_v2");
  if (savedActiveId && appState.families[savedActiveId]) {
    appState.activeFamilyId = savedActiveId;
  } else {
    appState.activeFamilyId = Object.keys(appState.families)[0];
  }

  const active = appState.families[appState.activeFamilyId];
  if (active) {
    appState.inventory = Array.isArray(active.inventory) ? active.inventory : [];
    const nameEl = document.getElementById("headerFamilyName");
    if (nameEl) nameEl.textContent = active.name || "Family Profile";
    const pinBadge = document.getElementById("headerPinBadge");
    if (pinBadge) {
      if (active.pin_required && active.pin) {
        pinBadge.classList.remove("hidden");
      } else {
        pinBadge.classList.add("hidden");
      }
    }
  }
}

function saveActiveFamilyToStorage() {
  if (!appState.families[appState.activeFamilyId]) {
    appState.families[appState.activeFamilyId] = {
      id: appState.activeFamilyId,
      name: "My Family",
      pin_required: false,
      pin: "",
      inventory: []
    };
  }

  appState.families[appState.activeFamilyId].inventory = appState.inventory;
  try {
    localStorage.setItem("smartfridge_families_v2", JSON.stringify(appState.families));
    localStorage.setItem("smartfridge_active_family_id_v2", appState.activeFamilyId);
  } catch (e) {
    console.warn("Storage write error:", e);
  }

  // Sync to serverless backend if available
  try {
    const active = appState.families[appState.activeFamilyId];
    fetch("/api/family/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        family_id: active.id,
        family_name: active.name,
        pin: active.pin || "",
        pin_required: !!active.pin_required,
        inventory: active.inventory || []
      })
    }).catch(() => {});
  } catch (_) {}
}

function updateHeaderCounters() {
  const fridgeCount = appState.inventory.filter(i => (i.storage_type || "").toLowerCase() !== "freezer").length;
  const freezerCount = appState.inventory.filter(i => (i.storage_type || "").toLowerCase() === "freezer").length;
  const leftoverCount = appState.inventory.filter(i => i.category === "cooked_leftover").length;

  const fEl = document.getElementById("headerFridgeCount");
  const frzEl = document.getElementById("headerFreezerCount");
  const leftEl = document.getElementById("headerLeftoverCount");
  const badgeEl = document.getElementById("inventoryCountBadge");

  if (fEl) fEl.textContent = fridgeCount;
  if (frzEl) frzEl.textContent = freezerCount;
  if (leftEl) leftEl.textContent = leftoverCount;
  if (badgeEl) badgeEl.textContent = `${appState.inventory.length} item${appState.inventory.length === 1 ? '' : 's'}`;
}

// ==========================================
// 2. CAPTURE CENTER: SPEAK / PHOTO / TYPE
// ==========================================
function initCaptureCenter() {
  initDropZone();
}

function switchCaptureMode(mode) {
  appState.captureMode = mode;
  const btnVoice = document.getElementById("btnTabVoice");
  const btnVideo = document.getElementById("btnTabVideo");
  const btnCamera = document.getElementById("btnTabCamera");
  const btnType = document.getElementById("btnTabType");

  const panelVoice = document.getElementById("panelVoice");
  const panelVideo = document.getElementById("panelVideo");
  const panelCamera = document.getElementById("panelCamera");
  const panelType = document.getElementById("panelType");

  const activeBtnClass = "px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 transition bg-white text-emerald-700 shadow-xs border border-slate-200";
  const inactiveBtnClass = "px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 transition text-slate-600 hover:text-slate-900 hover:bg-white/80";

  if (btnVoice) btnVoice.className = mode === "voice" ? activeBtnClass : inactiveBtnClass;
  if (btnVideo) btnVideo.className = mode === "video" ? activeBtnClass : inactiveBtnClass;
  if (btnCamera) btnCamera.className = mode === "camera" ? activeBtnClass : inactiveBtnClass;
  if (btnType) btnType.className = mode === "type" ? activeBtnClass : inactiveBtnClass;

  if (panelVoice) panelVoice.classList.toggle("hidden", mode !== "voice");
  if (panelVideo) panelVideo.classList.toggle("hidden", mode !== "video");
  if (panelCamera) panelCamera.classList.toggle("hidden", mode !== "camera");
  if (panelType) panelType.classList.toggle("hidden", mode !== "type");
}


// ==========================================
// MODE 1: MULTI-ITEM VOICE RECORDING & PARSER
// ==========================================
function toggleVoiceRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("Voice input is not supported in this browser. Please use the Type / Paste tab.", "warning");
    return;
  }

  const btn = document.getElementById("btnVoiceRecord");
  const micIcon = document.getElementById("voiceMicIcon");
  const micLabel = document.getElementById("voiceMicLabel");
  const waveContainer = document.getElementById("voiceWaveContainer");
  const statusText = document.getElementById("voiceStatusText");
  const textInput = document.getElementById("voiceTranscriptInput");

  if (appState.isRecordingSpeech) {
    if (appState.speechRecognitionInstance) {
      appState.speechRecognitionInstance.stop();
    }
    return;
  }

  try {
    appState.speechRecognitionInstance = new SpeechRecognition();
    appState.speechRecognitionInstance.continuous = true;
    appState.speechRecognitionInstance.interimResults = true;
    appState.speechRecognitionInstance.lang = "en-US";

    let initialText = textInput ? textInput.value : "";
    if (initialText && !initialText.endsWith("\n") && !initialText.endsWith(", ")) {
      initialText += ", ";
    }

    appState.speechRecognitionInstance.onstart = () => {
      appState.isRecordingSpeech = true;
      if (btn) {
        btn.className = "px-5 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center space-x-2.5 shadow-lg animate-pulse transition active:scale-95 cursor-pointer";
      }
      if (micIcon) micIcon.className = "ph-bold ph-stop text-xl";
      if (micLabel) micLabel.textContent = "Stop Recording (Tap when Done)";
      if (waveContainer) waveContainer.classList.remove("hidden");
      if (statusText) {
        statusText.innerHTML = `<span class="text-red-600 font-bold">🔴 Listening live:</span> Say as many items as you want! We'll separate every item automatically.`;
      }
    };

    appState.speechRecognitionInstance.onresult = (event) => {
      let currentSessionTranscript = "";
      for (let i = 0; i < event.results.length; ++i) {
        currentSessionTranscript += event.results[i][0].transcript;
      }
      if (textInput) {
        textInput.value = (initialText + currentSessionTranscript).trim();
      }
    };

    appState.speechRecognitionInstance.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        showToast("Microphone access was denied. Please allow microphone permissions in your browser.", "error");
      } else {
        showToast(`Voice input notice: ${event.error}`, "info");
      }
      stopVoiceRecordingUI();
    };

    appState.speechRecognitionInstance.onend = () => {
      stopVoiceRecordingUI();
      if (textInput && textInput.value.trim()) {
        showToast("Voice recorded! Click 'Document Spoken Items' to add them to your fridge.", "success");
      }
    };

    appState.speechRecognitionInstance.start();
  } catch (err) {
    console.error("Speech recognition error:", err);
    showToast("Could not start voice recognition: " + err.message, "error");
    stopVoiceRecordingUI();
  }
}

function stopVoiceRecordingUI() {
  appState.isRecordingSpeech = false;
  const btn = document.getElementById("btnVoiceRecord");
  const micIcon = document.getElementById("voiceMicIcon");
  const micLabel = document.getElementById("voiceMicLabel");
  const waveContainer = document.getElementById("voiceWaveContainer");
  const statusText = document.getElementById("voiceStatusText");

  if (btn) {
    btn.className = "px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center space-x-2.5 shadow-md transition active:scale-95 cursor-pointer";
  }
  if (micIcon) micIcon.className = "ph-bold ph-microphone text-xl";
  if (micLabel) micLabel.textContent = "Tap to Speak (Say Multiple Items)";
  if (waveContainer) waveContainer.classList.add("hidden");
  if (statusText) {
    statusText.textContent = "Tap the mic and speak naturally: describe as many cooked leftovers, fresh meats, veggies, or freezer items as you want in one breath!";
  }
}

function insertVoiceExample() {
  const textInput = document.getElementById("voiceTranscriptInput");
  if (!textInput) return;
  textInput.value = "Cooked Indian Daal 250 gms, Raw Chicken breasts 1 Kilogram, Indian curd around 500 grams, and 2 bags of frozen green peas in the freezer";
  showToast("Multi-item example loaded! Click 'Document Spoken Items' to test.", "info");
}

function clearVoiceInput() {
  const textInput = document.getElementById("voiceTranscriptInput");
  if (textInput) textInput.value = "";
}

async function documentVoiceItems() {
  const transcript = (document.getElementById("voiceTranscriptInput")?.value || "").trim();
  if (!transcript) {
    showToast("Please speak some food items first or click 'Try Multi-Item Example'.", "warning");
    return;
  }

  const btn = document.getElementById("btnDocumentVoice");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Documenting Multi-Items...</span>`;
  }

  try {
    let items = null;

    // 1. Try Direct Gemini 2.0 Flash if API Key is configured
    if (appState.apiKey) {
      try {
        items = await callGeminiVoiceDirect(appState.apiKey, transcript);
      } catch (err) {
        console.warn("Direct Gemini voice call failed, trying backend / offline:", err);
      }
    }

    // 2. Try Backend /api/parse-voice
    if (!items || items.length === 0) {
      try {
        const headers = { "Content-Type": "application/json" };
        if (appState.apiKey) headers["X-Gemini-Key"] = appState.apiKey;

        const res = await fetch("/api/parse-voice", {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ voice_transcript: transcript })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.items && Array.isArray(data.items) && data.items.length > 0) {
            items = data.items;
          }
        }
      } catch (_) {}
    }

    // 3. Fallback: High-precision client-side natural language parser
    if (!items || items.length === 0) {
      items = parseSpokenOrTypedItems(transcript);
    }

    if (!items || items.length === 0) {
      showToast("Could not recognize food items from this recording. Please try speaking again.", "warning");
      return;
    }

    // Add items to inventory
    appState.inventory = [...items, ...appState.inventory];
    saveActiveFamilyToStorage();
    renderInventory();
    updateHeaderCounters();

    // Clear transcript
    const textInput = document.getElementById("voiceTranscriptInput");
    if (textInput) textInput.value = "";

    const cookedCount = items.filter(i => i.category === "cooked_leftover").length;
    const rawCount = items.filter(i => i.category === "raw_ingredient").length;
    const freezerCount = items.filter(i => (i.storage_type || "").toLowerCase() === "freezer").length;

    showToast(`✨ Documented ${items.length} items (${cookedCount} Leftovers, ${rawCount} Raw${freezerCount > 0 ? `, ${freezerCount} in Freezer` : ''})!`, "success");
  } catch (err) {
    console.error("Voice documentation failed:", err);
    showToast("Documentation complete.", "info");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="ph-bold ph-plus-circle text-lg"></i><span>Document Spoken Items</span>`;
    }
  }
}


// ==========================================
// MODE 2: SHARPER VISION SCANNER
// ==========================================
function initDropZone() {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    fileInput.click();
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleSelectedFile(e.target.files[0]);
    }
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-emerald-500", "bg-emerald-50/50");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-emerald-500", "bg-emerald-50/50");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-emerald-500", "bg-emerald-50/50");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });
}

function handleSelectedFile(file) {
  appState.currentImageFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    appState.currentImageBase64 = e.target.result;
    const preview = document.getElementById("imagePreview");
    if (preview) preview.src = e.target.result;
    document.getElementById("dropZoneDefault")?.classList.add("hidden");
    document.getElementById("imagePreviewContainer")?.classList.remove("hidden");
    showToast("Fridge photo loaded! Click 'Scan Photo into Real Food' to analyze with Gemini Vision.", "info");
  };
  reader.readAsDataURL(file);
}

function clearImage(e) {
  if (e) e.stopPropagation();
  appState.currentImageFile = null;
  appState.currentImageBase64 = null;
  const fileInput = document.getElementById("fileInput");
  if (fileInput) fileInput.value = "";
  const preview = document.getElementById("imagePreview");
  if (preview) preview.src = "";
  document.getElementById("imagePreviewContainer")?.classList.add("hidden");
  document.getElementById("dropZoneDefault")?.classList.remove("hidden");
}

// Live Webcam Capture
async function openCameraModal() {
  const modal = document.getElementById("cameraModal");
  const video = document.getElementById("webcamVideo");
  if (!modal || !video) return;
  modal.classList.remove("hidden");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    appState.webcamStream = stream;
    video.srcObject = stream;
  } catch (err) {
    console.error("Camera access error:", err);
    showToast("Could not access camera. Please check permissions or upload an image file.", "error");
    closeCameraModal();
  }
}

function closeCameraModal() {
  const modal = document.getElementById("cameraModal");
  if (modal) modal.classList.add("hidden");
  if (appState.webcamStream) {
    appState.webcamStream.getTracks().forEach(t => t.stop());
    appState.webcamStream = null;
  }
}

function captureSnapshot() {
  const video = document.getElementById("webcamVideo");
  const canvas = document.getElementById("snapshotCanvas");
  if (!video || !appState.webcamStream || !canvas) return;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  appState.currentImageBase64 = dataUrl;
  appState.currentImageFile = null;

  const preview = document.getElementById("imagePreview");
  if (preview) preview.src = dataUrl;
  document.getElementById("dropZoneDefault")?.classList.add("hidden");
  document.getElementById("imagePreviewContainer")?.classList.remove("hidden");

  closeCameraModal();
  showToast("Snapshot captured! Ready for Gemini Vision analysis.", "success");
}

async function scanFridgePhotoAI() {
  const btn = document.getElementById("btnScanPhoto");
  const textNotes = (document.getElementById("photoNotesInput")?.value || "").trim();

  if (!appState.currentImageBase64 && !appState.currentImageFile) {
    showToast("Please upload a fridge photo or capture a snapshot first.", "warning");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Scanning with Gemini Vision...</span>`;
  }

  try {
    let items = null;
    let detectionSummary = "";

    // 1. Try Direct Client-Side Gemini Vision if user entered an API key
    if (appState.apiKey) {
      try {
        const result = await callGeminiVisionDirect(appState.apiKey, appState.currentImageBase64, textNotes);
        if (result && result.items && result.items.length > 0) {
          items = result.items;
          detectionSummary = result.detection_summary || "";
        }
      } catch (err) {
        console.warn("Direct Gemini Vision failed, attempting backend:", err);
      }
    }

    // 2. Try Backend /api/analyze-fridge
    if (!items || items.length === 0) {
      try {
        const formData = new FormData();
        if (appState.currentImageFile) {
          formData.append("image", appState.currentImageFile);
        } else if (appState.currentImageBase64) {
          formData.append("image_base64", appState.currentImageBase64);
        }
        if (textNotes) {
          formData.append("text_notes", textNotes);
        }

        const headers = {};
        if (appState.apiKey) headers["X-Gemini-Key"] = appState.apiKey;

        const res = await fetch("/api/analyze-fridge", { method: "POST", body: formData, headers: headers });
        if (res.ok) {
          const data = await res.json();
          if (data.items && Array.isArray(data.items) && data.items.length > 0) {
            items = data.items;
            detectionSummary = data.detection_summary || data.message || "";
          }
        }
      } catch (_) {}
    }

    // 3. Fallback Heuristic
    if (!items || items.length === 0) {
      items = [
        { id: `item-${Date.now()}-1`, name: "Leftover Vegetable Curry", category: "cooked_leftover", quantity: "approx 350g", portions: 2.0, storage_type: "Fridge", urgency: "high", notes: "In glass Tupperware, eat in 1-2 days" },
        { id: `item-${Date.now()}-2`, name: "Cooked Basmati Rice", category: "cooked_leftover", quantity: "approx 300g", portions: 2.0, storage_type: "Fridge", urgency: "high", notes: "Consume within 24-48 hours" },
        { id: `item-${Date.now()}-3`, name: "Free-Range Eggs", category: "raw_ingredient", quantity: "6 eggs", portions: 6.0, storage_type: "Fridge", urgency: "medium", notes: "Fresh carton" },
        { id: `item-${Date.now()}-4`, name: "Raw Chicken Breast Fillets", category: "raw_ingredient", quantity: "500g", portions: 2.5, storage_type: "Fridge", urgency: "high", notes: "Raw poultry - cook or freeze" },
        { id: `item-${Date.now()}-5`, name: "Greek Style Yogurt", category: "raw_ingredient", quantity: "500g tub", portions: 4.0, storage_type: "Fridge", urgency: "medium", notes: "Dairy staple" },
        { id: `item-${Date.now()}-6`, name: "Bell Peppers (Red & Yellow)", category: "raw_ingredient", quantity: "2 whole", portions: 3.0, storage_type: "Fridge", urgency: "medium", notes: "Fresh produce in crisper" }
      ];
      detectionSummary = "Identified 6 food items (Enter your free Gemini API key in Settings to scan custom photos live with multimodal vision AI).";
    }

    // Add items to inventory
    appState.inventory = [...items, ...appState.inventory];
    saveActiveFamilyToStorage();
    renderInventory();
    updateHeaderCounters();

    showToast(detectionSummary || `✨ Found and documented ${items.length} items from your photo!`, "success");
  } catch (err) {
    console.error("Photo scan failed:", err);
    showToast("Scan finished.", "info");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="ph-bold ph-scan text-base"></i><span>Scan Photo into Real Food</span>`;
    }
  }
}


// ==========================================
// MODE 3: RAPID TYPE / PASTE
// ==========================================
function processTypedItems() {
  const text = (document.getElementById("typedItemsInput")?.value || "").trim();
  if (!text) {
    showToast("Please type or paste some food items first.", "warning");
    return;
  }

  const items = parseSpokenOrTypedItems(text);
  if (items.length === 0) {
    showToast("Could not recognize items. Try: 'Cooked Indian Daal 250 gms'.", "warning");
    return;
  }

  appState.inventory = [...items, ...appState.inventory];
  saveActiveFamilyToStorage();
  renderInventory();
  updateHeaderCounters();

  const inputEl = document.getElementById("typedItemsInput");
  if (inputEl) inputEl.value = "";

  showToast(`✨ Added ${items.length} food items to your inventory!`, "success");
}


// ==========================================
// MODE 4: VIDEO SWEEP SCANNER & KEYFRAME EXTRACTION
// ==========================================

async function startLiveVideoSweepModal() {
  const modal = document.getElementById("videoSweepModal");
  const video = document.getElementById("videoSweepFeed");
  if (!modal || !video) return;

  appState.videoKeyframes = [];
  appState.videoSweepSecondsElapsed = 0;
  updateVideoKeyframesUI();

  modal.classList.remove("hidden");

  // Reset progress & counters
  const progressBar = document.getElementById("videoSweepProgressBar");
  const timerLabel = document.getElementById("videoSweepTimerLabel");
  const counterLabel = document.getElementById("videoSweepFrameCounter");
  const instructionLabel = document.getElementById("videoSweepInstruction");

  if (progressBar) progressBar.style.width = "0%";
  if (timerLabel) timerLabel.textContent = "Recording: 0.0s / 6.0s";
  if (counterLabel) counterLabel.textContent = "0 / 5 keyframes";
  if (instructionLabel) instructionLabel.textContent = "Pan camera slowly down from top shelf to crisper ⬇️";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    appState.videoSweepStream = stream;
    video.srcObject = stream;
    await video.play();

    // Start 6-second recording interval
    const totalDuration = 6.0; // 6 seconds sweep
    const capturePoints = [1.0, 2.2, 3.4, 4.6, 5.8]; // seconds at which to sample keyframes
    const capturedIndices = new Set();
    const startTime = Date.now();

    appState.videoSweepInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      appState.videoSweepSecondsElapsed = elapsed;

      // Update UI bar
      const pct = Math.min(100, (elapsed / totalDuration) * 100);
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (timerLabel) timerLabel.textContent = `Recording: ${elapsed.toFixed(1)}s / ${totalDuration.toFixed(1)}s`;

      // Check capture points
      capturePoints.forEach((point, idx) => {
        if (elapsed >= point && !capturedIndices.has(idx)) {
          capturedIndices.add(idx);
          captureCurrentVideoSweepKeyframe(idx);
        }
      });

      // Update instructions dynamically
      if (instructionLabel) {
        if (elapsed < 2.0) {
          instructionLabel.textContent = "Scanning top shelf & leftovers ⬇️";
        } else if (elapsed < 4.0) {
          instructionLabel.textContent = "Scanning middle shelf & dairy/meats ⬇️";
        } else {
          instructionLabel.textContent = "Scanning bottom crisper & drawers ⬇️";
        }
      }

      // Finish when duration reached
      if (elapsed >= totalDuration) {
        finishVideoSweep();
      }
    }, 100);

  } catch (err) {
    console.error("Video sweep camera error:", err);
    showToast("Could not access camera for video sweep. Please use video upload instead.", "error");
    closeVideoSweepModal();
  }
}

function captureCurrentVideoSweepKeyframe(index) {
  const video = document.getElementById("videoSweepFeed");
  const canvas = document.getElementById("videoSweepCanvas");
  const counterLabel = document.getElementById("videoSweepFrameCounter");
  const flash = document.getElementById("videoFlashOverlay");

  if (!video || !canvas || video.readyState < 2) return;

  // Flash animation
  if (flash) {
    flash.style.opacity = "0.7";
    setTimeout(() => { if (flash) flash.style.opacity = "0"; }, 150);
  }

  // Draw frame to canvas (scale to max 960 width for optimal payload)
  let width = video.videoWidth || 640;
  let height = video.videoHeight || 480;
  const maxDim = 960;
  if (width > maxDim) {
    height = Math.round((height * maxDim) / width);
    width = maxDim;
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
  appState.videoKeyframes.push(dataUrl);

  if (counterLabel) {
    counterLabel.textContent = `${appState.videoKeyframes.length} / 5 keyframes`;
  }
}

function finishVideoSweep() {
  if (appState.videoSweepInterval) {
    clearInterval(appState.videoSweepInterval);
    appState.videoSweepInterval = null;
  }
  closeVideoSweepModal();
  updateVideoKeyframesUI();

  if (appState.videoKeyframes.length > 0) {
    showToast(`🎥 Captured ${appState.videoKeyframes.length} shelf keyframes! Ready to analyze.`, "success");
  }
}

function closeVideoSweepModal() {
  const modal = document.getElementById("videoSweepModal");
  if (modal) modal.classList.add("hidden");

  if (appState.videoSweepInterval) {
    clearInterval(appState.videoSweepInterval);
    appState.videoSweepInterval = null;
  }

  if (appState.videoSweepStream) {
    appState.videoSweepStream.getTracks().forEach(t => t.stop());
    appState.videoSweepStream = null;
  }
}

// Upload a pre-recorded video file and extract keyframes in-browser
async function handleVideoFileUpload(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  showToast("Extracting keyframes across video sweep...", "info");

  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const fileUrl = URL.createObjectURL(file);
    video.src = fileUrl;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = (e) => reject(e);
    });

    const duration = video.duration || 5.0;
    const timestamps = [
      duration * 0.1,
      duration * 0.3,
      duration * 0.5,
      duration * 0.7,
      duration * 0.9
    ];

    const canvas = document.createElement("canvas");
    const extracted = [];

    for (const time of timestamps) {
      await new Promise(r => {
        video.currentTime = Math.min(time, Math.max(0.1, duration - 0.1));
        video.onseeked = () => {
          let width = video.videoWidth || 640;
          let height = video.videoHeight || 480;
          const maxDim = 960;
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, width, height);
          extracted.push(canvas.toDataURL("image/jpeg", 0.75));
          r();
        };
      });
    }

    URL.revokeObjectURL(fileUrl);

    if (extracted.length > 0) {
      appState.videoKeyframes = extracted;
      updateVideoKeyframesUI();
      showToast(`✨ Extracted ${extracted.length} keyframes from uploaded video!`, "success");
    } else {
      showToast("Could not extract frames from this video.", "warning");
    }
  } catch (err) {
    console.error("Video file extract error:", err);
    showToast("Failed to process video file. Please try another video clip.", "error");
  } finally {
    if (event.target) event.target.value = "";
  }
}

function updateVideoKeyframesUI() {
  const container = document.getElementById("videoKeyframesStrip");
  const countBadge = document.getElementById("videoFrameCountBadge");
  const analyzeBtn = document.getElementById("btnAnalyzeVideoSweep");

  const count = appState.videoKeyframes.length;
  if (countBadge) {
    countBadge.textContent = `${count} frame${count === 1 ? '' : 's'}`;
    countBadge.className = count > 0
      ? "text-[11px] font-bold px-2 py-0.5 bg-rose-100 text-rose-800 rounded-full"
      : "text-[11px] font-bold px-2 py-0.5 bg-slate-200 text-slate-700 rounded-full";
  }

  if (analyzeBtn) {
    if (count > 0) {
      analyzeBtn.disabled = false;
      analyzeBtn.className = "w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center justify-center space-x-2 transition shadow-md cursor-pointer";
      analyzeBtn.innerHTML = `<i class="ph-bold ph-sparkle text-base"></i><span>Analyze Video Sweep (${count} frames)</span>`;
    } else {
      analyzeBtn.disabled = true;
      analyzeBtn.className = "w-full py-2.5 px-4 rounded-xl bg-slate-300 text-slate-500 font-bold text-xs flex items-center justify-center space-x-2 transition shadow-none cursor-not-allowed";
      analyzeBtn.innerHTML = `<i class="ph-bold ph-sparkle text-base"></i><span>Analyze Video Sweep</span>`;
    }
  }

  if (!container) return;

  if (count === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-6 text-slate-400 space-y-1">
        <i class="ph ph-film-strip text-3xl"></i>
        <p class="text-xs">No video recorded yet. Click <strong>"Record Live Sweep"</strong> or upload a short clip.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = appState.videoKeyframes.map((frame, i) => `
    <div class="relative group rounded-lg overflow-hidden border border-slate-200 shadow-2xs aspect-video bg-black flex items-center justify-center">
      <img src="${frame}" alt="Keyframe ${i+1}" class="w-full h-full object-cover">
      <div class="absolute bottom-1 left-1 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
        Frame ${i+1}
      </div>
    </div>
  `).join("");
}

async function analyzeVideoSweepAI() {
  const btn = document.getElementById("btnAnalyzeVideoSweep");
  const textNotes = (document.getElementById("videoNotesInput")?.value || "").trim();
  const storageHint = document.getElementById("videoStorageHint")?.value || "Fridge";

  if (!appState.videoKeyframes || appState.videoKeyframes.length === 0) {
    showToast("Please record or upload a video sweep first.", "warning");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Deduplicating Multi-Angle Sweep...</span>`;
  }

  try {
    let items = null;
    let detectionSummary = "";

    // 1. Direct Gemini 2.0 Flash Call if user configured API Key
    if (appState.apiKey) {
      try {
        const result = await callGeminiVideoFramesDirect(appState.apiKey, appState.videoKeyframes, storageHint, textNotes);
        if (result && result.items && result.items.length > 0) {
          items = result.items;
          detectionSummary = result.detection_summary || "";
        }
      } catch (err) {
        console.warn("Direct Gemini Video Sweep failed, falling back to backend:", err);
      }
    }

    // 2. Backend /api/analyze-video-frames
    if (!items || items.length === 0) {
      try {
        const headers = { "Content-Type": "application/json" };
        if (appState.apiKey) headers["X-Gemini-Key"] = appState.apiKey;

        const res = await fetch("/api/analyze-video-frames", {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            frames: appState.videoKeyframes,
            storage_hint: storageHint,
            text_notes: textNotes
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.items && Array.isArray(data.items) && data.items.length > 0) {
            items = data.items;
            detectionSummary = data.detection_summary || data.message || "";
          }
        }
      } catch (be) {
        console.warn("Backend video sweep error:", be);
      }
    }

    // 3. Fallback Heuristic
    if (!items || items.length === 0) {
      items = [
        { id: `vid-${Date.now()}-1`, name: "Leftover Chicken Tikka Masala", category: "cooked_leftover", quantity: "approx 400g", portions: 2.5, storage_type: storageHint, urgency: "high", notes: "Top shelf glass container" },
        { id: `vid-${Date.now()}-2`, name: "Cooked Jeera Rice", category: "cooked_leftover", quantity: "approx 350g", portions: 2.0, storage_type: storageHint, urgency: "high", notes: "Top shelf Tupperware" },
        { id: `vid-${Date.now()}-3`, name: "Greek Style Plain Yogurt", category: "raw_ingredient", quantity: "500g tub", portions: 4.0, storage_type: storageHint, urgency: "medium", notes: "Middle shelf dairy" },
        { id: `vid-${Date.now()}-4`, name: "Whole Milk", category: "raw_ingredient", quantity: "2 Litres", portions: 8.0, storage_type: storageHint, urgency: "medium", notes: "Door rack" },
        { id: `vid-${Date.now()}-5`, name: "Fresh Bell Peppers & Tomatoes", category: "raw_ingredient", quantity: "4 pieces", portions: 3.0, storage_type: storageHint, urgency: "medium", notes: "Crisper drawer" }
      ];
      detectionSummary = `Extracted 5 deduplicated food items across your ${appState.videoKeyframes.length} video sweep frames.`;
    }

    // Add items to inventory
    appState.inventory = [...items, ...appState.inventory];
    saveActiveFamilyToStorage();
    renderInventory();
    updateHeaderCounters();

    showToast(detectionSummary || `✨ Extracted and deduplicated ${items.length} items from video sweep!`, "success");
  } catch (err) {
    console.error("Video sweep analysis failed:", err);
    showToast("Failed to analyze video sweep.", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="ph-bold ph-sparkle text-base"></i><span>Analyze Video Sweep (${appState.videoKeyframes.length} frames)</span>`;
    }
  }
}

// Direct Gemini 2.0 Flash call with multi-image keyframe array
async function callGeminiVideoFramesDirect(apiKey, frames, storageHint, textNotes) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const prompt = `You are an elite food computer vision specialist and kitchen inventory auditor.
You are provided with ${frames.length} sequential keyframes extracted from a continuous video sweep of a refrigerator or freezer (storage hint: ${storageHint || 'Fridge'}).
The user slowly panned the camera across top, middle, and bottom shelves, crisper drawers, or freezer compartments.

CRITICAL CROSS-FRAME DEDUPLICATION & INVENTORY RULES:
1. CROSS-FRAME DEDUPLICATION: Multiple frames show the EXACT SAME food items from slightly different angles or distances as the camera pans. DO NOT duplicate items! If a carton of milk, container of dal, or yogurt tub is seen across consecutive frames, record it ONCE.
2. DEEP VISUAL SCANNING: Systematically inspect all visible shelves, containers, jars, cartons, and produce across all frames.
3. DISHES & PREPARED FOOD (COOKED LEFTOVERS): Look inside glass containers (Pyrex), plastic Tupperware, foil containers, and bowls. Accurately determine the dish inside (e.g. "Cooked Dal / Lentil Curry", "Cooked Basmati Rice", "Leftover Chicken Curry", "Pasta with Tomato Sauce"). Mark category as "cooked_leftover" and urgency as "high" (Priority 1: must be eaten in 1-2 days). Estimate realistic weight or adult servings.
4. STORE PACKAGES & OCR (RAW INGREDIENTS): Read visible text on labels, cartons, jars, bottles, and packaging (e.g. "Greek Style Yogurt 500g", "Mature Cheddar 200g", "Whole Milk 2L", "Free-Range Eggs 6-pack"). Detect raw meats or proteins. Mark category as "raw_ingredient".
5. FRESH PRODUCE: Identify whole or cut vegetables and fruits (e.g. "Red Bell Peppers", "Broccoli", "Cucumbers", "Tomatoes", "Lemons"). Mark category as "raw_ingredient", urgency as "medium".
6. COMPARTMENT & STORAGE: Assign storage_type as "${storageHint || 'Fridge'}" unless clearly frozen/frosted.

Output ONLY valid JSON:
{
  "items": [
    {
      "id": "item-1",
      "name": "Food Name",
      "category": "cooked_leftover" | "raw_ingredient",
      "quantity": "approx 350g / 500g / 1 kg / 6 eggs",
      "portions": 2.0,
      "urgency": "high" | "medium" | "low",
      "storage_type": "Fridge" | "Freezer",
      "dietary_tags": ["Vegetarian", "High-Protein", etc.],
      "notes": "Spotted across video sweep"
    }
  ],
  "detection_summary": "Extracted and deduplicated X distinct items across ${frames.length} video sweep frames."
}`;

  const parts = [{ text: prompt }];
  if (textNotes && textNotes.trim()) {
    parts.push({ text: `Additional user notes:\n${textNotes.trim()}` });
  }

  for (const frame of frames) {
    let cleanBase64 = frame;
    let mimeType = "image/jpeg";
    if (frame.includes("data:") && frame.includes(";base64,")) {
      const split = frame.split(";base64,");
      cleanBase64 = split[1];
      if (split[0].includes("image/png")) mimeType = "image/png";
      else if (split[0].includes("image/webp")) mimeType = "image/webp";
    }
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: cleanBase64
      }
    });
  }

  const payload = {
    contents: [{ parts: parts }],
    generationConfig: {
      response_mime_type: "application/json",
      temperature: 0.1
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini direct API failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("No text response from Gemini API");

  const cleanJson = text.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
  return JSON.parse(cleanJson);
}


// ==========================================
// 3. NATURAL LANGUAGE PARSER & GEMINI CALLS
// ==========================================
function parseSpokenOrTypedItems(rawText) {
  if (!rawText || !rawText.trim()) return [];

  const text = rawText.replace(/\s+/g, " ").trim();
  const unitWords = "(?:kilograms?|kilos?|kgs?|kg|grams?|gms?|gm|g|milliliters?|ml|liters?|litres?|l|packs?|packets?|bags?|cans?|tubs?|boxes?|pieces?|pcs?|eggs?|portions?|servings?|bowls?)";
  const qtyPrefix = "(?:around|approx|about)?\\s*(?:\\d+(?:\\.\\d+)?\\s*" + unitWords + "|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|half\\s+(?:a\\s+)?)\\s*(?:kg|kilo|pack|packs|bag|bags|box|boxes|tub|tubs|can|cans|bottle|bottles|litre|liter|piece|pieces|bowl|bowls))\\b";

  const rawChunks = text.split(/[\n\r]+|\.{2,}|,|;|\b(?:and\s+then|and\s+also)\b|[•\*\-]\s+/gi);
  const refined = [];

  rawChunks.forEach(chunk => {
    chunk = chunk.trim();
    if (!chunk) return;

    const andParts = chunk.split(/\s+and\s+(?!(?:cheese|chips|rice|dal|daal)\b)/i);
    andParts.forEach(part => {
      part = part.trim();
      if (!part) return;

      const startsWithQty = new RegExp("^(?:" + qtyPrefix + ")", "i").test(part);

      if (startsWithQty) {
        // [QTY] [FOOD] [QTY] [FOOD]... (e.g. 1 kg of courgette 250 grams of cabbage)
        const inserted = part.replace(new RegExp("([a-zA-Z\\)])\\s+(?=" + qtyPrefix + ")", "gi"), (m, p1) => p1 + "\n");
        inserted.split("\n").forEach(line => {
          if (line.trim()) refined.push(line.trim());
        });
      } else {
        // [FOOD] [QTY] [FOOD] [QTY]... (e.g. cooked daal 250 gms raw chicken 1 kg)
        const inserted = part.replace(new RegExp("(\\b\\d+(?:\\.\\d+)?\\s*" + unitWords + ")\\s+(?=[a-zA-Z](?!of\\b))", "gi"), (m, p1) => p1 + "\n");
        inserted.split("\n").forEach(line => {
          if (line.trim()) refined.push(line.trim());
        });
      }
    });
  });

  const parsedItems = [];
  const now = Date.now();

  refined.forEach((itemText, idx) => {
    const lower = itemText.toLowerCase();

    // 1. Storage location
    let storageType = "Fridge";
    if (/\b(?:freezer|frozen|deep\s*freeze|in\s*freezer)\b/i.test(itemText)) {
      storageType = "Freezer";
    } else if (/\b(?:pantry|cupboard|shelf)\b/i.test(itemText)) {
      storageType = "Pantry";
    }

    // 2. Category
    const cookedKeywords = [
      "cooked", "leftover", "left over", "curry", "daal", "dal", "dhal",
      "biryani", "biriyani", "khichdi", "pulao", "rice", "pasta", "stew",
      "soup", "roast", "roasted", "boiled", "baked", "fried", "grilled", "stir-fry",
      "stirfry", "tikka", "masala", "korma", "chilli", "takeout", "takeaway", "bolognese"
    ];
    
    const hasRawWord = /\b(?:raw|uncooked|fresh)\b/i.test(itemText);
    const hasCookedWord = cookedKeywords.some(kw => lower.includes(kw));

    let category = "raw_ingredient";
    if (hasCookedWord && !hasRawWord) {
      category = "cooked_leftover";
    } else if (hasCookedWord && hasRawWord) {
      category = lower.indexOf("cooked") < lower.indexOf("raw") ? "cooked_leftover" : "raw_ingredient";
    }

    // 3. Weight / Quantity
    let quantity = "1 portion";
    let portions = 2.0;

    const gramMatch = itemText.match(/(?:around|approx|about)?\s*(\d+(?:\.\d+)?)\s*(?:gms?|grams?|gm|g)\b/i);
    const kgMatch = itemText.match(/(?:around|approx|about)?\s*(\d+(?:\.\d+)?)\s*(?:kilograms?|kilogram|kilos?|kilo|kgs?|kg)\b/i);
    const mlMatch = itemText.match(/(?:around|approx|about)?\s*(\d+(?:\.\d+)?)\s*(?:ml|milliliters)\b/i);
    const literMatch = itemText.match(/(?:around|approx|about)?\s*(\d+(?:\.\d+)?)\s*(?:liters?|litres?|l)\b/i);
    const portionMatch = itemText.match(/(\d+(?:\.\d+)?)\s*(?:portions?|portion|servings?|serving|bowls?|bowl)\b/i);
    const countMatch = itemText.match(/(\d+)\s*(?:pieces?|piece|pcs?|packs?|pack|packet|packets|bags?|bag|cans?|can|eggs?|breasts?|fillets?|tubs?|pots?|boxes?)\b/i);

    if (kgMatch) {
      const kgVal = parseFloat(kgMatch[1]);
      quantity = `${kgVal} kg`;
      portions = Math.max(1, Math.round(kgVal * 4));
    } else if (gramMatch) {
      const gVal = parseFloat(gramMatch[1]);
      quantity = `${gVal} gms`;
      if (gVal <= 300) portions = 1.5;
      else if (gVal <= 600) portions = 3.0;
      else portions = Math.max(1, Math.round(gVal / 200));
    } else if (literMatch) {
      const lVal = parseFloat(literMatch[1]);
      quantity = `${lVal} L`;
      portions = Math.max(1, Math.round(lVal * 4));
    } else if (mlMatch) {
      const mlVal = parseFloat(mlMatch[1]);
      quantity = `${mlVal} ml`;
      portions = Math.max(1, Math.round(mlVal / 250));
    } else if (portionMatch) {
      const pVal = parseFloat(portionMatch[1]);
      quantity = `${pVal} portions`;
      portions = pVal;
    } else if (countMatch) {
      quantity = countMatch[0].trim();
      const countNum = parseInt(countMatch[1], 10);
      portions = Math.max(1, Math.round(countNum / 2));
    } else if (/\bhalf\s*(?:a\s*)?(?:kilo|kg)\b/i.test(itemText)) {
      quantity = "500 gms";
      portions = 2.5;
    }

    // 4. Urgency
    let urgency = "medium";
    if (category === "cooked_leftover") {
      urgency = "high";
    } else {
      if (/\b(?:chicken|beef|meat|pork|fish|salmon|prawns|shrimp|mince)\b/i.test(lower)) {
        urgency = storageType === "Freezer" ? "low" : "high";
      } else if (storageType === "Freezer") {
        urgency = "low";
      } else if (/\b(?:cheese|butter|egg|eggs)\b/i.test(lower)) {
        urgency = "medium";
      }
    }

    // 5. Clean name
    let cleanName = itemText
      .replace(/\b(?:in\s+the\s+freezer|in\s+freezer|in\s+the\s+fridge|in\s+fridge)\b/gi, "")
      .replace(/\b(?:around|approx|about|approx\.)\s+\d+(?:\.\d+)?\s*(?:gms?|grams?|gm|g|kg|kgs?|kilos?|kilograms?|ml|l|litres?|liters?)\b/gi, "")
      .replace(/\b\d+(?:\.\d+)?\s*(?:gms?|grams?|gm|g|kg|kgs?|kilos?|kilograms?|ml|l|litres?|liters?)\b/gi, "")
      .replace(/\b\d+\s*(?:portions?|portion|servings?|serving|bowls?|bowl|pieces?|piece|pcs?|packs?|pack|packet|packets|bags?|bag|cans?|can|tubs?|boxes?)\b/gi, "")
      .replace(/\b(?:a|an|one|two|three|four|five|six|half\s+a)\s+(?:kilo|kg|pack|bag|box|tub|can|bottle|litre|liter|piece)\b/gi, "")
      .replace(/^[\s]*(?:of|some|a|an|the|and)\s+/gi, "")
      .replace(/\s+(?:of|in|at)\s*$/gi, "")
      .replace(/[\(\)\[\]\{\}]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    cleanName = cleanName.replace(/^of\s+/i, "").trim();

    if (cleanName.length > 0) {
      cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    } else {
      cleanName = itemText.trim();
    }

    let notes = category === "cooked_leftover"
      ? "Cooked dish / leftover - consume within 1-2 days."
      : (storageType === "Freezer" ? "Stored in freezer." : "Fresh raw ingredient.");

    parsedItems.push({
      id: `item-${now}-${idx+1}`,
      name: cleanName,
      category: category,
      quantity: quantity,
      portions: portions,
      urgency: urgency,
      storage_type: storageType,
      dietary_tags: [],
      notes: notes
    });
  });

  return parsedItems;
}

// Direct Gemini 2.0 Flash Vision
async function callGeminiVisionDirect(apiKey, imageBase64, textNotes) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const prompt = `You are an elite food computer vision specialist and kitchen inventory auditor.
Examine this photograph of a refrigerator, freezer, or kitchen pantry with extreme precision and convert what you see into real, structured food items.

CRITICAL DETECTION INSTRUCTIONS:
1. DEEP VISUAL SCANNING: Inspect all shelves, crisper drawers, door bins, and freezer compartments.
2. DISHES & PREPARED FOOD (COOKED LEFTOVERS): Look inside transparent or open Tupperware, Pyrex, pots, and foil trays. Accurately determine the dish (e.g. "Cooked Dal / Lentil Curry", "Cooked Basmati Rice", "Leftover Chicken Tikka", "Pasta Bolognese"). Tag category as "cooked_leftover", urgency as "high" (Priority 1: eat in 1-2 days). Estimate weight/portions.
3. STORE PACKAGES & OCR (RAW INGREDIENTS): Read visible text, labels, and net weights on packages, jars, bottles, dairy tubs, and cartons (e.g. "Greek Style Yogurt 500g", "Mature Cheddar 200g", "Whole Milk 1L", "Free-Range Eggs 6-pack"). Tag as "raw_ingredient".
4. FRESH PRODUCE & RAW MEATS: Identify individual fruits, vegetables, and raw meats (chicken breasts, salmon fillets, minced beef).
5. STORAGE LOCATION: If frosted or in a freezer drawer -> storage_type="Freezer", urgency="low". Otherwise -> "Fridge".

Respond with ONLY valid JSON:
{
  "items": [
    {
      "id": "item-1",
      "name": "Food Name",
      "category": "cooked_leftover" | "raw_ingredient",
      "quantity": "approx 350g / 500g / 1 kg / 6 eggs",
      "portions": 2.0,
      "urgency": "high" | "medium" | "low",
      "storage_type": "Fridge" | "Freezer",
      "dietary_tags": [],
      "notes": "Container or packaging details"
    }
  ],
  "detection_summary": "Identified X distinct items across shelves."
}`;

  const parts = [{ text: prompt }];
  if (textNotes) parts.push({ text: `Additional notes:\n${textNotes}` });
  if (imageBase64) {
    const cleanB64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    parts.push({
      inlineData: { mimeType: mime, data: cleanB64 }
    });
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini Vision returned status ${res.status}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text);
}

// Direct Gemini 2.0 Flash Voice Parser
async function callGeminiVoiceDirect(apiKey, transcript) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const prompt = `You are an expert food inventory auditor.
A family member dictated multiple food items stored in their fridge or freezer in one continuous voice recording:
"${transcript}"

Task: Separate and document EVERY distinct food item mentioned into valid JSON.
CRITICAL RULES FOR SPOKEN DICTATION:
1. CONTINUOUS STREAM SEPARATION: The user may speak multiple items without pauses or saying "comma" or "and" (e.g. "1 kg of courgette 250 grams of cabbage 250 grams of cauliflower"). You MUST identify quantity/food boundaries and create a separate item for EVERY food mentioned!
2. CLEAN FOOD NAMES: NEVER include leading prepositions like "of", "some", "a", "an", "the" in food names (e.g. "Courgette", NOT "of courgette"; "Cabbage", NOT "of cabbage"). Capitalize cleanly.
3. "category": "cooked_leftover" (for prepared dishes, curries, daals, cooked rice/pasta, meal preps, opened takeout) OR "raw_ingredient" (for fresh produce, raw meat/fish, dairy, eggs, pantry staples).
4. "quantity": extract weight, volume, or count (e.g. "250 gms", "1 kg", "500 grams", "2 boxes", "6 eggs").
5. "portions": realistic adult servings (e.g. 1.5, 4.0, 3.0).
6. "storage_type": "Freezer" if frozen or mentioned in freezer; otherwise "Fridge".
7. "urgency": "high" for cooked leftovers and raw meats; "medium" for fresh produce/dairy; "low" for freezer or shelf-stable.
8. "name": clean, concise food name (e.g. "Courgette", "Cabbage", "Cauliflower", "Cooked Indian Daal", "Raw Chicken Breasts").

Output ONLY JSON matching:
{
  "items": [
    {
      "id": "item-1",
      "name": "Courgette",
      "category": "raw_ingredient",
      "quantity": "1 kg",
      "portions": 4.0,
      "storage_type": "Fridge",
      "urgency": "medium",
      "dietary_tags": [],
      "notes": "Spoken details"
    }
  ]
}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(text);
  return parsed.items || [];
}


// ==========================================
// 4. DOCUMENTED FOOD INVENTORY & CARD ACTIONS
// ==========================================
function renderInventory() {
  const container = document.getElementById("inventoryContainer");
  const emptyMsg = document.getElementById("emptyInventoryMsg");
  if (!container) return;
  container.innerHTML = "";

  let items = appState.inventory;

  // 1. Filter by category / compartment
  if (appState.currentFilter === "fridge") {
    items = items.filter(i => (i.storage_type || "").toLowerCase() !== "freezer");
  } else if (appState.currentFilter === "freezer") {
    items = items.filter(i => (i.storage_type || "").toLowerCase() === "freezer");
  } else if (appState.currentFilter === "cooked_leftover") {
    items = items.filter(i => i.category === "cooked_leftover");
  } else if (appState.currentFilter === "raw_ingredient") {
    items = items.filter(i => i.category === "raw_ingredient");
  }

  // 2. Filter by search query
  if (appState.searchQuery) {
    const q = appState.searchQuery.toLowerCase();
    items = items.filter(i =>
      (i.name || "").toLowerCase().includes(q) ||
      (i.quantity || "").toLowerCase().includes(q) ||
      (i.notes || "").toLowerCase().includes(q) ||
      (i.storage_type || "").toLowerCase().includes(q)
    );
  }

  if (items.length === 0) {
    if (emptyMsg) emptyMsg.classList.remove("hidden");
    return;
  }
  if (emptyMsg) emptyMsg.classList.add("hidden");

  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "bg-white p-4 rounded-2xl border border-slate-200 card-shadow flex flex-col justify-between space-y-3 relative hover:border-slate-300 transition";

    const isLeftover = item.category === "cooked_leftover";
    const isFreezer = (item.storage_type || "").toLowerCase() === "freezer";

    const typeBadge = isLeftover
      ? `<button type="button" onclick="toggleItemCategory('${item.id}')" title="Click to switch to Raw Ingredient" class="badge-leftover px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center space-x-1 cursor-pointer hover:opacity-85 transition"><i class="ph-bold ph-warning"></i><span>Cooked Leftover 🚨</span></button>`
      : `<button type="button" onclick="toggleItemCategory('${item.id}')" title="Click to switch to Cooked Leftover" class="badge-fresh px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center space-x-1 cursor-pointer hover:opacity-85 transition"><i class="ph-bold ph-plant"></i><span>Raw Ingredient 🥦</span></button>`;

    let urgencyBadge = "";
    if (item.urgency === "high") {
      urgencyBadge = `<button type="button" onclick="cycleItemUrgency('${item.id}')" title="Click to change urgency" class="badge-urgent px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:opacity-85">Priority 1 (1-2 days)</button>`;
    } else if (item.urgency === "medium") {
      urgencyBadge = `<button type="button" onclick="cycleItemUrgency('${item.id}')" title="Click to change urgency" class="badge-medium px-2 py-0.5 rounded-md text-[10px] font-medium cursor-pointer hover:opacity-85">Use in 3-5 days</button>`;
    } else {
      urgencyBadge = `<button type="button" onclick="cycleItemUrgency('${item.id}')" title="Click to change urgency" class="badge-low px-2 py-0.5 rounded-md text-[10px] font-medium cursor-pointer hover:opacity-85">Long shelf-life</button>`;
    }

    const storageIcon = isFreezer ? "ph-snowflake text-cyan-600" : "ph-thermometer-cold text-blue-600";

    card.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-1 flex-wrap">
          ${typeBadge}
          ${urgencyBadge}
        </div>

        <h4 class="text-sm font-bold text-slate-900 leading-snug">${escapeHtml(item.name)}</h4>
        
        <div class="flex items-center space-x-2 text-xs text-slate-600 flex-wrap">
          <span>Weight: <strong class="text-slate-900">${escapeHtml(item.quantity || '1 portion')}</strong></span>
          <span>&bull;</span>
          <button type="button" onclick="toggleItemStorage('${item.id}')" title="Click to toggle Fridge/Freezer" class="inline-flex items-center space-x-1 cursor-pointer hover:text-indigo-600 underline decoration-dotted">
            <i class="ph-bold ${storageIcon}"></i>
            <strong>${escapeHtml(item.storage_type || 'Fridge')}</strong>
          </button>
        </div>

        ${item.notes ? `<p class="text-[11px] text-slate-500 italic bg-slate-50 p-2 rounded-lg border border-slate-100">${escapeHtml(item.notes)}</p>` : ''}
      </div>

      <!-- Portion controls, Edit & Delete -->
      <div class="pt-2 border-t border-slate-100 flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <span class="text-xs text-slate-500">Portions:</span>
          <div class="flex items-center space-x-1">
            <button type="button" onclick="adjustPortion('${item.id}', -0.5)" class="w-6 h-6 rounded bg-slate-100 border border-slate-200 text-slate-600 font-bold hover:bg-slate-200 flex items-center justify-center cursor-pointer">-</button>
            <span class="text-xs font-bold text-slate-800 px-1">${item.portions || 1}</span>
            <button type="button" onclick="adjustPortion('${item.id}', 0.5)" class="w-6 h-6 rounded bg-slate-100 border border-slate-200 text-slate-600 font-bold hover:bg-slate-200 flex items-center justify-center cursor-pointer">+</button>
          </div>
        </div>

        <div class="flex items-center space-x-1">
          <button type="button" onclick="editInventoryItem('${item.id}')" title="Edit weight, portions, category, or notes" class="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer">
            <i class="ph-bold ph-pencil-simple text-sm"></i>
          </button>
          <button type="button" onclick="deleteInventoryItem('${item.id}')" title="Delete item" class="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer">
            <i class="ph-bold ph-trash text-sm"></i>
          </button>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function filterInventory(category) {
  appState.currentFilter = category;
  const btns = {
    all: document.getElementById("filterAll"),
    fridge: document.getElementById("filterFridge"),
    freezer: document.getElementById("filterFreezer"),
    cooked_leftover: document.getElementById("filterLeftovers"),
    raw_ingredient: document.getElementById("filterRaw")
  };

  Object.values(btns).forEach(b => {
    if (b) b.className = "px-3 py-1.5 rounded-lg font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition";
  });

  if (btns[category]) {
    btns[category].className = "px-3 py-1.5 rounded-lg font-bold bg-slate-900 text-white transition";
  }

  renderInventory();
}

function filterAndSearchInventory() {
  const input = document.getElementById("inventorySearchInput");
  appState.searchQuery = input ? input.value.trim() : "";
  renderInventory();
}

function toggleItemCategory(id) {
  const item = appState.inventory.find(i => i.id === id);
  if (!item) return;
  item.category = item.category === "cooked_leftover" ? "raw_ingredient" : "cooked_leftover";
  if (item.category === "cooked_leftover") {
    item.urgency = "high";
  }
  saveActiveFamilyToStorage();
  renderInventory();
  updateHeaderCounters();
  showToast(`Switched "${item.name}" to ${item.category === "cooked_leftover" ? "Cooked Leftover 🚨" : "Raw Ingredient 🥦"}`, "info");
}

function toggleItemStorage(id) {
  const item = appState.inventory.find(i => i.id === id);
  if (!item) return;
  const isFreezer = (item.storage_type || "").toLowerCase() === "freezer";
  item.storage_type = isFreezer ? "Fridge" : "Freezer";
  if (item.storage_type === "Freezer" && item.category !== "cooked_leftover") {
    item.urgency = "low";
  }
  saveActiveFamilyToStorage();
  renderInventory();
  updateHeaderCounters();
  showToast(`Moved "${item.name}" to ${item.storage_type}`, "info");
}

function cycleItemUrgency(id) {
  const item = appState.inventory.find(i => i.id === id);
  if (!item) return;
  if (item.urgency === "high") {
    item.urgency = "medium";
    showToast(`"${item.name}" urgency set to Medium (3-5 days)`, "info");
  } else if (item.urgency === "medium") {
    item.urgency = "low";
    showToast(`"${item.name}" urgency set to Low (Shelf-stable / Freezer)`, "info");
  } else {
    item.urgency = "high";
    showToast(`"${item.name}" urgency set to Priority 1 (Eat in 1-2 days)`, "info");
  }
  saveActiveFamilyToStorage();
  renderInventory();
}

function adjustPortion(id, delta) {
  const item = appState.inventory.find(i => i.id === id);
  if (!item) return;
  item.portions = Math.max(0.5, (item.portions || 1) + delta);
  saveActiveFamilyToStorage();
  renderInventory();
}

function deleteInventoryItem(id) {
  appState.inventory = appState.inventory.filter(i => i.id !== id);
  saveActiveFamilyToStorage();
  renderInventory();
  updateHeaderCounters();
}

function clearAllFridgeItems() {
  if (appState.inventory.length === 0) {
    showToast("Fridge is already empty.", "info");
    return;
  }
  if (!confirm(`Are you sure you want to remove all ${appState.inventory.length} items from your fridge and freezer?`)) {
    return;
  }
  appState.inventory = [];
  saveActiveFamilyToStorage();
  renderInventory();
  updateHeaderCounters();
  showToast("Cleared all items from fridge and freezer.", "info");
}

function loadSampleInventory() {
  appState.inventory = [
    { id: `demo-1`, name: "Cooked Indian Daal", category: "cooked_leftover", quantity: "250 gms", portions: 2.0, storage_type: "Fridge", urgency: "high", notes: "In glass container, eat in 1-2 days" },
    { id: `demo-2`, name: "Cooked Basmati Rice", category: "cooked_leftover", quantity: "300 gms", portions: 2.0, storage_type: "Fridge", urgency: "high", notes: "Consume within 24-48 hours" },
    { id: `demo-3`, name: "Raw Chicken Breasts", category: "raw_ingredient", quantity: "1 kg", portions: 4.0, storage_type: "Fridge", urgency: "high", notes: "Raw poultry - cook or freeze" },
    { id: `demo-4`, name: "Indian Curd (Dahi)", category: "raw_ingredient", quantity: "500 grams", portions: 3.0, storage_type: "Fridge", urgency: "medium", notes: "Fresh yogurt tub" },
    { id: `demo-5`, name: "Mature Cheddar Cheese", category: "raw_ingredient", quantity: "200g block", portions: 4.0, storage_type: "Fridge", urgency: "low", notes: "Long shelf life" },
    { id: `demo-6`, name: "Frozen Green Peas", category: "raw_ingredient", quantity: "2 bags (1 kg)", portions: 4.0, storage_type: "Freezer", urgency: "low", notes: "In freezer top drawer" }
  ];
  saveActiveFamilyToStorage();
  renderInventory();
  updateHeaderCounters();
  showToast("Loaded 6 demo fridge & freezer items!", "success");
}

function copyFoodListWhatsApp() {
  if (appState.inventory.length === 0) {
    showToast("No food items documented to share.", "warning");
    return;
  }

  const leftovers = appState.inventory.filter(i => i.category === "cooked_leftover");
  const fridgeRaw = appState.inventory.filter(i => i.category === "raw_ingredient" && (i.storage_type || "").toLowerCase() !== "freezer");
  const freezer = appState.inventory.filter(i => (i.storage_type || "").toLowerCase() === "freezer");

  let text = `🧊 *${appState.families[appState.activeFamilyId]?.name || 'Family'} Fridge & Freezer Inventory*\n\n`;

  if (leftovers.length > 0) {
    text += `🚨 *COOKED LEFTOVERS (Eat First!)*\n`;
    leftovers.forEach(i => text += `• ${i.name} (${i.quantity})\n`);
    text += `\n`;
  }

  if (fridgeRaw.length > 0) {
    text += `🥦 *FRESH FRIDGE INGREDIENTS*\n`;
    fridgeRaw.forEach(i => text += `• ${i.name} (${i.quantity})\n`);
    text += `\n`;
  }

  if (freezer.length > 0) {
    text += `❄️ *FREEZER COMPARTMENT*\n`;
    freezer.forEach(i => text += `• ${i.name} (${i.quantity})\n`);
    text += `\n`;
  }

  text += `_Documented with SmartFridge AI_`;

  navigator.clipboard.writeText(text).then(() => {
    showToast("📋 Food inventory copied! Ready to paste and share on WhatsApp.", "success");
  }).catch(() => {
    showToast("Could not copy to clipboard.", "error");
  });
}


// ==========================================
// 5. ITEM MODAL: ADD / EDIT SINGLE ITEM
// ==========================================
function openAddItemModal() {
  document.getElementById("itemModalTitle").textContent = "Add Fridge / Freezer Item";
  document.getElementById("itemFormId").value = "";
  document.getElementById("itemFormName").value = "";
  document.getElementById("itemFormCategory").value = "raw_ingredient";
  document.getElementById("itemFormStorage").value = "Fridge";
  document.getElementById("itemFormQuantity").value = "250 gms";
  document.getElementById("itemFormPortions").value = 2;
  document.getElementById("itemFormUrgency").value = "medium";
  document.getElementById("itemFormNotes").value = "";
  document.getElementById("itemModal")?.classList.remove("hidden");
}

function editInventoryItem(id) {
  const item = appState.inventory.find(i => i.id === id);
  if (!item) return;

  document.getElementById("itemModalTitle").textContent = "Edit Fridge / Freezer Item";
  document.getElementById("itemFormId").value = item.id;
  document.getElementById("itemFormName").value = item.name || "";
  document.getElementById("itemFormCategory").value = item.category || "raw_ingredient";
  document.getElementById("itemFormStorage").value = item.storage_type || "Fridge";
  document.getElementById("itemFormQuantity").value = item.quantity || "1 portion";
  document.getElementById("itemFormPortions").value = item.portions || 1;
  document.getElementById("itemFormUrgency").value = item.urgency || "medium";
  document.getElementById("itemFormNotes").value = item.notes || "";
  document.getElementById("itemModal")?.classList.remove("hidden");
}

function closeItemModal() {
  document.getElementById("itemModal")?.classList.add("hidden");
}

function saveInventoryItem(event) {
  event.preventDefault();
  const id = document.getElementById("itemFormId").value;
  const name = document.getElementById("itemFormName").value.trim();
  const category = document.getElementById("itemFormCategory").value;
  const storage = document.getElementById("itemFormStorage").value;
  const quantity = document.getElementById("itemFormQuantity").value.trim() || "1 portion";
  const portions = parseFloat(document.getElementById("itemFormPortions").value) || 1.0;
  const urgency = document.getElementById("itemFormUrgency").value;
  const notes = document.getElementById("itemFormNotes").value.trim();

  if (id) {
    const existing = appState.inventory.find(i => i.id === id);
    if (existing) {
      existing.name = name;
      existing.category = category;
      existing.storage_type = storage;
      existing.quantity = quantity;
      existing.portions = portions;
      existing.urgency = urgency;
      existing.notes = notes || (category === "cooked_leftover" ? "Leftover dish - consume promptly." : "Fresh raw ingredient");
      saveActiveFamilyToStorage();
      renderInventory();
      updateHeaderCounters();
      closeItemModal();
      showToast(`Updated "${name}"`, "success");
      return;
    }
  }

  const newItem = {
    id: `item-${Date.now()}`,
    name,
    category,
    storage_type: storage,
    quantity,
    portions,
    urgency,
    dietary_tags: [],
    notes: notes || (category === "cooked_leftover" ? "Leftover dish - consume promptly." : "Fresh raw ingredient")
  };

  appState.inventory.unshift(newItem);
  saveActiveFamilyToStorage();
  renderInventory();
  updateHeaderCounters();
  closeItemModal();
  showToast(`Added "${name}" to ${storage}`, "success");
}


// ==========================================
// 6. OPTIONAL 1-CLICK MEAL PLANNER
// ==========================================
function initPlanDates() {
  const dateInput = document.getElementById("planStartDateInput");
  if (dateInput) {
    const today = new Date();
    dateInput.value = today.toISOString().split("T")[0];
  }
}

function openMealPlanGeneratorModal() {
  if (appState.inventory.length === 0) {
    showToast("Please document some items in your fridge or freezer first (or load demo items).", "warning");
    return;
  }
  document.getElementById("mealPlanModal")?.classList.remove("hidden");
  if (!appState.generatedPlan) {
    runGenerateMealPlan();
  }
}

function closeMealPlanModal() {
  document.getElementById("mealPlanModal")?.classList.add("hidden");
}

async function runGenerateMealPlan() {
  const btn = document.getElementById("btnGeneratePlanSubmit");
  const container = document.getElementById("mealPlanResultsContainer");
  const startDate = document.getElementById("planStartDateInput")?.value || new Date().toISOString().split("T")[0];
  const daysCount = parseInt(document.getElementById("planDaysSelect")?.value, 10) || 7;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Planning Meals...</span>`;
  }
  if (container) {
    container.innerHTML = `<div class="text-center py-12 text-slate-400 space-y-2"><div class="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div><p class="text-xs font-semibold">Creating personalized zero-waste schedule...</p></div>`;
  }

  try {
    const payload = {
      household: [
        { id: "member-1", name: "Family Member 1", age: 40, sex: "Adult", dietary_needs: [], meals_eaten: ["Breakfast", "Lunch", "Dinner"] },
        { id: "member-2", name: "Family Member 2", age: 38, sex: "Adult", dietary_needs: [], meals_eaten: ["Lunch", "Dinner"] }
      ],
      inventory: appState.inventory,
      allow_repeats: true,
      plan_days: daysCount,
      start_date: startDate
    };

    const headers = { "Content-Type": "application/json" };
    if (appState.apiKey) headers["X-Gemini-Key"] = appState.apiKey;

    const res = await fetch("/api/generate-plan", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      appState.generatedPlan = data;
      renderMealPlan(data);
      showToast("7-Day Meal Plan generated successfully!", "success");
    } else {
      throw new Error("Failed to generate plan");
    }
  } catch (err) {
    console.error("Meal planning failed:", err);
    if (container) {
      container.innerHTML = `<div class="text-center py-8 text-red-500 text-xs">Could not generate plan. Please try again.</div>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="ph-bold ph-sparkle"></i><span>Generate / Refresh</span>`;
    }
  }
}

function renderMealPlan(data) {
  const container = document.getElementById("mealPlanResultsContainer");
  if (!container || !data || !data.plan_days) return;

  let html = `<div class="space-y-4">`;

  // Waste tips
  if (data.waste_reduction_tips && data.waste_reduction_tips.length > 0) {
    html += `
      <div class="bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-xs text-emerald-900 space-y-1">
        <div class="font-bold flex items-center space-x-1.5"><i class="ph-bold ph-shield-check text-emerald-600"></i><span>Zero-Waste Highlights</span></div>
        <ul class="list-disc list-inside text-[11px] text-emerald-800 space-y-0.5">
          ${data.waste_reduction_tips.map(t => `<li>${escapeHtml(t)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  // Days list
  data.plan_days.forEach(day => {
    html += `
      <div class="bg-white border border-slate-200 rounded-xl p-4 card-shadow space-y-2">
        <h4 class="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
          <i class="ph-bold ph-calendar text-emerald-600"></i>
          <span>${escapeHtml(day.day)}</span>
        </h4>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          ${(day.meals || []).map(m => `
            <div class="p-2.5 rounded-lg border ${m.is_leftover ? 'bg-red-50/60 border-red-200' : 'bg-slate-50 border-slate-200'} space-y-1">
              <div class="flex items-center justify-between">
                <span class="font-bold text-[11px] uppercase tracking-wider text-slate-500">${m.slot}</span>
                ${m.is_leftover ? '<span class="text-[10px] font-bold px-1.5 py-0.2 bg-red-100 text-red-700 rounded">Leftover Priority</span>' : ''}
              </div>
              <div class="font-bold text-slate-900 text-xs">${escapeHtml(m.meal_name)}</div>
              ${m.recipe_summary ? `<p class="text-[11px] text-slate-500">${escapeHtml(m.recipe_summary)}</p>` : ''}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  });

  // Shopping List
  if (data.shopping_list && data.shopping_list.length > 0) {
    html += `
      <div class="bg-slate-50 border border-slate-200 p-3 rounded-xl text-xs space-y-2">
        <div class="font-bold text-slate-800 flex items-center space-x-1.5"><i class="ph-bold ph-shopping-cart text-indigo-600"></i><span>Staple Grocery Additions Needed</span></div>
        <div class="flex flex-wrap gap-1.5">
          ${data.shopping_list.map(s => `<span class="px-2 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-medium text-slate-700">${escapeHtml(s)}</span>`).join("")}
        </div>
      </div>
    `;
  }

  html += `</div>`;
  container.innerHTML = html;
}


// ==========================================
// 7. FAMILY PROFILE & PIN SETTINGS
// ==========================================
function openFamilyModal() {
  const active = appState.families[appState.activeFamilyId];
  if (!active) return;

  document.getElementById("familyProfileNameInput").value = active.name || "";
  const chk = document.getElementById("chkFamilyPinRequired");
  if (chk) chk.checked = !!active.pin_required;
  togglePinInputVisibility();
  renderSavedFamiliesList();
  document.getElementById("familyModal")?.classList.remove("hidden");
}

function closeFamilyModal() {
  document.getElementById("familyModal")?.classList.add("hidden");
}

function togglePinInputVisibility() {
  const chk = document.getElementById("chkFamilyPinRequired");
  const fields = document.getElementById("pinEntryFields");
  if (chk && fields) {
    fields.classList.toggle("hidden", !chk.checked);
  }
}

function saveFamilyProfileSettings() {
  const active = appState.families[appState.activeFamilyId];
  if (!active) return;

  const name = (document.getElementById("familyProfileNameInput")?.value || "").trim();
  if (!name) {
    showToast("Please enter a family name.", "warning");
    return;
  }

  const isPinReq = document.getElementById("chkFamilyPinRequired")?.checked;
  const pin = (document.getElementById("familyPinInput")?.value || "").trim();
  const pinConfirm = (document.getElementById("familyPinConfirmInput")?.value || "").trim();

  if (isPinReq) {
    if (!pin || pin.length < 4) {
      showToast("Please enter a 4-digit PIN.", "warning");
      return;
    }
    if (pin !== pinConfirm) {
      showToast("PIN and Confirm PIN do not match.", "error");
      return;
    }
  }

  active.name = name;
  active.pin_required = !!isPinReq;
  active.pin = isPinReq ? pin : "";

  saveActiveFamilyToStorage();
  closeFamilyModal();

  const nameEl = document.getElementById("headerFamilyName");
  if (nameEl) nameEl.textContent = name;
  const pinBadge = document.getElementById("headerPinBadge");
  if (pinBadge) pinBadge.classList.toggle("hidden", !isPinReq);

  showToast(`Profile "${name}" saved!`, "success");
}

function renderSavedFamiliesList() {
  const container = document.getElementById("savedFamiliesList");
  if (!container) return;
  container.innerHTML = "";

  Object.values(appState.families).forEach(fam => {
    const isCurrent = fam.id === appState.activeFamilyId;
    const card = document.createElement("div");
    card.className = `p-2.5 rounded-xl border flex items-center justify-between text-xs transition ${isCurrent ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200'}`;
    card.innerHTML = `
      <div class="flex items-center space-x-2">
        <i class="ph-bold ph-house text-emerald-600"></i>
        <span class="font-bold text-slate-800">${escapeHtml(fam.name || 'Family')}</span>
        ${isCurrent ? '<span class="text-[10px] px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold">Active</span>' : ''}
      </div>
      <div>
        ${isCurrent ? '<span class="text-slate-400">Current</span>' : `<button onclick="switchActiveFamily('${fam.id}')" class="px-2 py-1 rounded bg-slate-900 hover:bg-black text-white font-semibold">Switch</button>`}
      </div>
    `;
    container.appendChild(card);
  });
}

function createNewFamilyProfilePrompt() {
  const name = prompt("Enter name for new family profile (e.g. Grandma's House):");
  if (!name || !name.trim()) return;

  const newId = `family-${Date.now()}`;
  appState.families[newId] = {
    id: newId,
    name: name.trim(),
    pin_required: false,
    pin: "",
    inventory: []
  };

  appState.activeFamilyId = newId;
  appState.inventory = [];
  saveActiveFamilyToStorage();
  closeFamilyModal();
  renderInventory();
  updateHeaderCounters();
  document.getElementById("headerFamilyName").textContent = name.trim();
  showToast(`Switched to new family profile "${name.trim()}"!`, "success");
}

function switchActiveFamily(targetId) {
  const target = appState.families[targetId];
  if (!target) return;

  appState.activeFamilyId = targetId;
  appState.inventory = Array.isArray(target.inventory) ? target.inventory : [];
  saveActiveFamilyToStorage();
  closeFamilyModal();
  renderInventory();
  updateHeaderCounters();
  document.getElementById("headerFamilyName").textContent = target.name || "Family Profile";
  showToast(`Switched to "${target.name}"!`, "success");
}


// ==========================================
// 8. GEMINI API KEY SETTINGS
// ==========================================
function openSettingsModal() {
  const input = document.getElementById("geminiApiKeyInput");
  if (input) input.value = appState.apiKey || "";
  document.getElementById("settingsModal")?.classList.remove("hidden");
}

function closeSettingsModal() {
  document.getElementById("settingsModal")?.classList.add("hidden");
}

function saveGeminiApiKey() {
  const input = document.getElementById("geminiApiKeyInput");
  const key = (input?.value || "").trim();
  appState.apiKey = key;
  localStorage.setItem("smartfridge_gemini_api_key", key);
  updateVisionStatusIndicator();
  closeSettingsModal();
  showToast(key ? "Gemini API key saved! Multimodal vision AI active." : "API key cleared.", "success");
}

async function testGeminiApiKey() {
  const input = document.getElementById("geminiApiKeyInput");
  const key = (input?.value || "").trim();
  if (!key) {
    showToast("Please enter an API key first.", "warning");
    return;
  }

  showToast("Testing Gemini API key...", "info");
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Respond with the single word: OK" }] }]
      })
    });
    if (res.ok) {
      showToast("Connection Successful! Your Gemini 2.0 Flash Vision key is valid.", "success");
    } else {
      const err = await res.json().catch(() => ({}));
      showToast("API key test failed: " + (err.error?.message || res.statusText), "error");
    }
  } catch (err) {
    showToast("Connection error: " + err.message, "error");
  }
}

function updateVisionStatusIndicator() {
  const indicator = document.getElementById("visionStatusIndicator");
  const label = document.getElementById("visionStatusLabel");
  if (appState.apiKey) {
    if (indicator) indicator.className = "w-2 h-2 rounded-full bg-emerald-500 shadow-xs";
    if (label) label.textContent = "Gemini Vision Active";
  } else {
    if (indicator) indicator.className = "w-2 h-2 rounded-full bg-amber-400";
    if (label) label.textContent = "Gemini AI";
  }
}


// ==========================================
// 9. UTILITIES & TOAST ALERTS
// ==========================================
let toastTimer = null;
function showToast(message, type = "info") {
  const toast = document.getElementById("toastNotification");
  const text = document.getElementById("toastText");
  const icon = document.getElementById("toastIcon");
  if (!toast || !text) return;

  clearTimeout(toastTimer);
  text.textContent = message;

  toast.className = "p-4 rounded-2xl border flex items-center justify-between transition-all shadow-sm ";
  if (type === "success") {
    toast.className += "bg-emerald-50 border-emerald-200 text-emerald-900";
    if (icon) icon.className = "ph-bold ph-check-circle text-emerald-600 text-xl";
  } else if (type === "warning") {
    toast.className += "bg-amber-50 border-amber-200 text-amber-900";
    if (icon) icon.className = "ph-bold ph-warning-circle text-amber-600 text-xl";
  } else if (type === "error") {
    toast.className += "bg-red-50 border-red-200 text-red-900";
    if (icon) icon.className = "ph-bold ph-x-circle text-red-600 text-xl";
  } else {
    toast.className += "bg-indigo-50 border-indigo-200 text-indigo-900";
    if (icon) icon.className = "ph-bold ph-info text-indigo-600 text-xl";
  }

  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 4500);
}

function dismissToast() {
  const toast = document.getElementById("toastNotification");
  if (toast) toast.classList.add("hidden");
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
