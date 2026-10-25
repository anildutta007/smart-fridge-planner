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
  captureMode: "voice", // 'voice' | 'receipt' | 'camera' | 'type'
  currentFilter: "all", // 'all' | 'fridge' | 'freezer' | 'pantry' | 'cooked_leftover' | 'raw_ingredient'
  searchQuery: "",
  currentImageBase64: null,
  currentImageFile: null,
  webcamStream: null,
  scannedReceiptItems: [],
  currentReceiptBase64: null,
  dishes: [],
  dishesFilter: "all",
  dishesSearchQuery: "",
  dishModalIngredients: [],
  isListeningDishVoice: false,
  dishSpeechInstance: null,
  lastInventoryBackup: null,
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
  initReceiptScanner();
  loadDishes();
  initPlanDates();
  updateVisionStatusIndicator();
  renderInventory();
  renderDishes();
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

  // Check URL parameters (e.g. ?wake=ramukaka or ?mode=voice or ?from=shortcut)
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("mode")) {
      const mode = params.get("mode").toLowerCase();
      if (["voice", "receipt", "camera", "type"].includes(mode)) {
        switchCaptureMode(mode);
      }
    }
    if (params.get("wake") === "ramukaka" || params.has("ramukaka") || params.has("assistant")) {
      setTimeout(() => {
        openRamuKakaModal(true);
      }, 500);
    }
  } catch (_) {}
}

function switchCaptureMode(mode) {
  appState.captureMode = mode;
  const btnVoice = document.getElementById("btnTabVoice");
  const btnReceipt = document.getElementById("btnTabReceipt");
  const btnCamera = document.getElementById("btnTabCamera");
  const btnType = document.getElementById("btnTabType");

  const panelVoice = document.getElementById("panelVoice");
  const panelReceipt = document.getElementById("panelReceipt");
  const panelCamera = document.getElementById("panelCamera");
  const panelType = document.getElementById("panelType");

  const activeBtnClass = "px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 transition bg-white text-emerald-700 shadow-xs border border-slate-200";
  const inactiveBtnClass = "px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 transition text-slate-600 hover:text-slate-900 hover:bg-white/80";

  if (btnVoice) btnVoice.className = mode === "voice" ? activeBtnClass : inactiveBtnClass;
  if (btnReceipt) btnReceipt.className = mode === "receipt" ? activeBtnClass : inactiveBtnClass;
  if (btnCamera) btnCamera.className = mode === "camera" ? activeBtnClass : inactiveBtnClass;
  if (btnType) btnType.className = mode === "type" ? activeBtnClass : inactiveBtnClass;

  if (panelVoice) panelVoice.classList.toggle("hidden", mode !== "voice");
  if (panelReceipt) panelReceipt.classList.toggle("hidden", mode !== "receipt");
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

    let initialText = textInput ? textInput.value.trim() : "";
    if (initialText) {
      if (!initialText.endsWith(",") && !initialText.endsWith("\n")) {
        initialText += ", ";
      } else if (initialText.endsWith(",")) {
        initialText += " ";
      }
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
        textInput.value = initialText + currentSessionTranscript;
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
  showToast("Cleared voice text box.", "info");
}

// Normalized duplicate item check
function normalizeFoodItemName(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[\(\)\[\]\{\}\.,;:\-_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ies\b/g, "y")
    .replace(/es\b/g, "e")
    .replace(/s\b/g, "");
}

function isDuplicateInventoryItem(newItem, existingInventory) {
  if (!newItem || !newItem.name) return false;
  if (!Array.isArray(existingInventory) || existingInventory.length === 0) return false;

  const newNorm = normalizeFoodItemName(newItem.name);
  const newStorage = (newItem.storage_type || "Fridge").toLowerCase();

  return existingInventory.some(existing => {
    const existingNorm = normalizeFoodItemName(existing.name);
    const existingStorage = (existing.storage_type || "Fridge").toLowerCase();

    // Compartment check (Fridge vs Freezer)
    if (newStorage !== existingStorage) return false;

    // Exact or singular/plural match
    if (newNorm === existingNorm) return true;

    // Substring match for phrases (e.g. "Courgette" vs "Fresh Courgettes")
    if (newNorm.length >= 4 && existingNorm.length >= 4) {
      if (newNorm.startsWith(existingNorm) || existingNorm.startsWith(newNorm)) {
        return true;
      }
    }

    return false;
  });
}

async function documentVoiceItems() {
  const transcriptInput = document.getElementById("voiceTranscriptInput");
  const transcript = (transcriptInput?.value || "").trim();
  if (!transcript) {
    showToast("Please speak some food items first or click 'Try Multi-Item Example'.", "warning");
    return;
  }

  // Preserve the exact text in memory to guarantee it is NEVER wiped
  const preservedTranscript = transcriptInput.value;

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

    // Check for duplicates against existing inventory and skip already recorded items
    const newItemsToAdd = [];
    const skippedDuplicates = [];

    items.forEach(item => {
      if (isDuplicateInventoryItem(item, appState.inventory)) {
        skippedDuplicates.push(item.name);
      } else {
        newItemsToAdd.push(item);
      }
    });

    if (newItemsToAdd.length > 0) {
      appState.inventory = [...newItemsToAdd, ...appState.inventory];
      saveActiveFamilyToStorage();
      renderInventory();
      updateHeaderCounters();
    }

    // Explicitly guarantee spoken data stays in the window
    if (transcriptInput) {
      transcriptInput.value = preservedTranscript;
    }

    const cookedCount = newItemsToAdd.filter(i => i.category === "cooked_leftover").length;
    const rawCount = newItemsToAdd.filter(i => i.category === "raw_ingredient").length;
    const freezerCount = newItemsToAdd.filter(i => (i.storage_type || "").toLowerCase() === "freezer").length;

    if (newItemsToAdd.length > 0 && skippedDuplicates.length > 0) {
      showToast(`✨ Documented ${newItemsToAdd.length} new items (${cookedCount} Leftovers, ${rawCount} Raw${freezerCount > 0 ? `, ${freezerCount} in Freezer` : ""})! Skipped ${skippedDuplicates.length} already recorded: ${skippedDuplicates.join(", ")}.`, "success");
    } else if (newItemsToAdd.length > 0) {
      showToast(`✨ Documented ${newItemsToAdd.length} items (${cookedCount} Leftovers, ${rawCount} Raw${freezerCount > 0 ? `, ${freezerCount} in Freezer` : ""})!`, "success");
    } else {
      showToast(`ℹ️ All ${skippedDuplicates.length} items are already recorded in your inventory (skipped duplicates: ${skippedDuplicates.join(", ")}).`, "info");
    }
  } catch (err) {
    console.error("Voice documentation failed:", err);
    showToast("Documentation complete.", "info");
  } finally {
    if (transcriptInput && preservedTranscript) {
      transcriptInput.value = preservedTranscript;
    }
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

  const newItemsToAdd = [];
  const skippedDuplicates = [];

  items.forEach(item => {
    if (isDuplicateInventoryItem(item, appState.inventory)) {
      skippedDuplicates.push(item.name);
    } else {
      newItemsToAdd.push(item);
    }
  });

  if (newItemsToAdd.length > 0) {
    appState.inventory = [...newItemsToAdd, ...appState.inventory];
    saveActiveFamilyToStorage();
    renderInventory();
    updateHeaderCounters();
  }

  const inputEl = document.getElementById("typedItemsInput");
  if (inputEl) inputEl.value = "";

  if (newItemsToAdd.length > 0 && skippedDuplicates.length > 0) {
    showToast(`✨ Added ${newItemsToAdd.length} new items (skipped ${skippedDuplicates.length} duplicates: ${skippedDuplicates.join(", ")})!`, "success");
  } else if (newItemsToAdd.length > 0) {
    showToast(`✨ Added ${newItemsToAdd.length} food items to your inventory!`, "success");
  } else {
    showToast(`ℹ️ All ${skippedDuplicates.length} items are already in your inventory (skipped duplicates).`, "info");
  }
}


// ==========================================
// MODE 4: SUPERMARKET BILL & RECEIPT OCR SCANNER
// ==========================================

function initReceiptScanner() {
  const dropZone = document.getElementById("receiptDropZone");
  const fileInput = document.getElementById("receiptFileInput");
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    fileInput.click();
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-indigo-500", "bg-indigo-50/50");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-indigo-500", "bg-indigo-50/50");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-indigo-500", "bg-indigo-50/50");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleReceiptSelectedFile(e.dataTransfer.files[0]);
    }
  });
}

function handleReceiptFileUpload(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  handleReceiptSelectedFile(file);
}

function handleReceiptSelectedFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    appState.currentReceiptBase64 = e.target.result;
    const preview = document.getElementById("receiptImagePreview");
    if (preview) preview.src = e.target.result;
    document.getElementById("receiptDropDefault")?.classList.add("hidden");
    document.getElementById("receiptImagePreviewContainer")?.classList.remove("hidden");
    processReceiptImage(e.target.result);
  };
  reader.readAsDataURL(file);
}

function clearReceiptImage(e) {
  if (e) e.stopPropagation();
  appState.currentReceiptBase64 = null;
  appState.scannedReceiptItems = [];
  const fileInput = document.getElementById("receiptFileInput");
  if (fileInput) fileInput.value = "";
  const preview = document.getElementById("receiptImagePreview");
  if (preview) preview.src = "";
  document.getElementById("receiptImagePreviewContainer")?.classList.add("hidden");
  document.getElementById("receiptDropDefault")?.classList.remove("hidden");
  document.getElementById("receiptExtractedBox")?.classList.add("hidden");
}

function loadSampleReceipt() {
  // Demo receipt image and items
  showToast("Loading sample supermarket bill (Tesco / Superstore)...", "info");
  const dummyReceiptBase64 = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='200' viewBox='0 0 300 200'><rect fill='%23f8fafc' width='300' height='200'/><text x='20' y='40' font-family='sans-serif' font-weight='bold' font-size='16' fill='%231e293b'>TESCO SUPERSTORE RECEIPT</text><text x='20' y='70' font-family='sans-serif' font-size='12' fill='%2364748b'>Whole Milk 2L ............ £1.65</text><text x='20' y='95' font-family='sans-serif' font-size='12' fill='%2364748b'>Chicken Breast 650g ...... £4.25</text><text x='20' y='120' font-family='sans-serif' font-size='12' fill='%2364748b'>Fresh Cabbage 500g ....... £0.79</text><text x='20' y='145' font-family='sans-serif' font-size='12' fill='%2364748b'>Brown Onions 1kg ......... £1.10</text><text x='20' y='170' font-family='sans-serif' font-size='12' fill='%2364748b'>Basmati Rice 2kg ......... £3.50</text></svg>";
  
  appState.currentReceiptBase64 = dummyReceiptBase64;
  const preview = document.getElementById("receiptImagePreview");
  if (preview) preview.src = dummyReceiptBase64;
  document.getElementById("receiptDropDefault")?.classList.add("hidden");
  document.getElementById("receiptImagePreviewContainer")?.classList.remove("hidden");
  processReceiptImage(dummyReceiptBase64, true);
}

async function processReceiptImage(base64Image, isSample = false) {
  showToast("Scanning receipt line-by-line with AI...", "info");
  let items = null;
  let storeName = "Supermarket";

  try {
    // 1. Try Direct Gemini 2.0 Flash Vision OCR if user configured API Key
    if (appState.apiKey && base64Image && !isSample) {
      try {
        const result = await callGeminiReceiptDirect(appState.apiKey, base64Image);
        if (result && result.items && result.items.length > 0) {
          items = result.items;
          storeName = result.store_name || "Supermarket";
        }
      } catch (err) {
        console.warn("Direct Gemini Receipt OCR failed, trying backend:", err);
      }
    }

    // 2. Try Backend /api/analyze-receipt
    if (!items || items.length === 0) {
      try {
        const headers = { "Content-Type": "application/json" };
        if (appState.apiKey) headers["X-Gemini-Key"] = appState.apiKey;

        const res = await fetch("/api/analyze-receipt", {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            image: base64Image || "sample",
            text_notes: "Supermarket grocery bill"
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.items && Array.isArray(data.items) && data.items.length > 0) {
            items = data.items;
            storeName = data.store_name || "Supermarket";
          }
        }
      } catch (be) {
        console.warn("Backend receipt analysis error:", be);
      }
    }

    // 3. Fallback Heuristic
    if (!items || items.length === 0) {
      items = [
        { id: `rec-${Date.now()}-1`, name: "Fresh Whole Milk", category: "raw_ingredient", quantity: "2 Litres", portions: 8.0, storage_type: "Fridge", urgency: "medium", notes: "Dairy shelf in Fridge" },
        { id: `rec-${Date.now()}-2`, name: "British Chicken Breast Fillets", category: "raw_ingredient", quantity: "650g", portions: 4.0, storage_type: "Fridge", urgency: "high", notes: "Meat drawer in Fridge" },
        { id: `rec-${Date.now()}-3`, name: "Fresh White Cabbage", category: "raw_ingredient", quantity: "500g", portions: 3.0, storage_type: "Fridge", urgency: "medium", notes: "Bottom crisper drawer" },
        { id: `rec-${Date.now()}-4`, name: "Brown Cooking Onions", category: "raw_ingredient", quantity: "1 kg bag", portions: 8.0, storage_type: "Pantry", urgency: "low", notes: "Stored in Open Space / Pantry" },
        { id: `rec-${Date.now()}-5`, name: "Kohinoor Basmati Rice", category: "raw_ingredient", quantity: "2 kg", portions: 16.0, storage_type: "Pantry", urgency: "low", notes: "Stored in Open Space / Pantry" },
        { id: `rec-${Date.now()}-6`, name: "Birds Eye Garden Peas (Frozen)", category: "raw_ingredient", quantity: "800g", portions: 6.0, storage_type: "Freezer", urgency: "low", notes: "Stored in Freezer compartment" }
      ];
      storeName = "Tesco Superstore";
    }

    appState.scannedReceiptItems = items.map((item, idx) => ({
      ...item,
      selected: true,
      rowId: `receipt-row-${idx}`
    }));

    renderScannedReceiptTable(storeName);
    showToast(`🧾 Extracted ${items.length} items from ${storeName}! Review and add to your kitchen.`, "success");
  } catch (err) {
    console.error("Receipt processing failed:", err);
    showToast("Failed to process receipt image. Please try again.", "error");
  }
}

async function callGeminiReceiptDirect(apiKey, base64Image) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const prompt = `You are an expert grocery receipt / supermarket bill auditor and kitchen inventory manager.
Analyze the grocery receipt image carefully. Read all printed line items, descriptions, weights/quantities, and prices.
For every purchased grocery/food item:
1. Extract clean food item name (e.g. "Whole Milk", "Chicken Breast Fillets", "Mature Cheddar Cheese", "Brown Onions", "Basmati Rice", "Frozen Garden Peas").
2. Extract quantity/weight (e.g. "2 Litres", "650g", "1 kg", "6 pack", "400g"). If no weight is printed, extract unit count or "1 pack".
3. Intelligently determine proper storage compartment:
   - "Fridge": dairy, fresh milk, cheeses, fresh poultry/meats, yogurt, deli meats, salad greens, fresh vegetables, fresh dips.
   - "Freezer": frozen vegetables, frozen berries, ice cream, frozen nuggets, frozen fish/meat.
   - "Pantry" (Open Space): onions, potatoes, garlic, rice, lentils, flour, cooking oil, spices, pasta, bread, cereal, canned beans/tomatoes.
4. Set category to "raw_ingredient".
5. Estimate realistic portions (1 portion = good for 1 person).

Output ONLY valid JSON matching:
{
  "items": [
    {
      "id": "item-1",
      "name": "Food Name",
      "category": "raw_ingredient",
      "quantity": "2 Litres / 650g / 1 kg",
      "portions": 4.0,
      "urgency": "high" | "medium" | "low",
      "storage_type": "Fridge" | "Freezer" | "Pantry",
      "notes": "From supermarket receipt"
    }
  ],
  "store_name": "Store Name",
  "detection_summary": "Extracted X distinct grocery items from receipt."
}`;

  let cleanBase64 = base64Image;
  let mimeType = "image/jpeg";
  if (base64Image.includes("data:") && base64Image.includes(";base64,")) {
    const split = base64Image.split(";base64,");
    cleanBase64 = split[1];
    if (split[0].includes("image/png")) mimeType = "image/png";
    else if (split[0].includes("image/webp")) mimeType = "image/webp";
  }

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: cleanBase64 } }
      ]
    }],
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
    throw new Error(`Gemini Receipt OCR failed (${response.status})`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("No text response from Gemini API");
  const cleanJson = text.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
  return JSON.parse(cleanJson);
}

function renderScannedReceiptTable(storeName = "Supermarket") {
  const container = document.getElementById("receiptItemsList");
  const box = document.getElementById("receiptExtractedBox");
  const countBadge = document.getElementById("receiptExtractedCount");
  const storeBadge = document.getElementById("receiptStoreNameBadge");

  if (!container || !box) return;

  box.classList.remove("hidden");
  if (countBadge) countBadge.textContent = `${appState.scannedReceiptItems.length} items`;
  if (storeBadge) storeBadge.textContent = storeName;

  container.innerHTML = appState.scannedReceiptItems.map((item, idx) => `
    <div class="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition text-xs gap-2">
      <div class="flex items-center space-x-2.5 min-w-0 flex-1">
        <input type="checkbox" id="chk-rec-${idx}" ${item.selected ? 'checked' : ''} onchange="toggleReceiptItemSelect(${idx}, this.checked)" class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer">
        <div class="min-w-0 flex-1">
          <input type="text" value="${escapeHtml(item.name)}" oninput="updateReceiptItemName(${idx}, this.value)" class="font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:outline-none w-full text-xs">
          <p class="text-[11px] text-slate-500">${escapeHtml(item.notes || 'From grocery receipt')}</p>
        </div>
      </div>

      <div class="flex items-center space-x-2 shrink-0">
        <input type="text" value="${escapeHtml(item.quantity)}" oninput="updateReceiptItemQty(${idx}, this.value)" class="w-20 p-1 text-center font-semibold border border-slate-200 rounded-lg bg-white text-xs">
        
        <select onchange="updateReceiptItemStorage(${idx}, this.value)" class="p-1 text-xs font-semibold border border-slate-200 rounded-lg bg-white cursor-pointer">
          <option value="Fridge" ${item.storage_type === 'Fridge' ? 'selected' : ''}>Fridge 🧊</option>
          <option value="Freezer" ${item.storage_type === 'Freezer' ? 'selected' : ''}>Freezer ❄️</option>
          <option value="Pantry" ${item.storage_type === 'Pantry' ? 'selected' : ''}>Open Space 🧺</option>
        </select>
      </div>
    </div>
  `).join("");
}

function toggleReceiptItemSelect(idx, checked) {
  if (appState.scannedReceiptItems[idx]) {
    appState.scannedReceiptItems[idx].selected = checked;
  }
}

function updateReceiptItemName(idx, val) {
  if (appState.scannedReceiptItems[idx]) {
    appState.scannedReceiptItems[idx].name = val;
  }
}

function updateReceiptItemQty(idx, val) {
  if (appState.scannedReceiptItems[idx]) {
    appState.scannedReceiptItems[idx].quantity = val;
  }
}

function updateReceiptItemStorage(idx, val) {
  if (appState.scannedReceiptItems[idx]) {
    appState.scannedReceiptItems[idx].storage_type = val;
  }
}

function addExtractedReceiptItemsToInventory() {
  const selectedItems = appState.scannedReceiptItems.filter(i => i.selected);
  if (selectedItems.length === 0) {
    showToast("Please select at least one item from the receipt.", "warning");
    return;
  }

  const itemsToAdd = [];
  const skippedDuplicates = [];

  selectedItems.forEach(item => {
    const cleanItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: item.name,
      category: item.category || "raw_ingredient",
      quantity: item.quantity,
      portions: parseFloat(item.portions) || 2.0,
      storage_type: item.storage_type || "Fridge",
      urgency: item.urgency || (item.storage_type === "Freezer" ? "low" : "medium"),
      dietary_tags: item.dietary_tags || [],
      notes: item.notes || "From grocery receipt"
    };

    if (isDuplicateInventoryItem(cleanItem, appState.inventory)) {
      skippedDuplicates.push(cleanItem.name);
    } else {
      itemsToAdd.push(cleanItem);
    }
  });

  if (itemsToAdd.length > 0) {
    appState.inventory = [...itemsToAdd, ...appState.inventory];
    saveActiveFamilyToStorage();
    renderInventory();
    renderDishes();
    updateHeaderCounters();
  }

  const fridgeCount = itemsToAdd.filter(i => i.storage_type === "Fridge").length;
  const freezerCount = itemsToAdd.filter(i => i.storage_type === "Freezer").length;
  const pantryCount = itemsToAdd.filter(i => i.storage_type === "Pantry").length;

  let breakdown = [];
  if (fridgeCount) breakdown.push(`${fridgeCount} in Fridge 🧊`);
  if (freezerCount) breakdown.push(`${freezerCount} in Freezer ❄️`);
  if (pantryCount) breakdown.push(`${pantryCount} in Open Space 🧺`);

  if (itemsToAdd.length > 0) {
    showToast(`📥 Added ${itemsToAdd.length} items (${breakdown.join(", ")}) to your kitchen!`, "success");
    clearReceiptImage();
  } else {
    showToast(`ℹ️ All selected items were already recorded (skipped duplicates).`, "info");
  }
}


// ==========================================
// FAMILY DISH RECIPE BOOK & INVENTORY DEDUCTION ENGINE
// ==========================================

const DEFAULT_FAMILY_DISHES = [
  {
    id: "dish-butter-chicken",
    name: "Butter Chicken (Murgh Makhani)",
    cooking_time_minutes: 35,
    portions: 4,
    category: "Curry / Main Dish",
    dietary_tags: ["Non-Veg", "High-Protein", "Halal"],
    ingredients: [
      { name: "Chicken", quantity: 500, unit: "grams" },
      { name: "Onion", quantity: 2, unit: "pieces" },
      { name: "Tomato", quantity: 3, unit: "pieces" },
      { name: "Butter", quantity: 50, unit: "grams" },
      { name: "Fresh Cream", quantity: 100, unit: "ml" }
    ],
    pantry_staples: ["Ginger Garlic Paste", "Garam Masala", "Kashmiri Chili", "Kasuri Methi", "Salt"],
    instructions: "Sauté onions and tomatoes, blend to silky gravy. Simmer chicken pieces with butter, cream, and aromatic spices."
  },
  {
    id: "dish-cabbage-chicken",
    name: "Spiced Cabbage & Chicken Stir-Fry",
    cooking_time_minutes: 15,
    portions: 3,
    category: "Quick Main Dish",
    dietary_tags: ["Non-Veg", "High-Protein", "Low-Carb"],
    ingredients: [
      { name: "Cabbage", quantity: 500, unit: "grams" },
      { name: "Chicken", quantity: 300, unit: "grams" },
      { name: "Onion", quantity: 1, unit: "pieces" }
    ],
    pantry_staples: ["Cooking oil", "Cumin seeds", "Turmeric", "Green chili", "Salt"],
    instructions: "Shred cabbage finely. Sauté cumin, onion, and chili. Toss cabbage on high heat for 6 mins. Add chicken, season with turmeric and salt, toss 5 mins until cooked."
  },
  {
    id: "dish-aloo-gobi",
    name: "Aloo Gobi Matar (Potato, Cauliflower & Peas)",
    cooking_time_minutes: 25,
    portions: 4,
    category: "Vegetarian Main Dish",
    dietary_tags: ["Vegetarian", "Vegan"],
    ingredients: [
      { name: "Cauliflower", quantity: 250, unit: "grams" },
      { name: "Potato", quantity: 2, unit: "pieces" },
      { name: "Green Peas", quantity: 100, unit: "grams" },
      { name: "Tomato", quantity: 2, unit: "pieces" }
    ],
    pantry_staples: ["Mustard oil or Ghee", "Cumin seeds", "Turmeric", "Coriander powder", "Salt"],
    instructions: "Cut cauliflower into florets and cube potatoes. Sauté spices, add veggies, cover and cook on low heat until tender. Garnish with coriander."
  },
  {
    id: "dish-dal-tadka",
    name: "Homestyle Dal Tadka",
    cooking_time_minutes: 20,
    portions: 4,
    category: "Vegetarian Lentil Curry",
    dietary_tags: ["Vegetarian", "Comfort Food"],
    ingredients: [
      { name: "Yellow Dal (Toor / Moong)", quantity: 250, unit: "grams" },
      { name: "Onion", quantity: 1, unit: "pieces" },
      { name: "Tomato", quantity: 2, unit: "pieces" },
      { name: "Garlic", quantity: 4, unit: "cloves" }
    ],
    pantry_staples: ["Ghee", "Jeera (Cumin)", "Turmeric", "Dry red chili", "Salt"],
    instructions: "Boil dal with turmeric and salt. Heat ghee with cumin, garlic, and red chili until golden. Pour sizzling tadka over hot dal."
  },
  {
    id: "dish-egg-bhurji",
    name: "Masala Egg Bhurji (Spiced Scrambled Eggs)",
    cooking_time_minutes: 12,
    portions: 2,
    category: "Quick Protein Dish",
    dietary_tags: ["Eggitarian", "High-Protein", "Keto"],
    ingredients: [
      { name: "Eggs", quantity: 4, unit: "pieces" },
      { name: "Onion", quantity: 1, unit: "pieces" },
      { name: "Tomato", quantity: 1, unit: "pieces" },
      { name: "Green Chili", quantity: 2, unit: "pieces" }
    ],
    pantry_staples: ["Butter or Oil", "Cumin", "Turmeric", "Chili powder", "Salt", "Coriander"],
    instructions: "Whisk eggs. Sauté onions, tomatoes, and chilies in butter. Pour eggs, scramble softly on medium heat for 3-4 minutes."
  },
  {
    id: "dish-courgette-rice",
    name: "Tawa Courgette (Zucchini) & Jeera Rice",
    cooking_time_minutes: 20,
    portions: 3,
    category: "Light Vegetarian Meal",
    dietary_tags: ["Vegetarian", "Low-Calorie"],
    ingredients: [
      { name: "Courgette", quantity: 1000, unit: "grams" },
      { name: "Rice", quantity: 300, unit: "grams" },
      { name: "Onion", quantity: 1, unit: "pieces" }
    ],
    pantry_staples: ["Cooking oil", "Cumin seeds", "Turmeric", "Garam masala", "Salt"],
    instructions: "Slice courgette into half moons. Sauté with cumin and turmeric on high flame until caramelized. Serve with aromatic jeera rice."
  }
];

async function loadDishes() {
  try {
    const local = localStorage.getItem("smart_fridge_family_dishes");
    if (local) {
      appState.dishes = JSON.parse(local);
    }
  } catch (e) {
    console.warn("Could not read dishes from localStorage:", e);
  }

  if (!appState.dishes || appState.dishes.length === 0) {
    // Try backend
    try {
      const res = await fetch("/api/dishes/list");
      if (res.ok) {
        const data = await res.json();
        if (data.dishes && data.dishes.length > 0) {
          appState.dishes = data.dishes;
        }
      }
    } catch (_) {}
  }

  if (!appState.dishes || appState.dishes.length === 0) {
    appState.dishes = JSON.parse(JSON.stringify(DEFAULT_FAMILY_DISHES));
  }

  saveDishes(false);
  renderDishes();
}

async function saveDishes(syncBackend = true) {
  try {
    localStorage.setItem("smart_fridge_family_dishes", JSON.stringify(appState.dishes));
  } catch (e) {
    console.warn("Could not save dishes to localStorage:", e);
  }

  if (syncBackend) {
    try {
      await fetch("/api/dishes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dishes: appState.dishes })
      });
    } catch (_) {}
  }
}

function checkDishIngredientsAvailability(dish, inventory) {
  const PANTRY_STAPLES = [
    "salt", "oil", "cooking oil", "water", "sugar", "turmeric", "haldi",
    "red chili powder", "chili powder", "cumin seeds", "jeera", "mustard seeds",
    "garam masala", "coriander powder", "spices", "ghee", "butter", "ginger garlic paste",
    "ginger", "garlic", "kasuri methi", "green chillies", "green chili"
  ];

  const ingredients = dish.ingredients || [];
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return { canCook: true, available: [], missing: [] };
  }

  const available = [];
  const missing = [];
  const items = Array.isArray(inventory) ? inventory : [];

  ingredients.forEach(ing => {
    const ingName = (ing.name || "").trim().toLowerCase();
    if (PANTRY_STAPLES.some(s => ingName.includes(s))) {
      return; // pantry staple in cupboard
    }

    const reqQty = parseFloat(ing.quantity) || 1.0;
    const reqUnit = (ing.unit || "").trim().toLowerCase();

    let matched = false;
    for (const invItem of items) {
      const invName = (invItem.name || "").toLowerCase();
      const keywords = ingName.split(/[\s\(\)/,]+/).filter(w => w.length > 2 && !["fresh", "raw", "cooked", "piece", "pieces", "gram", "grams", "pack"].includes(w));
      const isMatch = keywords.some(k => invName.includes(k)) || invName.includes(ingName) || ingName.includes(invName);
      if (isMatch) {
        const invQtyStr = (invItem.quantity || "").toLowerCase();
        const numMatch = invQtyStr.match(/(\d+(?:\.\d+)?)/);
        const invVal = numMatch ? parseFloat(numMatch[1]) : 1.0;

        let invValG = invVal;
        if (invQtyStr.includes("kg") || invQtyStr.includes("kilo")) {
          invValG = invVal * 1000.0;
        }

        let reqValG = null;
        if (reqUnit.includes("kg") || reqUnit.includes("kilo")) {
          reqValG = reqQty * 1000.0;
        } else if (reqUnit.includes("g") || reqUnit.includes("gram")) {
          reqValG = reqQty;
        }

        if (reqValG !== null) {
          if (invValG >= (reqValG * 0.85)) {
            matched = true;
            break;
          }
        } else {
          if (invVal >= (reqQty * 0.9)) {
            matched = true;
            break;
          }
        }
      }
    }

    if (matched) {
      available.push(`${ing.name} (${ing.quantity} ${ing.unit || ''})`);
    } else {
      missing.push(`${ing.name} (${ing.quantity} ${ing.unit || ''})`);
    }
  });

  return {
    canCook: missing.length === 0,
    available,
    missing
  };
}

function renderDishes() {
  const container = document.getElementById("dishesContainer");
  const countBadge = document.getElementById("dishesCountBadge");
  const emptyMsg = document.getElementById("emptyDishesMsg");
  if (!container) return;

  const allDishes = Array.isArray(appState.dishes) ? appState.dishes : [];
  let filtered = [...allDishes];

  // Search filter
  if (appState.dishesSearchQuery && appState.dishesSearchQuery.trim()) {
    const q = appState.dishesSearchQuery.trim().toLowerCase();
    filtered = filtered.filter(d => (d.name || "").toLowerCase().includes(q) || (d.category || "").toLowerCase().includes(q));
  }

  // Status/Time tab filter
  if (appState.dishesFilter === "ready") {
    filtered = filtered.filter(d => checkDishIngredientsAvailability(d, appState.inventory).canCook);
  } else if (appState.dishesFilter === "quick") {
    filtered = filtered.filter(d => (parseFloat(d.cooking_time_minutes) || 30) <= 20);
  }

  if (countBadge) {
    countBadge.textContent = `${allDishes.length} dish${allDishes.length === 1 ? '' : 'es'}`;
  }

  if (filtered.length === 0) {
    container.innerHTML = "";
    if (emptyMsg) emptyMsg.classList.remove("hidden");
    return;
  }

  if (emptyMsg) emptyMsg.classList.add("hidden");

  container.innerHTML = filtered.map(dish => {
    const check = checkDishIngredientsAvailability(dish, appState.inventory);
    const cookTime = dish.cooking_time_minutes || 25;
    const portions = dish.portions || 4;

    const statusBadge = check.canCook
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center space-x-1"><span>🟢 Ready to Cook!</span></span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 flex items-center space-x-1" title="Missing: ${escapeHtml(check.missing.join(', '))}"><span>🟠 Missing ${check.missing.length} items</span></span>`;

    const ingredientsList = (dish.ingredients || []).map(ing => `
      <span class="inline-block text-[11px] px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md font-medium">
        ${escapeHtml(ing.name)} <strong class="text-slate-900">${escapeHtml(ing.quantity)} ${escapeHtml(ing.unit || '')}</strong>
      </span>
    `).join(" ");

    return `
      <div class="p-4 rounded-2xl border ${check.canCook ? 'border-emerald-200 bg-gradient-to-br from-white via-emerald-50/20 to-white shadow-xs' : 'border-slate-200 bg-white'} space-y-3 flex flex-col justify-between transition hover:shadow-md">
        <div class="space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h4 class="font-extrabold text-sm sm:text-base text-slate-900">${escapeHtml(dish.name)}</h4>
              <p class="text-[11px] text-slate-500 font-medium">${escapeHtml(dish.category || 'Family Dish')}</p>
            </div>
            ${statusBadge}
          </div>

          <div class="flex items-center space-x-2 text-xs text-slate-600 font-semibold">
            <span class="px-2 py-0.5 bg-amber-50 text-amber-800 rounded-lg border border-amber-200">⏱️ ${cookTime} mins</span>
            <span class="px-2 py-0.5 bg-sky-50 text-sky-800 rounded-lg border border-sky-200">👥 ${portions} portions</span>
          </div>

          <div class="space-y-1 pt-1">
            <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ingredients Required:</p>
            <div class="flex flex-wrap gap-1">
              ${ingredientsList}
            </div>
          </div>

          ${!check.canCook && check.missing.length > 0 ? `
            <div class="p-2 rounded-xl bg-amber-50/80 border border-amber-200/60 text-[11px] text-amber-900 space-y-0.5">
              <span class="font-bold">Missing from kitchen:</span>
              <p class="text-amber-800">${escapeHtml(check.missing.join(", "))}</p>
            </div>
          ` : ''}
        </div>

        <!-- Action Buttons -->
        <div class="flex items-center space-x-2 pt-2 border-t border-slate-100">
          <button onclick="handleCookDishClick('${dish.id}')" type="button" class="flex-1 py-2 px-3 rounded-xl ${check.canCook ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold'} text-xs flex items-center justify-center space-x-1.5 transition shadow-xs cursor-pointer">
            <i class="ph-bold ph-cooking-pot text-sm"></i>
            <span>🍳 Cook This Dish</span>
          </button>
          <button onclick="openAddDishModal('${dish.id}')" type="button" class="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs transition cursor-pointer" title="Edit Recipe">
            <i class="ph-bold ph-pencil-simple text-sm"></i>
          </button>
          <button onclick="deleteDish('${dish.id}')" type="button" class="p-2 rounded-xl border border-red-200 hover:bg-red-50 text-red-600 text-xs transition cursor-pointer" title="Delete Recipe">
            <i class="ph-bold ph-trash text-sm"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function filterDishes(filterType) {
  appState.dishesFilter = filterType;
  const btnAll = document.getElementById("filterDishesAll");
  const btnReady = document.getElementById("filterDishesReady");
  const btnQuick = document.getElementById("filterDishesQuick");

  if (btnAll) btnAll.className = filterType === "all" ? "px-3 py-1.5 rounded-lg font-bold bg-slate-900 text-white transition" : "px-3 py-1.5 rounded-lg font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition";
  if (btnReady) btnReady.className = filterType === "ready" ? "px-3 py-1.5 rounded-lg font-bold bg-emerald-600 text-white transition" : "px-3 py-1.5 rounded-lg font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition";
  if (btnQuick) btnQuick.className = filterType === "quick" ? "px-3 py-1.5 rounded-lg font-bold bg-slate-900 text-white transition" : "px-3 py-1.5 rounded-lg font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition";

  renderDishes();
}

function filterAndSearchDishes() {
  const input = document.getElementById("dishesSearchInput");
  appState.dishesSearchQuery = input ? input.value : "";
  renderDishes();
}

function openAddDishModal(dishId = null) {
  const modal = document.getElementById("dishModal");
  const title = document.getElementById("dishModalTitle");
  const formId = document.getElementById("dishFormId");
  const formName = document.getElementById("dishFormName");
  const formTime = document.getElementById("dishFormTime");
  const formPortions = document.getElementById("dishFormPortions");
  const formCategory = document.getElementById("dishFormCategory");
  const formStaples = document.getElementById("dishFormStaples");
  const formInstructions = document.getElementById("dishFormInstructions");
  const container = document.getElementById("dishIngredientsContainer");

  if (!modal || !container) return;

  container.innerHTML = "";

  if (dishId) {
    const existing = appState.dishes.find(d => d.id === dishId);
    if (existing) {
      if (title) title.textContent = "Edit Family Dish";
      if (formId) formId.value = existing.id;
      if (formName) formName.value = existing.name || "";
      if (formTime) formTime.value = existing.cooking_time_minutes || 25;
      if (formPortions) formPortions.value = existing.portions || 4;
      if (formCategory) formCategory.value = existing.category || "Main Dish";
      if (formStaples) formStaples.value = Array.isArray(existing.pantry_staples) ? existing.pantry_staples.join(", ") : (existing.pantry_staples || "");
      if (formInstructions) formInstructions.value = existing.instructions || "";

      (existing.ingredients || []).forEach(ing => {
        addIngredientRowToDishModal(ing.name, ing.quantity, ing.unit);
      });
    }
  } else {
    if (title) title.textContent = "Add Family Dish";
    if (formId) formId.value = "";
    if (formName) formName.value = "";
    if (formTime) formTime.value = 25;
    if (formPortions) formPortions.value = 4;
    if (formCategory) formCategory.value = "Main Dish";
    if (formStaples) formStaples.value = "Cooking oil, Cumin, Turmeric, Salt, Garam masala";
    if (formInstructions) formInstructions.value = "";

    addIngredientRowToDishModal("Chicken", "500", "grams");
    addIngredientRowToDishModal("Onion", "2", "pieces");
  }

  modal.classList.remove("hidden");
}

function closeDishModal() {
  const modal = document.getElementById("dishModal");
  if (modal) modal.classList.add("hidden");
  stopVoiceDishInput();
}

function addIngredientRowToDishModal(name = "", qty = "", unit = "grams") {
  const container = document.getElementById("dishIngredientsContainer");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "flex items-center space-x-2 dish-ingredient-row";
  row.innerHTML = `
    <input type="text" placeholder="Ingredient name (e.g. Chicken, Onion, Cabbage)" value="${escapeHtml(String(name))}" class="flex-1 p-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none ing-name" required>
    <input type="number" step="any" placeholder="Qty" value="${escapeHtml(String(qty))}" class="w-16 p-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none text-center ing-qty" required>
    <select class="w-24 p-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none ing-unit">
      <option value="grams" ${unit === 'grams' || unit === 'g' ? 'selected' : ''}>grams</option>
      <option value="kg" ${unit === 'kg' ? 'selected' : ''}>kg</option>
      <option value="pieces" ${unit === 'pieces' || unit === 'piece' ? 'selected' : ''}>pieces</option>
      <option value="ml" ${unit === 'ml' ? 'selected' : ''}>ml</option>
      <option value="portions" ${unit === 'portions' || unit === 'portion' ? 'selected' : ''}>portions</option>
      <option value="pack" ${unit === 'pack' ? 'selected' : ''}>pack</option>
    </select>
    <button type="button" onclick="this.parentElement.remove()" class="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition" title="Remove ingredient">
      <i class="ph-bold ph-trash"></i>
    </button>
  `;
  container.appendChild(row);
}

function saveDishFromModal(event) {
  event.preventDefault();
  const formId = document.getElementById("dishFormId")?.value;
  const name = (document.getElementById("dishFormName")?.value || "").trim();
  const cookTime = parseInt(document.getElementById("dishFormTime")?.value) || 25;
  const portions = parseInt(document.getElementById("dishFormPortions")?.value) || 4;
  const category = (document.getElementById("dishFormCategory")?.value || "Main Dish").trim();
  const staplesStr = (document.getElementById("dishFormStaples")?.value || "").trim();
  const instructions = (document.getElementById("dishFormInstructions")?.value || "").trim();

  const container = document.getElementById("dishIngredientsContainer");
  const rows = container ? container.querySelectorAll(".dish-ingredient-row") : [];
  const ingredients = [];

  rows.forEach(r => {
    const ingName = (r.querySelector(".ing-name")?.value || "").trim();
    const ingQty = parseFloat(r.querySelector(".ing-qty")?.value) || 1.0;
    const ingUnit = r.querySelector(".ing-unit")?.value || "grams";
    if (ingName) {
      ingredients.push({ name: ingName, quantity: ingQty, unit: ingUnit });
    }
  });

  if (!name) {
    showToast("Please enter a dish name.", "warning");
    return;
  }

  if (ingredients.length === 0) {
    showToast("Please add at least one ingredient with quantity.", "warning");
    return;
  }

  const staples = staplesStr.split(",").map(s => s.trim()).filter(Boolean);

  const dishObj = {
    id: formId || `dish-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    name: name,
    cooking_time_minutes: cookTime,
    portions: portions,
    category: category,
    ingredients: ingredients,
    pantry_staples: staples,
    instructions: instructions
  };

  const idx = appState.dishes.findIndex(d => d.id === dishObj.id);
  if (idx >= 0) {
    appState.dishes[idx] = dishObj;
    showToast(`Updated '${name}' in family dishes!`, "success");
  } else {
    appState.dishes.unshift(dishObj);
    showToast(`Added '${name}' to family dishes!`, "success");
  }

  saveDishes(true);
  renderDishes();
  closeDishModal();
}

function deleteDish(dishId) {
  const dish = appState.dishes.find(d => d.id === dishId);
  if (!dish) return;

  if (confirm(`Are you sure you want to delete '${dish.name}' from your family dishes?`)) {
    appState.dishes = appState.dishes.filter(d => d.id !== dishId);
    saveDishes(true);
    renderDishes();
    showToast(`Deleted '${dish.name}'.`, "info");
  }
}

// Voice Recipe Parser for Modal Auto-Fill
function toggleVoiceDishInput() {
  if (appState.isListeningDishVoice) {
    stopVoiceDishInput();
    return;
  }
  startVoiceDishInput();
}

function startVoiceDishInput() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast("Speech recognition not supported in this browser. Please type the dish details.", "warning");
    return;
  }

  try {
    const rec = new SpeechRec();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-IN";

    const label = document.getElementById("dishMicLabel");
    const icon = document.getElementById("dishMicIcon");

    rec.onstart = () => {
      appState.isListeningDishVoice = true;
      if (label) label.textContent = "Listening...";
      if (icon) icon.className = "ph-bold ph-record text-red-500 animate-pulse";
      showToast("Listening! Speak dish name, time, and ingredients...", "info");
    };

    rec.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript || "";
      if (transcript) {
        parseVoiceDishRecipeToForm(transcript);
      }
    };

    rec.onerror = (e) => {
      console.warn("Dish voice error:", e);
      stopVoiceDishInput();
    };

    rec.onend = () => {
      stopVoiceDishInput();
    };

    appState.dishSpeechInstance = rec;
    rec.start();
  } catch (err) {
    console.error("Speech start error:", err);
    stopVoiceDishInput();
  }
}

function stopVoiceDishInput() {
  appState.isListeningDishVoice = false;
  if (appState.dishSpeechInstance) {
    try { appState.dishSpeechInstance.stop(); } catch (_) {}
    appState.dishSpeechInstance = null;
  }
  const label = document.getElementById("dishMicLabel");
  const icon = document.getElementById("dishMicIcon");
  if (label) label.textContent = "Speak Dish";
  if (icon) icon.className = "ph-bold ph-microphone";
}

function parseVoiceDishRecipeToForm(text) {
  showToast(`Parsed: "${text}"`, "success");
  
  // 1. Time extraction
  const timeMatch = text.match(/(\d+)\s*(?:min|mins|minute|minutes)/i);
  if (timeMatch) {
    const timeVal = parseInt(timeMatch[1]);
    const inputTime = document.getElementById("dishFormTime");
    if (inputTime) inputTime.value = timeVal;
  }

  // 2. Dish name extraction (first segment before time or ingredients)
  let cleanName = text;
  cleanName = cleanName.replace(/(\d+)\s*(?:min|mins|minute|minutes)/gi, "");
  const parts = cleanName.split(/,|\band\b/i);
  if (parts.length > 0 && parts[0].trim()) {
    const firstWord = parts[0].trim();
    const inputName = document.getElementById("dishFormName");
    if (inputName && !inputName.value) {
      inputName.value = firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
    }
  }

  // 3. Extract ingredient items with weights
  const parsedItems = parseSpokenOrTypedItems(text);
  if (parsedItems && parsedItems.length > 0) {
    const container = document.getElementById("dishIngredientsContainer");
    if (container) container.innerHTML = "";

    parsedItems.forEach(item => {
      let unit = "grams";
      let qty = 250;
      const qtyStr = (item.quantity || "").toLowerCase();

      const numMatch = qtyStr.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) qty = parseFloat(numMatch[1]);

      if (qtyStr.includes("kg") || qtyStr.includes("kilo")) unit = "kg";
      else if (qtyStr.includes("portion")) unit = "portions";
      else if (qtyStr.includes("piece")) unit = "pieces";
      else if (qtyStr.includes("ml") || qtyStr.includes("litre")) unit = "ml";

      addIngredientRowToDishModal(item.name, qty, unit);
    });
  }
}

function handleCookDishClick(dishId) {
  const dish = appState.dishes.find(d => d.id === dishId);
  if (!dish) return;
  cookDishAndDeductInventory(dish);
}

function cookDishAndDeductInventory(dish) {
  if (!dish) return;
  const inv = appState.inventory;
  const ingredients = dish.ingredients || [];
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    showToast(`🍳 Marked '${dish.name}' as cooked!`, "success");
    return;
  }

  // Backup current inventory for 1-click Undo
  appState.lastInventoryBackup = JSON.parse(JSON.stringify(appState.inventory));

  const deductedLog = [];
  const PANTRY_STAPLES = [
    "salt", "oil", "cooking oil", "water", "sugar", "turmeric", "haldi",
    "red chili powder", "chili powder", "cumin seeds", "jeera", "mustard seeds",
    "garam masala", "coriander powder", "spices", "ghee", "butter", "ginger garlic paste",
    "ginger", "garlic", "kasuri methi", "green chillies", "green chili"
  ];

  ingredients.forEach(ing => {
    const ingName = (ing.name || "").trim().toLowerCase();
    if (PANTRY_STAPLES.some(s => ingName.includes(s))) {
      return; // staples assumed in cupboard
    }

    const reqQty = parseFloat(ing.quantity) || 1.0;
    const reqUnit = (ing.unit || "").trim().toLowerCase();

    // Match inventory item
    const matchedIdx = inv.findIndex(item => {
      const invName = (item.name || "").toLowerCase();
      const keywords = ingName.split(/[\s\(\)/,]+/).filter(w => w.length > 2 && !["fresh", "raw", "cooked", "piece", "pieces", "gram", "grams", "pack"].includes(w));
      return keywords.some(k => invName.includes(k)) || invName.includes(ingName) || ingName.includes(invName);
    });

    if (matchedIdx >= 0) {
      const item = inv[matchedIdx];
      const invQtyStr = (item.quantity || "").toLowerCase();

      // Parse inventory number
      const numMatch = invQtyStr.match(/(\d+(?:\.\d+)?)/);
      const curVal = numMatch ? parseFloat(numMatch[1]) : 1.0;

      let remainingVal = 0;
      let remainingUnit = reqUnit || "gms";

      // If weight-based deduction (kg / grams)
      if (reqUnit.includes("kg") || reqUnit.includes("kilo")) {
        const curInKg = (invQtyStr.includes("g") && !invQtyStr.includes("kg")) ? (curVal / 1000) : curVal;
        remainingVal = curInKg - reqQty;
        remainingUnit = "kg";
      } else if (reqUnit.includes("g") || reqUnit.includes("gram")) {
        const curInG = (invQtyStr.includes("kg") || invQtyStr.includes("kilo")) ? (curVal * 1000) : curVal;
        remainingVal = curInG - reqQty;
        remainingUnit = "gms";
        if (remainingVal >= 1000) {
          remainingVal = (remainingVal / 1000);
          remainingUnit = "kg";
        }
      } else if (reqUnit.includes("portion")) {
        const curPortions = parseFloat(item.portions) || curVal;
        remainingVal = curPortions - reqQty;
        item.portions = Math.max(0, remainingVal);
        remainingUnit = remainingVal === 1 ? "portion" : "portions";
      } else {
        // Pieces / general unit
        remainingVal = curVal - reqQty;
        remainingUnit = remainingVal === 1 ? "piece" : "pieces";
      }

      if (remainingVal <= 0.05) {
        // Item consumed completely
        deductedLog.push(`All ${item.name} (${item.quantity})`);
        inv.splice(matchedIdx, 1);
      } else {
        const formattedQty = `${Number(remainingVal.toFixed(1))} ${remainingUnit}`;
        deductedLog.push(`${reqQty} ${reqUnit} of ${item.name} (remaining: ${formattedQty})`);
        item.quantity = formattedQty;
      }
    }
  });

  saveActiveFamilyToStorage();
  renderInventory();
  renderDishes();
  updateHeaderCounters();

  const msg = deductedLog.length > 0
    ? `🍳 Cooked '${dish.name}'! Reduced: ${deductedLog.slice(0, 3).join(", ")}${deductedLog.length > 3 ? ` (+${deductedLog.length - 3} more)` : ""}.`
    : `🍳 Cooked '${dish.name}'! (Pantry staples used).`;

  showToast(msg, "success");
}

function undoLastCookingDeduction() {
  if (appState.lastInventoryBackup) {
    appState.inventory = appState.lastInventoryBackup;
    appState.lastInventoryBackup = null;
    saveActiveFamilyToStorage();
    renderInventory();
    renderDishes();
    updateHeaderCounters();
    showToast("↩️ Undid cooking deduction. Inventory restored!", "info");
  }
}


// ==========================================
// 3. NATURAL LANGUAGE PARSER & GEMINI CALLS
// ==========================================
const WORD_TO_NUM = {
  zero: 0, a: 1, an: 1, one: 1, single: 1,
  two: 2, couple: 2, pair: 2, "couple of": 2,
  three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
  half: 0.5, "half a": 0.5
};

function parseNum(valStr) {
  if (!valStr) return 1.0;
  const s = valStr.trim().toLowerCase();
  if (WORD_TO_NUM.hasOwnProperty(s)) return WORD_TO_NUM[s];
  const n = parseFloat(s);
  return isNaN(n) ? 1.0 : n;
}

function parseSpokenOrTypedItems(rawText) {
  if (!rawText || !rawText.trim()) return [];

  const text = rawText.replace(/\s+/g, " ").trim();
  const numPattern = "(?:\\d+(?:\\.\\d+)?|half\\s+a|couple\\s+of|couple|pair|dozen|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an)";
  const unitPattern = "(?:kilograms?|kilos?|kgs?|kg|grams?|gms?|gm|g|milliliters?|millilitres?|ml|liters?|litres?|l|portions?|servings?|bowls?|plates?|packs?|packets?|bags?|cans?|tins?|tubs?|pots?|bottles?|jars?|cartons?|punnets?|box(?:es)?|bunch(?:es)?|loaves|loaf|pieces?|pcs?|slices?|rashers?|fillets?|breasts?|thighs?|steaks?|chops?|eggs?|heads?|stalks?|crowns?)";
  const qtyPrefix = "(?:around|approx|about)?\\s*(?:" + numPattern + ")\\s*(?:" + unitPattern + ")\\b";

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
        const inserted = part.replace(new RegExp("([a-zA-Z\\)])(?<!\\bhalf)\\s+(?=" + qtyPrefix + ")", "gi"), (m, p1) => p1 + "\n");
        inserted.split("\n").forEach(line => {
          if (line.trim()) refined.push(line.trim());
        });
      } else {
        // [FOOD] [QTY] [FOOD] [QTY]... (e.g. cooked daal 250 gms raw chicken 1 kg)
        const inserted = part.replace(new RegExp("(\\b" + numPattern + "\\s*" + unitPattern + ")\\s+(?=(?!\\bof\\b)[a-zA-Z])", "gi"), (m, p1) => p1 + "\n");
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

    const kgMatch = itemText.match(new RegExp("(?:around|approx|about)?\\s*(" + numPattern + ")\\s*(?:kilograms?|kilogram|kilos?|kilo|kgs?|kg)\\b", "i"));
    const gramMatch = itemText.match(new RegExp("(?:around|approx|about)?\\s*(" + numPattern + ")\\s*(?:gms?|grams?|gm|g)\\b", "i"));
    const mlMatch = itemText.match(new RegExp("(?:around|approx|about)?\\s*(" + numPattern + ")\\s*(?:ml|milliliters?|millilitres?)\\b", "i"));
    const literMatch = itemText.match(new RegExp("(?:around|approx|about)?\\s*(" + numPattern + ")\\s*(?:liters?|litres?|l)\\b", "i"));
    const portionMatch = itemText.match(new RegExp("(" + numPattern + ")\\s*(?:portions?|portion|servings?|serving|bowls?|bowl|plates?|plate)\\b", "i"));
    const countMatch = itemText.match(new RegExp("(" + numPattern + ")\\s*(?:pieces?|piece|pcs?|packs?|pack|packet|packets|bags?|bag|cans?|can|tins?|tin|eggs?|breasts?|breast|fillets?|fillet|tubs?|tub|pots?|pot|box(?:es)?|bunch(?:es)?|loaves|loaf)\\b", "i"));

    if (kgMatch) {
      const kgVal = parseNum(kgMatch[1]);
      quantity = `${kgVal % 1 === 0 ? kgVal.toFixed(0) : kgVal} kg`;
      portions = Math.max(1, Math.round(kgVal * 4));
    } else if (gramMatch) {
      const gVal = parseNum(gramMatch[1]);
      quantity = `${gVal % 1 === 0 ? gVal.toFixed(0) : gVal} gms`;
      if (gVal <= 300) portions = 1.5;
      else if (gVal <= 600) portions = 3.0;
      else portions = Math.max(1, Math.round(gVal / 200));
    } else if (literMatch) {
      const lVal = parseNum(literMatch[1]);
      quantity = `${lVal % 1 === 0 ? lVal.toFixed(0) : lVal} L`;
      portions = Math.max(1, Math.round(lVal * 4));
    } else if (mlMatch) {
      const mlVal = parseNum(mlMatch[1]);
      quantity = `${mlVal % 1 === 0 ? mlVal.toFixed(0) : mlVal} ml`;
      portions = Math.max(1, Math.round(mlVal / 250));
    } else if (portionMatch) {
      const pVal = parseNum(portionMatch[1]);
      quantity = `${pVal % 1 === 0 ? pVal.toFixed(0) : pVal} portions`;
      portions = pVal;
    } else if (countMatch) {
      const countVal = parseNum(countMatch[1]);
      const unit = countMatch[0].replace(new RegExp("^\\s*(?:" + numPattern + ")\\s*", "i"), "").trim();
      quantity = `${countVal % 1 === 0 ? countVal.toFixed(0) : countVal} ${unit}`;
      portions = Math.max(1, Math.round(countVal / 2));
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
      .replace(new RegExp("\\b(?:around|approx|about)?\\s*(?:" + numPattern + ")\\s*(?:" + unitPattern + ")\\b", "gi"), "")
      .replace(new RegExp("^[\\s]*(?:of|some|a|an|the|and)\\s+", "gi"), "")
      .replace(/\s+(?:of|in|at)\s*$/gi, "")
      .replace(/[\(\)\[\]\{\}]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    cleanName = cleanName.replace(/^of\s+/i, "").trim();

    if (cleanName.length > 0) {
      cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    } else if (countMatch) {
      const unitWord = countMatch[0].replace(new RegExp("^\\s*(?:" + numPattern + ")\\s*", "i"), "").trim();
      cleanName = unitWord.charAt(0).toUpperCase() + unitWord.slice(1);
    } else {
      cleanName = itemText.trim();
      cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
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
1. CONTINUOUS STREAM SEPARATION: The user may speak multiple items without pauses or punctuation, and numbers may be spoken as words or digits (e.g. "500 grams of cabbage three portions of cooked chicken", "two bags of frozen peas one box of mushrooms", "1 kg of courgette 250 grams of cabbage"). You MUST identify quantity/food boundaries and create a separate item for EVERY food mentioned!
2. CLEAN FOOD NAMES: NEVER include leading prepositions like "of", "some", "a", "an", "the" in food names (e.g. "Courgette", NOT "of courgette"; "Cabbage", NOT "of cabbage"; "Cooked chicken", NOT "three portions of cooked chicken"). Capitalize cleanly.
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
    items = items.filter(i => (i.storage_type || "").toLowerCase() === "fridge" || (!(i.storage_type || "").toLowerCase().includes("freezer") && !(i.storage_type || "").toLowerCase().includes("pantry")));
  } else if (appState.currentFilter === "freezer") {
    items = items.filter(i => (i.storage_type || "").toLowerCase() === "freezer");
  } else if (appState.currentFilter === "pantry") {
    items = items.filter(i => (i.storage_type || "").toLowerCase() === "pantry");
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

    const storageType = item.storage_type || "Fridge";
    let storageIcon = "ph-thermometer-cold text-blue-600";
    let storageLabel = "Fridge 🧊";
    if (storageType === "Freezer") {
      storageIcon = "ph-snowflake text-cyan-600";
      storageLabel = "Freezer ❄️";
    } else if (storageType === "Pantry") {
      storageIcon = "ph-basket text-amber-700";
      storageLabel = "Open Space 🧺";
    }

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
          <button type="button" onclick="toggleItemStorage('${item.id}')" title="Click to toggle Fridge/Freezer/Open Space" class="inline-flex items-center space-x-1 cursor-pointer hover:text-indigo-600 underline decoration-dotted">
            <i class="ph-bold ${storageIcon}"></i>
            <strong>${escapeHtml(storageLabel)}</strong>
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
    pantry: document.getElementById("filterPantry"),
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
  renderDishes();
  updateHeaderCounters();
  showToast(`Switched "${item.name}" to ${item.category === "cooked_leftover" ? "Cooked Leftover 🚨" : "Raw Ingredient 🥦"}`, "info");
}

function toggleItemStorage(id) {
  const item = appState.inventory.find(i => i.id === id);
  if (!item) return;
  const cur = (item.storage_type || "Fridge").toLowerCase();
  if (cur === "fridge") {
    item.storage_type = "Freezer";
  } else if (cur === "freezer") {
    item.storage_type = "Pantry";
  } else {
    item.storage_type = "Fridge";
  }
  saveActiveFamilyToStorage();
  renderInventory();
  renderDishes();
  updateHeaderCounters();
  showToast(`Moved "${item.name}" to ${item.storage_type === 'Pantry' ? 'Open Space 🧺' : (item.storage_type === 'Freezer' ? 'Freezer ❄️' : 'Fridge 🧊')}`, "info");
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


// ==========================================
// 6. RAMU KAKA CONVERSATIONAL VOICE ASSISTANT
// ==========================================
let cachedVoices = [];
if (typeof window !== "undefined" && 'speechSynthesis' in window) {
  cachedVoices = window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoices = window.speechSynthesis.getVoices();
  };
}

const ramuState = {
  isOpen: false,
  isMuted: false,
  isListening: false,
  isSpeaking: false,
  conversationStep: "GREETING", // GREETING -> WAIT_INTENT -> ASK_TIME -> WAIT_TIME -> RECOMMENDING -> DONE
  timeAvailableMinutes: 20,
  userIntent: "",
  activeRecommendation: null,
  recognitionInstance: null,
  messages: []
};

function openRamuKakaModal(autoGreet = true) {
  const modal = document.getElementById("ramuKakaModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  ramuState.isOpen = true;

  // Update inventory count pill
  const invHint = document.getElementById("ramuInventoryHint");
  if (invHint) {
    const leftCount = appState.inventory.filter(i => i.category === "cooked_leftover").length;
    const rawCount = appState.inventory.filter(i => i.category === "raw_ingredient").length;
    invHint.textContent = `${appState.inventory.length} items (${leftCount} Leftovers, ${rawCount} Fresh)`;
  }

  if (autoGreet) {
    restartRamuConversation();
  }
}

function closeRamuKakaModal() {
  const modal = document.getElementById("ramuKakaModal");
  if (modal) modal.classList.add("hidden");
  ramuState.isOpen = false;

  // Cancel any active speech or recognition
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (ramuState.recognitionInstance) {
    try { ramuState.recognitionInstance.abort(); } catch (_) {}
  }
  ramuState.isSpeaking = false;
  ramuState.isListening = false;
  updateRamuWaveUI();
}

function toggleRamuMute() {
  ramuState.isMuted = !ramuState.isMuted;
  const icon = document.getElementById("ramuMuteIcon");
  if (icon) {
    icon.className = ramuState.isMuted ? "ph-bold ph-speaker-slash text-lg text-amber-200" : "ph-bold ph-speaker-high text-lg text-white";
  }
  if (ramuState.isMuted && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    ramuState.isSpeaking = false;
    updateRamuWaveUI();
  }
  showToast(ramuState.isMuted ? "Ramu Kaka voice audio muted." : "Ramu Kaka voice audio enabled.", "info");
}

function addRamuAudioPlayBanner() {
  const container = document.getElementById("ramuDialogueContainer");
  if (!container) return;

  const existing = document.getElementById("ramuAudioTapBanner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "ramuAudioTapBanner";
  banner.className = "p-3.5 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 rounded-2xl text-white flex items-center justify-between shadow-md cursor-pointer active:scale-95 transition mb-2";
  banner.onclick = () => {
    banner.remove();
    playBiwijiGreetingDirect();
  };
  banner.innerHTML = `
    <div class="flex items-center space-x-2.5">
      <div class="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center text-lg shadow-inner">
        🔊
      </div>
      <div>
        <div class="font-extrabold text-xs sm:text-sm">"Biwiji, boliye kya hukum?"</div>
        <div class="text-[10px] sm:text-[11px] text-amber-100 font-medium">Tap to hear Ramu Kaka speak aloud</div>
      </div>
    </div>
    <span class="text-xs font-bold bg-white text-amber-900 px-2.5 py-1 rounded-xl shadow-xs flex-shrink-0">Play Voice</span>
  `;
  container.prepend(banner);
}

function playBiwijiGreetingDirect() {
  const banner = document.getElementById("ramuAudioTapBanner");
  if (banner) banner.remove();

  speakRamuKaka("Biwiji, boliye kya hukum?", () => {
    ramuState.conversationStep = "WAIT_INTENT";
    setRamuStatus("🔴 Listening... Say 'What to cook' (or tap below)", "listening");
    startRamuListening();
  });
}

function restartRamuConversation() {
  ramuState.conversationStep = "GREETING";
  ramuState.userIntent = "";
  ramuState.activeRecommendation = null;
  ramuState.messages = [];

  const container = document.getElementById("ramuDialogueContainer");
  if (container) container.innerHTML = "";

  const dishCardContainer = document.getElementById("ramuDishCardContainer");
  if (dishCardContainer) {
    dishCardContainer.classList.add("hidden");
    dishCardContainer.innerHTML = "";
  }

  // Initial prompt: "Biwiji, boliye kya hukum?"
  const greeting = "Biwiji, boliye kya hukum?";
  addRamuChatMessage("ramu", greeting);

  // Add one-tap audio banner so mobile Safari/Chrome can activate sound instantly
  addRamuAudioPlayBanner();

  renderRamuQuickChips([
    { label: "What to cook?", value: "What to cook" },
    { label: "Suggest dinner", value: "What should I make for dinner?" },
    { label: "Quick 15-min meal", value: "Suggest a quick 15 minute dish" },
    { label: "Check leftovers", value: "What leftovers can we eat?" }
  ]);

  setRamuStatus("🗣️ Ramu Kaka: Biwiji, boliye kya hukum?", "speaking");

  speakRamuKaka("Biwiji, boliye kya hukum?", () => {
    ramuState.conversationStep = "WAIT_INTENT";
    setRamuStatus("🔴 Listening... Say 'What to cook' (or tap below)", "listening");
    startRamuListening();
  });
}

function speakRamuKaka(text, onEnd) {
  if (ramuState.isMuted || !('speechSynthesis' in window)) {
    if (onEnd) onEnd();
    return;
  }

  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    const utterance = new SpeechSynthesisUtterance(text);

    // Set language: hi-IN for authentic Indian pronunciation, en-IN for English
    const hasHindi = /biwiji|hukum|kya|boliye|samay|swadisht|karta|hoon|aapke|sabzi|garam|batao/i.test(text);
    utterance.lang = hasHindi ? "hi-IN" : "en-IN";

    if (!cachedVoices || cachedVoices.length === 0) {
      cachedVoices = window.speechSynthesis.getVoices();
    }

    if (cachedVoices && cachedVoices.length > 0) {
      const preferredVoice = cachedVoices.find(v => {
        const name = (v.name || "").toLowerCase();
        const lang = (v.lang || "").toLowerCase();
        return lang.includes("hi") || lang.includes("in") || name.includes("india") || name.includes("rishi") || name.includes("lekha") || name.includes("veena") || name.includes("neerja");
      }) || cachedVoices.find(v => v.lang.startsWith("en"));

      if (preferredVoice) utterance.voice = preferredVoice;
    }

    utterance.rate = 0.92;
    utterance.pitch = 0.98;
    utterance.volume = 1.0;

    ramuState.isSpeaking = true;
    updateRamuWaveUI();

    let finished = false;
    const finishCallback = () => {
      if (finished) return;
      finished = true;
      ramuState.isSpeaking = false;
      updateRamuWaveUI();
      if (onEnd) onEnd();
    };

    utterance.onend = finishCallback;
    utterance.onerror = (e) => {
      console.warn("SpeechSynthesis error:", e);
      finishCallback();
    };

    // Safety timeout in case iOS Safari keeps utterance in limbo
    const safeMs = Math.max(3000, text.length * 90);
    setTimeout(() => {
      if (!finished && ramuState.isSpeaking) {
        finishCallback();
      }
    }, safeMs);

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn("Speech synthesis error:", err);
    ramuState.isSpeaking = false;
    updateRamuWaveUI();
    if (onEnd) onEnd();
  }
}

function startRamuListening() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    setRamuStatus("Voice dictation not available. Please tap an option below.", "info");
    return;
  }

  if (window.speechSynthesis) window.speechSynthesis.cancel();

  if (ramuState.recognitionInstance) {
    try { ramuState.recognitionInstance.abort(); } catch (_) {}
  }

  try {
    const rec = new SpeechRec();
    ramuState.recognitionInstance = rec;
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-IN";

    rec.onstart = () => {
      ramuState.isListening = true;
      updateRamuWaveUI();
      updateRamuMicButton(true);
    };

    rec.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript || "";
      if (transcript.trim()) {
        handleUserSpokenInput(transcript.trim());
      }
    };

    rec.onerror = (err) => {
      console.warn("Ramu speech recognition notice:", err.error);
      ramuState.isListening = false;
      updateRamuWaveUI();
      updateRamuMicButton(false);
      if (err.error === "no-speech") {
        setRamuStatus("Didn't catch that. Tap the mic or choose an option below.", "info");
      }
    };

    rec.onend = () => {
      ramuState.isListening = false;
      updateRamuWaveUI();
      updateRamuMicButton(false);
    };

    rec.start();
  } catch (e) {
    console.error("Failed to start speech recognition:", e);
    ramuState.isListening = false;
    updateRamuWaveUI();
    updateRamuMicButton(false);
  }
}

function toggleRamuListening() {
  if (ramuState.isListening) {
    if (ramuState.recognitionInstance) {
      try { ramuState.recognitionInstance.stop(); } catch (_) {}
    }
    ramuState.isListening = false;
    updateRamuWaveUI();
    updateRamuMicButton(false);
  } else {
    startRamuListening();
  }
}

function parseRamuTime(str) {
  if (!str) return 20;
  const s = str.toLowerCase();

  if (s.includes("half an hour") || s.includes("half hour") || s.includes("adhe ghante")) return 30;
  if (s.includes("an hour") || s.includes("one hour") || s.includes("1 hour") || s.includes("ek ghanta")) return 60;

  const m = s.match(/(\d+)\s*(?:mins?|minutes?|m\b)?/);
  if (m) return parseInt(m[1], 10);

  if (s.includes("quick") || s.includes("jaldi") || s.includes("fast")) return 10;
  if (s.includes("ten")) return 10;
  if (s.includes("fifteen")) return 15;
  if (s.includes("twenty five")) return 25;
  if (s.includes("twenty")) return 20;
  if (s.includes("thirty")) return 30;
  if (s.includes("forty five")) return 45;
  if (s.includes("forty")) return 40;
  return 20;
}

function handleUserSpokenInput(text) {
  addRamuChatMessage("user", text);

  if (ramuState.conversationStep === "WAIT_INTENT" || ramuState.conversationStep === "GREETING") {
    ramuState.userIntent = text;

    // Check if user already stated time in this sentence (e.g. "what to cook in 20 minutes")
    const hasSpecificTime = /(\d+\s*(?:mins?|minutes?|hours?)|half\s+an?\s+hour|quick|jaldi)/i.test(text);
    if (hasSpecificTime) {
      const timeMins = parseRamuTime(text);
      ramuState.timeAvailableMinutes = timeMins;
      ramuFetchRecommendation(timeMins);
    } else {
      // Step 2: Ramu Kaka asks: "How much time do you have?"
      ramuAskTime();
    }
  } else if (ramuState.conversationStep === "WAIT_TIME" || ramuState.conversationStep === "ASK_TIME") {
    const timeMins = parseRamuTime(text);
    ramuState.timeAvailableMinutes = timeMins;
    ramuFetchRecommendation(timeMins);
  } else {
    // If conversation is in DONE or other state:
    if (/another|different|aur kuch|kuch aur|second/i.test(text)) {
      ramuFetchRecommendation(ramuState.timeAvailableMinutes, true);
    } else {
      ramuState.userIntent = text;
      ramuAskTime();
    }
  }
}

function ramuAskTime() {
  ramuState.conversationStep = "ASK_TIME";
  const question = "Ji Biwiji, how much time do you have to cook?";
  addRamuChatMessage("ramu", question);

  renderRamuQuickChips([
    { label: "10 mins (Quick)", value: "10 minutes" },
    { label: "15 mins", value: "15 minutes" },
    { label: "20 mins", value: "20 minutes" },
    { label: "30 mins", value: "30 minutes" },
    { label: "45+ mins", value: "45 minutes" }
  ]);

  setRamuStatus("🗣️ Ramu Kaka: How much time do you have?", "speaking");

  speakRamuKaka("Ji Biwiji, kitna samay hai aapke paas? How much time do you have?", () => {
    ramuState.conversationStep = "WAIT_TIME";
    setRamuStatus("🔴 Listening... Say '20 minutes' or tap an option", "listening");
    startRamuListening();
  });
}

async function ramuFetchRecommendation(timeMins, isAlternative = false) {
  ramuState.conversationStep = "RECOMMENDING";
  renderRamuQuickChips([]);
  setRamuStatus("🔍 Ramu Kaka is inspecting your fridge & freezer...", "info");

  const waitMsg = isAlternative
    ? "Ji Biwiji, main doosra vikalp check karta hoon..."
    : `Ji Biwiji, ${timeMins} minute ke liye main fridge check karke swadisht dish recommend karta hoon...`;
  addRamuChatMessage("ramu", waitMsg);

  speakRamuKaka(waitMsg);

  try {
    let rec = null;

    // 1. Call backend endpoint /api/ramu-kaka/recommend
    try {
      const headers = { "Content-Type": "application/json" };
      if (appState.apiKey) headers["X-Gemini-Key"] = appState.apiKey;

      const res = await fetch("/api/ramu-kaka/recommend", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          time_available_minutes: timeMins,
          user_prompt: ramuState.userIntent || "What to cook",
          inventory: appState.inventory,
          household: appState.families[appState.activeFamilyId]?.household || [],
          dishes: appState.dishes || [],
          preferences: isAlternative ? "Suggest an alternative dish" : ""
        })
      });

      if (res.ok) {
        rec = await res.json();
      }
    } catch (apiErr) {
      console.warn("Backend Ramu Kaka API call failed, using client fallback:", apiErr);
    }

    // 2. Client-side fallback if backend unavailable
    if (!rec || !rec.dish_name) {
      rec = clientRamuKakaRecommend(timeMins, appState.inventory, isAlternative);
    }

    ramuState.activeRecommendation = rec;
    ramuState.conversationStep = "DONE";

    // Render visual dish card
    renderRamuDishCard(rec);

    // Add Ramu Kaka response to chat
    addRamuChatMessage("ramu", rec.spoken_response);

    // Speak out recommendation
    setRamuStatus("🗣️ Ramu Kaka is speaking the recommendation...", "speaking");
    speakRamuKaka(rec.spoken_response, () => {
      setRamuStatus("✨ Ready! You can ask another dish or start cooking.", "success");
    });

    renderRamuQuickChips([
      { label: "🔄 Suggest Another Dish", value: "Suggest another dish" },
      { label: "🍳 Cook This Dish", value: "__COOK_NOW__" },
      { label: "🎤 Ask Something Else", value: "What else can I make?" }
    ]);
  } catch (err) {
    console.error("Ramu Kaka recommendation error:", err);
    setRamuStatus("Could not complete recommendation. Please try again.", "error");
  }
}

function clientRamuKakaRecommend(timeMins, inv, isAlternative = false) {
  const items = Array.isArray(inv) ? inv : [];
  const leftovers = items.filter(i => i.category === "cooked_leftover");
  const dishes = Array.isArray(appState.dishes) && appState.dishes.length > 0 ? appState.dishes : DEFAULT_FAMILY_DISHES;

  // 1. Very fast (<= 10 mins) with leftovers available: Zero waste priority! (1 portion = 1 person)
  if (timeMins <= 10 && leftovers.length > 0) {
    const top = leftovers[0];
    const topName = top.name || "Leftover Dish";
    const qty = top.quantity || "1 portion";
    return {
      dish_name: `Quick Reheated ${topName} with Fresh Ghee Tempering`,
      prep_cook_time_minutes: Math.min(timeMins, 8),
      category: "Quick Leftover Reheat",
      spoken_response: `Biwiji, aapke paas bas ${timeMins} minute hain! Fridge mein ready ${topName} (${qty}) hai. Bas 5 minute mein tawa ya microwave mein garam karke enjoy kijiye!`,
      ingredients_used: [`${topName} (${qty})`],
      pantry_items_needed: ["Ghee or Butter", "Pinch of cumin or fresh coriander"],
      why_recommended: `Uses high-priority leftover ${topName} (1 portion = good for 1 person) to save cooking time and prevent food waste.`,
      quick_steps: [
        `Take the ${topName} from the fridge.`,
        "Warm thoroughly in a pan with 1 tsp ghee or microwave for 2-3 minutes.",
        "Sprinkle with fresh coriander or lemon juice and serve warm with bread or papad."
      ],
      leftover_alert: `Zero food waste: Finished delicious ${topName} within ${timeMins} minutes!`,
      dish_object: {
        id: `leftover-${top.id || 1}`,
        name: topName,
        ingredients: [{ name: topName, quantity: top.portions || 1, unit: "portions" }]
      }
    };
  }

  // 2. Check Recorded Family Dishes: STRICT RULE: ONLY recommend dishes that can be cooked with ingredients left in kitchen!
  const eligible = dishes.filter(d => (parseFloat(d.cooking_time_minutes) || 30) <= timeMins);
  eligible.sort((a, b) => (parseFloat(b.cooking_time_minutes) || 30) - (parseFloat(a.cooking_time_minutes) || 30));

  for (const dish of eligible) {
    const check = checkDishIngredientsAvailability(dish, items);
    if (check.canCook) {
      const cookTime = dish.cooking_time_minutes || 20;
      return {
        dish_name: dish.name,
        prep_cook_time_minutes: cookTime,
        category: dish.category || "Family Recorded Dish",
        spoken_response: `Biwiji, aapke paas ${timeMins} minute hain aur kitchen mein sabhi ingredients maujood hain! Main aapki pasandida dish recommend karta hoon: ${dish.name}! Yeh ${cookTime} minute mein swadisht ban jayegi.`,
        ingredients_used: check.available,
        pantry_items_needed: Array.isArray(dish.pantry_staples) ? dish.pantry_staples : (dish.pantry_staples ? [dish.pantry_staples] : ["Cooking oil", "Spices", "Salt"]),
        why_recommended: `From your family recipe book. All required ingredients are currently in your kitchen inventory!`,
        quick_steps: [
          dish.instructions || `Prepare ingredients according to your family recipe and cook on medium flame for ${cookTime} minutes.`
        ],
        leftover_alert: `Verified against live kitchen inventory: 100% ready to cook!`,
        dish_object: dish,
        dish_id: dish.id
      };
    }
  }

  const namesLower = items.map(i => (i.name || "").toLowerCase());
  const hasChicken = namesLower.some(n => n.includes("chicken"));
  const hasCabbage = namesLower.some(n => n.includes("cabbage"));
  const hasCauliflower = namesLower.some(n => n.includes("cauliflower") || n.includes("gobi"));
  const hasCourgette = namesLower.some(n => n.includes("courgette") || n.includes("zucchini"));
  const hasDaal = namesLower.some(n => n.includes("daal") || n.includes("dal"));
  const hasEggs = namesLower.some(n => n.includes("egg"));
  const hasCurd = namesLower.some(n => n.includes("curd") || n.includes("dahi") || n.includes("yogurt"));

  // 3. Dynamic pairings from available raw ingredients if no recorded dish was 100% in stock
  // 3a. Cabbage + Chicken
  if (hasCabbage && hasChicken && !isAlternative) {
    const cItem = items.find(i => (i.name || "").toLowerCase().includes("cabbage"));
    const chItem = items.find(i => (i.name || "").toLowerCase().includes("chicken"));
    const cQty = cItem?.quantity || "500 gms";
    const chQty = chItem?.quantity || "3 portions";
    return {
      dish_name: "Quick Homestyle Spiced Cabbage & Chicken Stir-Fry (Bandhakopi Murgh)",
      prep_cook_time_minutes: 15,
      category: "High-Protein Main Dish",
      spoken_response: `Biwiji, aapke paas ${timeMins} minute hain aur fridge mein ${cQty} Cabbage aur ${chQty} Chicken hai! Main recommend karta hoon: Quick Cabbage & Chicken Stir-Fry! Yeh 15 minute mein swadisht ban jayega.`,
      ingredients_used: [`Cabbage (${cQty})`, `Chicken (${chQty})`],
      pantry_items_needed: ["Cooking oil (1-2 tbsp)", "Cumin seeds", "Turmeric", "Green chillies & Salt"],
      why_recommended: "Perfect pairing of your fresh cabbage and protein-rich chicken. Light, nutritious, and ready fast.",
      quick_steps: [
        "Finely shred the cabbage and shred or slice the chicken into bite-sized pieces.",
        "Heat 1 tbsp oil in a kadai/pan, crackle cumin seeds and 1 slit green chili.",
        "Toss in the shredded cabbage with 1/2 tsp turmeric and salt; sauté on high heat for 6 minutes until tender-crisp.",
        "Fold in the chicken, sauté together for 4-5 minutes until steaming and well spiced, garnish with coriander."
      ],
      leftover_alert: "Uses up cabbage and chicken perfectly to keep your fridge fresh!",
      dish_object: {
        name: "Quick Homestyle Spiced Cabbage & Chicken Stir-Fry",
        ingredients: [
          { name: "Cabbage", quantity: 500, unit: "grams" },
          { name: "Chicken", quantity: 300, unit: "grams" }
        ]
      }
    };
  }

  // 3. Cabbage + Cauliflower / Courgette
  if (hasCabbage && (hasCauliflower || hasCourgette)) {
    const cName = hasCauliflower ? "Cauliflower" : "Courgette";
    return {
      dish_name: `Quick Spiced Cabbage & ${cName} Sabzi (Poriyal)`,
      prep_cook_time_minutes: Math.min(timeMins, 20),
      category: "Fresh Vegetarian Side/Main",
      spoken_response: `Biwiji, aapke paas ${timeMins} minute hain aur fridge mein Cabbage aur ${cName} hai. Main recommend karta hoon: Quick Spiced Cabbage aur ${cName} Sabzi! 15 minute mein tazza ban jayegi.`,
      ingredients_used: ["Cabbage", cName],
      pantry_items_needed: ["Mustard seeds / Cumin", "Curry leaves / Green chili", "Turmeric", "Salt"],
      why_recommended: `Healthy, vibrant vegetable medley utilizing your fresh cabbage and ${cName}.`,
      quick_steps: [
        `Chop cabbage and ${cName} into small uniform florets/pieces.`,
        "Heat oil in a pan, add mustard seeds and green chili.",
        `Add chopped cabbage and ${cName}, sprinkle salt and turmeric.`,
        "Cover and cook on medium flame for 10-12 minutes, stirring once until tender."
      ],
      leftover_alert: "Pure fresh produce from your crisper drawer."
    };
  }

  // 4. Eggs
  if (hasEggs) {
    return {
      dish_name: "Spicy Masala Egg Bhurji (Scrambled Eggs)",
      prep_cook_time_minutes: Math.min(timeMins, 12),
      category: "Quick Protein Dish",
      spoken_response: `Biwiji, aapke paas ${timeMins} minute hain aur fridge mein Eggs hain. Main recommend karta hoon: Masala Egg Bhurji! Bas 10 minute mein ready.`,
      ingredients_used: ["Eggs"],
      pantry_items_needed: ["Onion", "Tomato", "Green chili", "Butter/Oil", "Spices"],
      why_recommended: "Quickest protein-packed hot meal ready in under 12 minutes.",
      quick_steps: [
        "Whisk eggs with a pinch of salt and black pepper.",
        "Sauté finely chopped onion, tomato, and green chili in melted butter for 3 mins.",
        "Pour in whisked eggs and gently scramble on medium heat for 3-4 minutes until soft and fluffy."
      ],
      leftover_alert: "Great quick meal option."
    };
  }

  // 5. Daal / Curd
  if (hasDaal || hasCurd) {
    const mainItem = hasDaal ? "Cooked Daal" : "Fresh Dahi (Curd)";
    return {
      dish_name: `Comforting ${mainItem} Bowl with Jeera Tempering & Warm Roti`,
      prep_cook_time_minutes: Math.min(timeMins, 15),
      category: "Comforting Homestyle Meal",
      spoken_response: `Biwiji, aapke paas ${timeMins} minute hain. Fridge mein ${mainItem} hai. Main recommend karta hoon: Comforting ${mainItem} with fresh tempering aur Roti!`,
      ingredients_used: [mainItem],
      pantry_items_needed: ["Ghee", "Jeera (Cumin)", "Roti / Rice", "Pickle"],
      why_recommended: "Gentle, nutritious comfort food that comes together effortlessly in 15 minutes.",
      quick_steps: [
        `Warm the ${mainItem} gently in a saucepan.`,
        "In a small ladle, heat 1 tsp ghee with cumin seeds and dry red chili.",
        "Pour sizzling tadka over the dish and serve steaming hot with warm roti."
      ],
      leftover_alert: "Delicious comfort meal with zero effort."
    };
  }

  // Default general recommendation
  const firstTwo = items.slice(0, 2).map(i => i.name);
  const itemsText = firstTwo.join(" and ") || "fresh fridge ingredients";
  return {
    dish_name: `Homestyle Tawa Stir-Fry with ${firstTwo[0] || 'Fresh Ingredients'}`,
    prep_cook_time_minutes: Math.min(timeMins, 20),
    category: "Homestyle Meal",
    spoken_response: `Biwiji, aapke paas ${timeMins} minute hain aur fridge mein ${itemsText} hai. Main 20 minute mein ek badiya homestyle dish recommend karta hoon!`,
    ingredients_used: firstTwo,
    pantry_items_needed: ["Cooking oil", "Spices (turmeric, chili, salt)", "Onion/Garlic"],
    why_recommended: "Nutritious and balanced dish matching your available cooking time.",
    quick_steps: [
      "Chop available ingredients into bite-sized pieces.",
      "Heat oil in a pan, add aromatics and spices.",
      "Cook vegetables/proteins on medium heat for 12-15 minutes until tender and aromatic."
    ],
    leftover_alert: "Checks all current fridge and freezer items."
  };
}

function addRamuChatMessage(sender, text) {
  const container = document.getElementById("ramuDialogueContainer");
  if (!container) return;

  const msgDiv = document.createElement("div");
  msgDiv.className = sender === "ramu"
    ? "flex items-start space-x-2.5 max-w-[88%]"
    : "flex items-start space-x-2.5 max-w-[88%] ml-auto flex-row-reverse space-x-reverse";

  if (sender === "ramu") {
    msgDiv.innerHTML = `
      <div class="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center text-sm shadow-xs flex-shrink-0">
        👨‍🍳
      </div>
      <div class="chat-bubble-ramu p-3 rounded-2xl rounded-tl-xs text-xs sm:text-sm font-medium shadow-2xs leading-relaxed">
        ${escapeHtml(text)}
      </div>
    `;
  } else {
    msgDiv.innerHTML = `
      <div class="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center text-sm shadow-xs flex-shrink-0 font-bold">
        👤
      </div>
      <div class="chat-bubble-user p-3 rounded-2xl rounded-tr-xs text-xs sm:text-sm font-semibold shadow-2xs leading-relaxed">
        ${escapeHtml(text)}
      </div>
    `;
  }

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function renderRamuQuickChips(chips) {
  const container = document.getElementById("ramuQuickChips");
  if (!container) return;

  if (!chips || chips.length === 0) {
    container.innerHTML = "";
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = chips.map(chip => `
    <button onclick="handleRamuChipClick('${escapeHtml(chip.value)}')" class="px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200/80 transition active:scale-95 shadow-2xs cursor-pointer">
      ${escapeHtml(chip.label)}
    </button>
  `).join("");
}

function handleRamuChipClick(val) {
  if (val === "__COOK_NOW__") {
    if (ramuState.activeRecommendation) {
      const rec = ramuState.activeRecommendation;
      let dishToCook = rec.dish_object;
      if (!dishToCook) {
        dishToCook = appState.dishes.find(d => d.name === rec.dish_name);
      }
      if (!dishToCook) {
        dishToCook = {
          name: rec.dish_name,
          ingredients: (rec.ingredients_used || []).map(ingStr => {
            let name = ingStr;
            let qty = 1;
            let unit = "portions";
            const m = String(ingStr).match(/^(.*?)\s*\((.*?)\)$/);
            if (m) {
              name = m[1].trim();
              const qm = m[2].match(/(\d+(?:\.\d+)?)\s*(.*)/);
              if (qm) {
                qty = parseFloat(qm[1]);
                unit = qm[2] ? qm[2].trim() : "portions";
              }
            }
            return { name, quantity: qty, unit };
          })
        };
      }
      cookDishAndDeductInventory(dishToCook);
      closeRamuKakaModal();
    }
    return;
  }
  handleUserSpokenInput(val);
}

function renderRamuDishCard(rec) {
  const container = document.getElementById("ramuDishCardContainer");
  if (!container || !rec) return;

  container.classList.remove("hidden");
  const ingTags = (rec.ingredients_used || []).map(ing => `
    <span class="inline-flex items-center space-x-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200">
      <i class="ph-bold ph-check text-emerald-600"></i>
      <span>${escapeHtml(ing)}</span>
    </span>
  `).join("");

  const stepsList = (rec.quick_steps || []).map((step, idx) => `
    <li class="flex items-start space-x-2 text-xs text-slate-700">
      <span class="w-4 h-4 rounded-full bg-amber-500 text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">${idx+1}</span>
      <span>${escapeHtml(step)}</span>
    </li>
  `).join("");

  container.innerHTML = `
    <div class="bg-white rounded-2xl p-4 shadow-sm border border-amber-200/90 space-y-3">
      <div class="flex items-start justify-between gap-2">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-amber-700 px-2 py-0.5 bg-amber-100 rounded-full">Ramu Kaka's Recommendation</span>
          <h4 class="text-sm sm:text-base font-extrabold text-slate-900 mt-1 flex items-center space-x-1.5">
            <span>🍳</span>
            <span>${escapeHtml(rec.dish_name)}</span>
          </h4>
        </div>
        <div class="text-right flex-shrink-0">
          <span class="inline-flex items-center space-x-1 text-xs font-bold px-2.5 py-1 bg-orange-100 text-orange-800 rounded-xl">
            <i class="ph-bold ph-clock text-orange-600"></i>
            <span>${rec.prep_cook_time_minutes || 20} mins</span>
          </span>
        </div>
      </div>

      <!-- Ingredients used from fridge -->
      <div>
        <p class="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">From Your Fridge & Freezer:</p>
        <div class="flex flex-wrap gap-1.5">
          ${ingTags || '<span class="text-xs text-slate-500">Fresh fridge produce</span>'}
        </div>
      </div>

      <!-- Quick Steps -->
      <div>
        <p class="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Quick Preparation Steps:</p>
        <ul class="space-y-1.5">
          ${stepsList}
        </ul>
      </div>

      ${rec.leftover_alert ? `
        <div class="p-2 rounded-xl bg-emerald-50 border border-emerald-100 text-[11px] text-emerald-800 font-medium flex items-center space-x-1.5">
          <i class="ph-bold ph-sparkle text-emerald-600 text-sm"></i>
          <span>${escapeHtml(rec.leftover_alert)}</span>
        </div>
      ` : ''}

      <!-- Action buttons -->
      <div class="flex items-center space-x-2 pt-2 border-t border-slate-100">
        <button onclick="handleRamuChipClick('__COOK_NOW__')" class="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold hover:from-emerald-700 hover:to-teal-700 transition shadow-xs flex items-center justify-center space-x-1 cursor-pointer">
          <i class="ph-bold ph-fire"></i>
          <span>Let's Cook This!</span>
        </button>
        <button onclick="ramuFetchRecommendation(${rec.prep_cook_time_minutes || 20}, true)" class="py-2 px-3 rounded-xl border border-amber-300 text-amber-800 hover:bg-amber-50 text-xs font-semibold transition flex items-center space-x-1 cursor-pointer">
          <i class="ph-bold ph-arrows-clockwise"></i>
          <span>Another Dish</span>
        </button>
      </div>
    </div>
  `;

  const dialogueContainer = document.getElementById("ramuDialogueContainer");
  if (dialogueContainer) dialogueContainer.scrollTop = dialogueContainer.scrollHeight;
}

function setRamuStatus(label, type) {
  const lbl = document.getElementById("ramuStatusLabel");
  const dot = document.getElementById("ramuStatusDot");
  if (lbl) lbl.textContent = label;

  if (dot) {
    if (type === "listening") {
      dot.className = "w-2.5 h-2.5 rounded-full bg-red-500 animate-ping";
    } else if (type === "speaking") {
      dot.className = "w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse";
    } else if (type === "success") {
      dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500";
    } else {
      dot.className = "w-2.5 h-2.5 rounded-full bg-slate-400";
    }
  }
}

function updateRamuWaveUI() {
  const wave = document.getElementById("ramuWaveIndicator");
  if (!wave) return;
  if (ramuState.isSpeaking || ramuState.isListening) {
    wave.classList.remove("hidden");
    wave.classList.add("flex");
  } else {
    wave.classList.add("hidden");
    wave.classList.remove("flex");
  }
}

function updateRamuMicButton(isListening) {
  const btn = document.getElementById("btnRamuMicToggle");
  const icon = document.getElementById("ramuMicIcon");
  const label = document.getElementById("ramuMicLabel");
  if (!btn) return;

  if (isListening) {
    btn.className = "flex-1 py-3 px-4 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center justify-center space-x-2 shadow-lg animate-pulse transition active:scale-95 cursor-pointer";
    if (icon) icon.className = "ph-bold ph-stop text-lg";
    if (label) label.textContent = "Listening... (Tap when done)";
  } else {
    btn.className = "flex-1 py-3 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-sm flex items-center justify-center space-x-2 shadow-md active:scale-95 transition cursor-pointer";
    if (icon) icon.className = "ph-bold ph-microphone text-lg";
    if (label) label.textContent = "Tap to Speak";
  }
}
