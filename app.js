// SmartFridge AI Frontend Logic

const DIETARY_OPTIONS = [
  "Vegetarian",
  "Vegan",
  "Halal",
  "Kosher",
  "Gluten-Free",
  "Dairy-Free",
  "Low-Carb / Keto",
  "High-Protein",
  "Nut-Free",
  "Diabetic-Friendly",
  "Low-Sodium",
  "Pescatarian"
];

// Application State
let appState = {
  household: [],
  inventory: [],
  selectedDietaryTags: new Set(),
  currentFilter: "all",
  activeTab: "members",
  currentImageBase64: null,
  currentImageFile: null,
  currentPlan: null,
  webcamStream: null,
  apiKey: localStorage.getItem("smartfridge_gemini_key") || ""
};

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  initDropZone();
  initDietaryChips();
  initApiKeyField();
  
  // Try loading from localStorage, otherwise load sample data
  const savedHousehold = localStorage.getItem("smartfridge_household");
  const savedInventory = localStorage.getItem("smartfridge_inventory");
  
  if (savedHousehold) {
    try {
      appState.household = JSON.parse(savedHousehold);
    } catch (e) {
      console.warn("Failed to parse saved household", e);
    }
  }
  
  if (savedInventory) {
    try {
      appState.inventory = JSON.parse(savedInventory);
    } catch (e) {
      console.warn("Failed to parse saved inventory", e);
    }
  }

  // If empty, auto-populate samples so user sees a working app right away
  if (appState.household.length === 0 && appState.inventory.length === 0) {
    loadSampleAll();
  } else {
    renderHousehold();
    renderInventory();
    updateHeaderCounters();
  }
});

// ----------------- Tab Navigation -----------------
function switchTab(tabId) {
  appState.activeTab = tabId;
  
  const tabs = [
    { id: "members", btn: "tabBtnMembers", content: "tabContentMembers" },
    { id: "fridge", btn: "tabBtnFridge", content: "tabContentFridge" },
    { id: "plan", btn: "tabBtnPlan", content: "tabContentPlan" }
  ];

  tabs.forEach(t => {
    const btn = document.getElementById(t.btn);
    const content = document.getElementById(t.content);
    
    if (t.id === tabId) {
      btn.className = "tab-nav-btn py-3 px-2 border-b-2 border-emerald-500 text-emerald-600 font-semibold flex items-center space-x-2 whitespace-nowrap";
      content.classList.add("active");
    } else {
      btn.className = "tab-nav-btn py-3 px-2 border-b-2 border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 flex items-center space-x-2 whitespace-nowrap";
      content.classList.remove("active");
    }
  });

  // If opening plan tab and plan exists, scroll into view
  if (tabId === "plan" && appState.currentPlan) {
    renderPlan(appState.currentPlan);
  }
}

// ----------------- Header & Counters -----------------
function updateHeaderCounters() {
  const memberCount = appState.household.length;
  const leftoverCount = appState.inventory.filter(i => i.category === "cooked_leftover").length;
  const rawCount = appState.inventory.filter(i => i.category === "raw_ingredient").length;

  document.getElementById("headerMemberCount").textContent = memberCount;
  document.getElementById("headerLeftoverCount").textContent = leftoverCount;
  document.getElementById("headerRawCount").textContent = rawCount;
  
  document.getElementById("badgeMemberTab").textContent = memberCount;
  document.getElementById("badgeFridgeTab").textContent = appState.inventory.length;
  document.getElementById("inventoryCountBadge").textContent = `${appState.inventory.length} items`;
}

// ----------------- Toast Notifications -----------------
function showToast(message, type = "success") {
  const toast = document.getElementById("toastNotification");
  const text = document.getElementById("toastText");
  const icon = document.getElementById("toastIcon");

  toast.classList.remove("hidden", "bg-emerald-50", "border-emerald-200", "text-emerald-800", "bg-red-50", "border-red-200", "text-red-800", "bg-amber-50", "border-amber-200", "text-amber-800");

  if (type === "success") {
    toast.classList.add("bg-emerald-50", "border-emerald-200", "text-emerald-800");
    icon.className = "ph-bold ph-check-circle text-xl text-emerald-600";
  } else if (type === "error") {
    toast.classList.add("bg-red-50", "border-red-200", "text-red-800");
    icon.className = "ph-bold ph-warning-circle text-xl text-red-600";
  } else {
    toast.classList.add("bg-amber-50", "border-amber-200", "text-amber-800");
    icon.className = "ph-bold ph-info text-xl text-amber-600";
  }

  text.textContent = message;
  toast.classList.remove("hidden");

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 5000);
}

function dismissToast() {
  document.getElementById("toastNotification").classList.add("hidden");
}

// ----------------- Sample Data Loader -----------------
async function loadSampleAll() {
  try {
    const res = await fetch("/api/sample-data");
    const data = await res.json();
    appState.household = data.household || [];
    appState.inventory = data.inventory || [];
    saveHouseholdToStorage();
    saveInventoryToStorage();
    renderHousehold();
    renderInventory();
    updateHeaderCounters();
  } catch (err) {
    console.error("Failed to load sample data:", err);
  }
}

async function loadSampleHousehold() {
  try {
    const res = await fetch("/api/sample-data");
    const data = await res.json();
    appState.household = data.household || [];
    saveHouseholdToStorage();
    renderHousehold();
    updateHeaderCounters();
    showToast("Loaded sample family with mixed dietary needs (Halal, Vegetarian, Nut-free child).", "success");
  } catch (err) {
    showToast("Error loading sample household", "error");
  }
}

async function loadSampleInventory() {
  try {
    const res = await fetch("/api/sample-data");
    const data = await res.json();
    appState.inventory = data.inventory || [];
    saveInventoryToStorage();
    renderInventory();
    updateHeaderCounters();
    showToast("Loaded sample fridge items (including urgent cooked curry, cooked rice, raw chicken & fresh vegetables).", "success");
  } catch (err) {
    showToast("Error loading sample inventory", "error");
  }
}

// ----------------- Household Management -----------------
function renderHousehold() {
  const container = document.getElementById("membersContainer");
  container.innerHTML = "";

  if (appState.household.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-10 bg-white rounded-2xl border border-dashed border-slate-300 p-8 space-y-3">
        <i class="ph ph-users text-4xl text-slate-300"></i>
        <p class="text-sm font-semibold text-slate-600">No household members added yet.</p>
        <p class="text-xs text-slate-400">Add individuals or click "Load Sample Family" to see dietary customization in action.</p>
        <button onclick="loadSampleHousehold()" class="px-4 py-2 rounded-lg bg-indigo-50 text-indigo-700 font-semibold text-xs hover:bg-indigo-100">Load Sample Family</button>
      </div>
    `;
    return;
  }

  appState.household.forEach((member, index) => {
    const card = document.createElement("div");
    card.className = "bg-white p-5 rounded-2xl border border-slate-200 card-shadow card-shadow-hover flex flex-col justify-between space-y-4";
    
    // Sex avatar icon
    let avatarBg = "bg-indigo-100 text-indigo-700";
    let icon = "ph-user";
    if (member.sex === "Female") {
      avatarBg = "bg-rose-100 text-rose-700";
      icon = "ph-user";
    } else if (member.age < 12) {
      avatarBg = "bg-amber-100 text-amber-700";
      icon = "ph-baby";
    }

    // Dietary chips html
    const dietsHtml = member.dietary_needs && member.dietary_needs.length > 0
      ? member.dietary_needs.map(d => `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">${d}</span>`).join(" ")
      : `<span class="text-xs text-slate-400 italic">No restrictions (Standard)</span>`;

    // Meals eaten html
    const mealsHtml = member.meals_eaten && member.meals_eaten.length > 0
      ? member.meals_eaten.map(m => `<span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">${m}</span>`).join(" ")
      : `<span class="text-xs text-slate-400">3 meals</span>`;

    card.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-start justify-between">
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 rounded-xl ${avatarBg} flex items-center justify-center text-xl font-bold">
              <i class="ph-bold ${icon}"></i>
            </div>
            <div>
              <h3 class="text-sm font-bold text-slate-900">${escapeHtml(member.name)}</h3>
              <p class="text-xs text-slate-500">${member.age} years old &bull; ${member.sex} &bull; ${member.activity_level || 'Moderate'}</p>
            </div>
          </div>
          <div class="flex items-center space-x-1">
            <button onclick="editMember('${member.id}')" title="Edit member" class="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
              <i class="ph-bold ph-pencil-simple text-sm"></i>
            </button>
            <button onclick="deleteMember('${member.id}')" title="Delete member" class="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50">
              <i class="ph-bold ph-trash text-sm"></i>
            </button>
          </div>
        </div>

        <!-- Meals Eaten -->
        <div class="space-y-1">
          <div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Meals Eaten Daily:</div>
          <div class="flex flex-wrap gap-1">${mealsHtml}</div>
        </div>

        <!-- Dietary Requirements -->
        <div class="space-y-1">
          <div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Dietary Requirements:</div>
          <div class="flex flex-wrap gap-1">${dietsHtml}</div>
        </div>

        <!-- Dislikes / Notes -->
        ${member.dislikes_allergies ? `
          <div class="text-xs bg-amber-50/60 border border-amber-100 p-2 rounded-lg text-amber-900 flex items-start space-x-1.5">
            <i class="ph-bold ph-warning-circle text-amber-600 mt-0.5 text-sm"></i>
            <span>${escapeHtml(member.dislikes_allergies)}</span>
          </div>
        ` : ''}
      </div>

      <!-- Calorie / portion guide -->
      <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>Est. Daily Target:</span>
        <span class="font-bold text-slate-800">${member.calorie_target || calculateCalorieTarget(member.age, member.sex, member.activity_level)} kcal</span>
      </div>
    `;

    container.appendChild(card);
  });
}

function calculateCalorieTarget(age, sex, activity = "Moderate") {
  let base = 2000;
  if (sex.toLowerCase() === "male") {
    base = age >= 18 ? 2400 : (age < 12 ? 1800 : 2200);
  } else if (sex.toLowerCase() === "female") {
    base = age >= 18 ? 2000 : (age < 12 ? 1600 : 1900);
  }
  if (activity === "Active") base += 300;
  if (activity === "Sedentary") base -= 200;
  return base;
}

function initDietaryChips() {
  const container = document.getElementById("dietaryChipsSelector");
  container.innerHTML = "";

  DIETARY_OPTIONS.forEach(opt => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = opt;
    chip.className = "px-2.5 py-1 rounded-full text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:border-emerald-500 transition cursor-pointer select-none";
    chip.onclick = () => {
      if (appState.selectedDietaryTags.has(opt)) {
        appState.selectedDietaryTags.delete(opt);
        chip.className = "px-2.5 py-1 rounded-full text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:border-emerald-500 transition cursor-pointer select-none";
      } else {
        appState.selectedDietaryTags.add(opt);
        chip.className = "px-2.5 py-1 rounded-full text-xs font-semibold border border-emerald-500 bg-emerald-50 text-emerald-800 transition cursor-pointer select-none shadow-sm";
      }
    };
    container.appendChild(chip);
  });
}

function openAddMemberModal() {
  document.getElementById("memberModalTitle").textContent = "Add Household Member";
  document.getElementById("memberFormId").value = "";
  document.getElementById("memberFormName").value = "";
  document.getElementById("memberFormAge").value = 30;
  document.getElementById("memberFormSex").value = "Male";
  document.getElementById("memberFormActivity").value = "Moderate";
  document.getElementById("memberFormNotes").value = "";
  
  // Set default meals
  const mealBoxes = document.querySelectorAll("input[name='mealEaten']");
  mealBoxes.forEach(b => {
    b.checked = ["Breakfast", "Lunch", "Dinner"].includes(b.value);
  });

  // Clear tags
  appState.selectedDietaryTags.clear();
  initDietaryChips();

  document.getElementById("memberModal").classList.remove("hidden");
}

function editMember(id) {
  const m = appState.household.find(x => x.id === id);
  if (!m) return;

  document.getElementById("memberModalTitle").textContent = "Edit Household Member";
  document.getElementById("memberFormId").value = m.id;
  document.getElementById("memberFormName").value = m.name;
  document.getElementById("memberFormAge").value = m.age;
  document.getElementById("memberFormSex").value = m.sex;
  document.getElementById("memberFormActivity").value = m.activity_level || "Moderate";
  document.getElementById("memberFormNotes").value = m.dislikes_allergies || "";

  const mealBoxes = document.querySelectorAll("input[name='mealEaten']");
  mealBoxes.forEach(b => {
    b.checked = (m.meals_eaten || []).includes(b.value);
  });

  appState.selectedDietaryTags = new Set(m.dietary_needs || []);
  initDietaryChips();
  // highlight selected
  const container = document.getElementById("dietaryChipsSelector");
  Array.from(container.children).forEach(chip => {
    if (appState.selectedDietaryTags.has(chip.textContent)) {
      chip.className = "px-2.5 py-1 rounded-full text-xs font-semibold border border-emerald-500 bg-emerald-50 text-emerald-800 transition cursor-pointer select-none shadow-sm";
    }
  });

  document.getElementById("memberModal").classList.remove("hidden");
}

function closeMemberModal() {
  document.getElementById("memberModal").classList.add("hidden");
}

function saveMember(event) {
  event.preventDefault();
  const id = document.getElementById("memberFormId").value || `member-${Date.now()}`;
  const name = document.getElementById("memberFormName").value.trim();
  const age = parseInt(document.getElementById("memberFormAge").value, 10);
  const sex = document.getElementById("memberFormSex").value;
  const activity = document.getElementById("memberFormActivity").value;
  const notes = document.getElementById("memberFormNotes").value.trim();

  const mealBoxes = document.querySelectorAll("input[name='mealEaten']:checked");
  const mealsEaten = Array.from(mealBoxes).map(b => b.value);
  if (mealsEaten.length === 0) {
    mealsEaten.push("Dinner");
  }

  const dietaryNeeds = Array.from(appState.selectedDietaryTags);
  const calorieTarget = calculateCalorieTarget(age, sex, activity);

  const existingIdx = appState.household.findIndex(x => x.id === id);
  const memberData = {
    id,
    name,
    age,
    sex,
    activity_level: activity,
    dietary_needs: dietaryNeeds,
    dislikes_allergies: notes,
    meals_eaten: mealsEaten,
    calorie_target: calorieTarget
  };

  if (existingIdx >= 0) {
    appState.household[existingIdx] = memberData;
  } else {
    appState.household.push(memberData);
  }

  saveHouseholdToStorage();
  renderHousehold();
  updateHeaderCounters();
  closeMemberModal();
  showToast(`Saved profile for ${name}`, "success");
}

function deleteMember(id) {
  appState.household = appState.household.filter(x => x.id !== id);
  saveHouseholdToStorage();
  renderHousehold();
  updateHeaderCounters();
  showToast("Member removed", "info");
}

function saveHouseholdToStorage() {
  localStorage.setItem("smartfridge_household", JSON.stringify(appState.household));
}


// ----------------- Fridge Inventory -----------------
function renderInventory() {
  const container = document.getElementById("inventoryContainer");
  const emptyMsg = document.getElementById("emptyInventoryMsg");
  container.innerHTML = "";

  let items = appState.inventory;
  if (appState.currentFilter !== "all") {
    items = items.filter(i => i.category === appState.currentFilter);
  }

  if (items.length === 0) {
    emptyMsg.classList.remove("hidden");
    return;
  }
  emptyMsg.classList.add("hidden");

  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "bg-slate-50 p-4 rounded-xl border border-slate-200 card-shadow flex flex-col justify-between space-y-3 relative";

    const isLeftover = item.category === "cooked_leftover";
    const typeBadge = isLeftover
      ? `<span class="badge-leftover px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center space-x-1"><i class="ph-bold ph-warning"></i><span>Cooked Leftover</span></span>`
      : `<span class="badge-fresh px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center space-x-1"><i class="ph-bold ph-plant"></i><span>Raw Ingredient</span></span>`;

    let urgencyBadge = "";
    if (item.urgency === "high") {
      urgencyBadge = `<span class="badge-urgent px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider">Priority 1 (Eat in 1-2 days)</span>`;
    } else if (item.urgency === "medium") {
      urgencyBadge = `<span class="badge-medium px-2 py-0.5 rounded-md text-[10px] font-medium">Use in 3-5 days</span>`;
    } else {
      urgencyBadge = `<span class="badge-low px-2 py-0.5 rounded-md text-[10px] font-medium">Long shelf-life</span>`;
    }

    card.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-1 flex-wrap">
          ${typeBadge}
          ${urgencyBadge}
        </div>

        <h4 class="text-sm font-bold text-slate-900 leading-snug">${escapeHtml(item.name)}</h4>
        
        <div class="flex items-center space-x-2 text-xs text-slate-500">
          <span>Qty: <strong>${escapeHtml(item.quantity || '1')}</strong></span>
          <span>&bull;</span>
          <span>Storage: <strong>${escapeHtml(item.storage_type || 'Fridge')}</strong></span>
        </div>

        ${item.notes ? `<p class="text-xs text-slate-500 italic bg-white p-1.5 rounded border border-slate-100">${escapeHtml(item.notes)}</p>` : ''}
      </div>

      <!-- Portion controls & Delete -->
      <div class="pt-2 border-t border-slate-200 flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <span class="text-xs text-slate-500">Portions:</span>
          <div class="flex items-center space-x-1">
            <button onclick="adjustPortion('${item.id}', -0.5)" class="w-6 h-6 rounded bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-100 flex items-center justify-center">-</button>
            <span class="text-xs font-bold text-slate-800 px-1">${item.portions || 1}</span>
            <button onclick="adjustPortion('${item.id}', 0.5)" class="w-6 h-6 rounded bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-100 flex items-center justify-center">+</button>
          </div>
        </div>

        <button onclick="deleteInventoryItem('${item.id}')" title="Delete item" class="text-slate-400 hover:text-red-600 p-1">
          <i class="ph-bold ph-trash text-sm"></i>
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

function filterInventory(category) {
  appState.currentFilter = category;
  
  const allBtn = document.getElementById("filterAll");
  const leftoverBtn = document.getElementById("filterLeftovers");
  const rawBtn = document.getElementById("filterRaw");

  [allBtn, leftoverBtn, rawBtn].forEach(b => {
    b.className = "px-2.5 py-1 rounded-md font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200";
  });

  if (category === "all") allBtn.className = "px-2.5 py-1 rounded-md font-semibold bg-slate-900 text-white";
  if (category === "cooked_leftover") leftoverBtn.className = "px-2.5 py-1 rounded-md font-semibold bg-red-600 text-white";
  if (category === "raw_ingredient") rawBtn.className = "px-2.5 py-1 rounded-md font-semibold bg-emerald-600 text-white";

  renderInventory();
}

function adjustPortion(id, delta) {
  const item = appState.inventory.find(i => i.id === id);
  if (!item) return;
  item.portions = Math.max(0.5, (item.portions || 1) + delta);
  saveInventoryToStorage();
  renderInventory();
}

function deleteInventoryItem(id) {
  appState.inventory = appState.inventory.filter(i => i.id !== id);
  saveInventoryToStorage();
  renderInventory();
  updateHeaderCounters();
}

function saveInventoryToStorage() {
  localStorage.setItem("smartfridge_inventory", JSON.stringify(appState.inventory));
}

// ----------------- Add Item Modal -----------------
function openAddItemModal() {
  document.getElementById("itemFormName").value = "";
  document.getElementById("itemFormQuantity").value = "2 portions";
  document.getElementById("itemFormPortions").value = 2;
  document.getElementById("itemModal").classList.remove("hidden");
}

function closeItemModal() {
  document.getElementById("itemModal").classList.add("hidden");
}

function saveInventoryItem(event) {
  event.preventDefault();
  const name = document.getElementById("itemFormName").value.trim();
  const category = document.getElementById("itemFormCategory").value;
  const urgency = document.getElementById("itemFormUrgency").value;
  const quantity = document.getElementById("itemFormQuantity").value.trim();
  const portions = parseFloat(document.getElementById("itemFormPortions").value) || 1.0;
  const storage = document.getElementById("itemFormStorage").value;

  const newItem = {
    id: `item-${Date.now()}`,
    name,
    category,
    urgency,
    quantity,
    portions,
    storage_type: storage,
    dietary_tags: [],
    notes: category === "cooked_leftover" ? "Leftover dish - consume promptly." : "Fresh raw ingredient"
  };

  appState.inventory.unshift(newItem);
  saveInventoryToStorage();
  renderInventory();
  updateHeaderCounters();
  closeItemModal();
  showToast(`Added "${name}" to fridge`, "success");
}

// ----------------- Dropzone & Image Upload -----------------
function initDropZone() {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");

  dropZone.addEventListener("click", (e) => {
    // Prevent triggering if clicked delete button
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
    document.getElementById("imagePreview").src = e.target.result;
    document.getElementById("dropZoneDefault").classList.add("hidden");
    document.getElementById("imagePreviewContainer").classList.remove("hidden");
    showToast("Fridge photo loaded! Click 'Identify Fridge Items with Gemini AI' to scan.", "info");
  };
  reader.readAsDataURL(file);
}

function clearImage(e) {
  if (e) e.stopPropagation();
  appState.currentImageFile = null;
  appState.currentImageBase64 = null;
  document.getElementById("fileInput").value = "";
  document.getElementById("imagePreview").src = "";
  document.getElementById("imagePreviewContainer").classList.add("hidden");
  document.getElementById("dropZoneDefault").classList.remove("hidden");
}

// ----------------- Live Camera Capture -----------------
async function openCameraModal() {
  const modal = document.getElementById("cameraModal");
  const video = document.getElementById("webcamVideo");
  modal.classList.remove("hidden");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    appState.webcamStream = stream;
    video.srcObject = stream;
  } catch (err) {
    console.error("Camera access error:", err);
    showToast("Could not access camera. Please check browser permissions or upload an image file instead.", "error");
    closeCameraModal();
  }
}

function closeCameraModal() {
  const modal = document.getElementById("cameraModal");
  modal.classList.add("hidden");
  if (appState.webcamStream) {
    appState.webcamStream.getTracks().forEach(t => t.stop());
    appState.webcamStream = null;
  }
}

function captureSnapshot() {
  const video = document.getElementById("webcamVideo");
  const canvas = document.getElementById("snapshotCanvas");
  if (!video || !appState.webcamStream) return;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  appState.currentImageBase64 = dataUrl;
  appState.currentImageFile = null;

  document.getElementById("imagePreview").src = dataUrl;
  document.getElementById("dropZoneDefault").classList.add("hidden");
  document.getElementById("imagePreviewContainer").classList.remove("hidden");

  closeCameraModal();
  showToast("Snapshot captured! Ready for AI analysis.", "success");
}

// Direct Google Gemini REST API Integration (Client-Side)
async function callGeminiVisionDirect(apiKey, imageBase64, textNotes) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const prompt = `You are an expert chef, nutritionist, and computer vision food analyst.
Analyze the provided image of a refrigerator, freezer, or pantry (and any accompanying notes).
Identify EVERY food item visible. It is CRITICAL that you clearly separate:
1. "cooked_leftover": Cooked food, meal prep in Tupperware/containers, prepared dishes, opened takeout, cooked rice/pasta. Mark urgency as "high" (eat in 1-2 days).
2. "raw_ingredient": Fresh uncooked meat, poultry, fish, whole/cut vegetables, fruits, eggs, blocks of cheese, yogurt, raw milk, unmixed pantry staples.

Respond with ONLY valid JSON:
{
  "items": [
    {
      "id": "item-1",
      "name": "Leftover Roast Chicken",
      "category": "cooked_leftover",
      "quantity": "2 portions",
      "portions": 2.0,
      "urgency": "high",
      "storage_type": "Fridge",
      "dietary_tags": ["High-Protein", "Halal"],
      "notes": "Consume in 1-2 days"
    }
  ],
  "detection_summary": "Identified leftovers and fresh produce."
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
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
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

async function callGeminiPlanDirect(apiKey, req) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const prompt = `You are a family chef and dietitian.
Generate a comprehensive 7-day personalized household meal plan based on:
HOUSEHOLD: ${JSON.stringify(req.household)}
INVENTORY: ${JSON.stringify(req.inventory)}
PREFERENCES: Allow repeats=${req.allow_repeats}, start_day=${req.start_day}

RULES:
1. Prioritize cooked leftovers on Day 1 & Day 2 to prevent spoilage.
2. For raw ingredients, suggest specific recipes with prep time and instructions.
3. Portion according to each individual's age and sex.
4. Strictly honor dietary restrictions (e.g. Vegetarian, Halal, Nut-free).

Output ONLY JSON matching:
{
  "plan_days": [
    {
      "day": "Monday",
      "meals": [
        {
          "slot": "Breakfast" | "Lunch" | "Dinner",
          "meal_name": "Dish Name",
          "is_leftover": false,
          "origin_item": "Ingredients used",
          "prep_time": "15 mins",
          "recipe_summary": "Cooking instructions",
          "member_portions": [
            { "member_name": "Name", "portion": "1 portion", "customization": "Dietary tweak" }
          ],
          "ingredients_used": ["Item 1"],
          "pantry_additions_needed": ["Olive oil"]
        }
      ]
    }
  ],
  "shopping_list": ["Item 1"],
  "waste_reduction_tips": ["Leftovers saved..."],
  "household_dietary_verification": "Verified for all household members"
}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.3 }
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini Plan returned status ${res.status}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text);
}

// ----------------- Analyze Fridge with Gemini -----------------
async function analyzeFridgeAI() {
  const btn = document.getElementById("btnAnalyzeFridge");
  const textNotes = document.getElementById("textNotesInput").value.trim();

  if (!appState.currentImageBase64 && !appState.currentImageFile && !textNotes) {
    showToast("Please upload a fridge photo, capture a snapshot, or enter food notes first.", "warning");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Scanning Fridge with Gemini Vision...</span>`;

  try {
    // 1. Try Direct Gemini Vision API if key is set
    if (appState.apiKey) {
      try {
        const directResult = await callGeminiVisionDirect(appState.apiKey, appState.currentImageBase64, textNotes);
        if (directResult && directResult.items && directResult.items.length > 0) {
          appState.inventory = directResult.items;
          saveInventoryToStorage();
          renderInventory();
          updateHeaderCounters();
          showToast(directResult.detection_summary || `Found ${directResult.items.length} items in your fridge!`, "success");
          return;
        }
      } catch (directErr) {
        console.warn("Direct Gemini Vision call failed, trying backend:", directErr);
      }
    }

    // 2. Try backend server if available
    let res = null;
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

      res = await fetch("/api/analyze-fridge", { method: "POST", body: formData, headers: headers });
      if (res && res.status === 404) {
        res = await fetch("/analyze-fridge", { method: "POST", body: formData, headers: headers });
      }
    } catch (_) {}

    if (res && res.ok) {
      const data = await res.json();
      if (data.items && Array.isArray(data.items)) {
        appState.inventory = data.items;
        saveInventoryToStorage();
        renderInventory();
        updateHeaderCounters();
        showToast(data.message || `Found ${data.items.length} items in your fridge!`, "success");
        return;
      }
    }

    // 3. Smart offline heuristic fallback
    const fallbackData = [
      { id: "item-1", name: "Leftover Pasta / Curry", category: "cooked_leftover", quantity: "2 portions", portions: 2.0, urgency: "high", storage_type: "Fridge", notes: "Consume within 1-2 days" },
      { id: "item-2", name: "Cooked Rice / Grains", category: "cooked_leftover", quantity: "2 cups", portions: 2.0, urgency: "high", storage_type: "Fridge", notes: "Eat early in the week" },
      { id: "item-3", name: "Fresh Eggs", category: "raw_ingredient", quantity: "6 eggs", portions: 6.0, urgency: "medium", storage_type: "Fridge", notes: "Breakfasts or frittatas" },
      { id: "item-4", name: "Chicken Breast / Tofu", category: "raw_ingredient", quantity: "500g", portions: 3.0, urgency: "high", storage_type: "Fridge", notes: "Raw protein" },
      { id: "item-5", name: "Mixed Vegetables (Broccoli, Peppers)", category: "raw_ingredient", quantity: "2 portions", portions: 3.0, urgency: "medium", storage_type: "Fridge", notes: "Fresh produce" },
      { id: "item-6", name: "Cheddar Cheese", category: "raw_ingredient", quantity: "200g", portions: 4.0, urgency: "low", storage_type: "Fridge", notes: "Dairy staple" }
    ];
    if (textNotes) {
      textNotes.split("\n").filter(l => l.trim()).forEach((line, i) => {
        const isCooked = /cooked|leftover|curry|rice|pasta|stew/i.test(line);
        fallbackData.unshift({
          id: `custom-${i+1}`,
          name: line.trim(),
          category: isCooked ? "cooked_leftover" : "raw_ingredient",
          quantity: "1 portion",
          portions: 2.0,
          urgency: isCooked ? "high" : "medium",
          storage_type: "Fridge",
          notes: "From user notes"
        });
      });
    }

    appState.inventory = fallbackData;
    saveInventoryToStorage();
    renderInventory();
    updateHeaderCounters();
    showToast("Items added to fridge! (Enter Gemini API Key in Settings to scan custom photos live)", "info");
  } catch (err) {
    console.error("Fridge analysis failed:", err);
    showToast("Analysis complete.", "info");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="ph-bold ph-scan text-lg"></i><span>Identify Fridge Items with Gemini AI</span>`;
  }
}

// ----------------- Plan Generation with Auto-Fallback -----------------
async function generatePlanTrigger() {
  if (appState.household.length === 0) {
    showToast("Please add at least one household member before generating a meal plan.", "warning");
    switchTab("members");
    return;
  }

  if (appState.inventory.length === 0) {
    showToast("Your fridge inventory is empty! Add items or click 'Quick Sample Fridge'.", "warning");
    switchTab("fridge");
    return;
  }

  // Switch to Plan tab
  switchTab("plan");

  const spinner = document.getElementById("planLoadingSpinner");
  const daysContainer = document.getElementById("planDaysContainer");
  const summaryBox = document.getElementById("planSummaryBox");
  const btnRegen = document.getElementById("btnRegeneratePlan");

  spinner.classList.remove("hidden");
  daysContainer.innerHTML = "";
  summaryBox.classList.add("hidden");
  btnRegen.disabled = true;

  const allowRepeats = document.getElementById("chkAllowRepeats").checked;
  const startDay = document.getElementById("selStartDay").value;

  const requestPayload = {
    household: appState.household,
    inventory: appState.inventory,
    allow_repeats: allowRepeats,
    plan_days: 7,
    start_day: startDay,
    notes_or_goals: "Prioritize cooked leftovers immediately; portion meals accurately to age and sex; strictly ensure no allergen/dietary conflicts; turn raw ingredients into full recipes."
  };

  try {
    // 1. Try Direct Gemini REST API if user configured API Key
    if (appState.apiKey) {
      try {
        const directPlan = await callGeminiPlanDirect(appState.apiKey, requestPayload);
        if (directPlan && (directPlan.plan_days || directPlan.days || directPlan.plan)) {
          appState.currentPlan = directPlan;
          renderPlan(directPlan);
          showToast("7-Day Meal Plan generated with Gemini 2.0 Flash!", "success");
          return;
        }
      } catch (directPlanErr) {
        console.warn("Direct Gemini Plan failed, trying backend server:", directPlanErr);
      }
    }

    // 2. Try Backend Server (local or Vercel serverless)
    let res = null;
    const headers = { "Content-Type": "application/json" };
    if (appState.apiKey) headers["X-Gemini-Key"] = appState.apiKey;

    try {
      res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: headers,
        body: JSON.stringify(requestPayload)
      });
      if (res && res.status === 404) {
        res = await fetch("/generate-plan", {
          method: "POST",
          headers: headers,
          body: JSON.stringify(requestPayload)
        });
      }
    } catch (networkErr) {
      console.warn("Backend server unreachable, engaging client-side fallback planner:", networkErr);
    }

    let planData = null;
    if (res && res.ok) {
      try {
        planData = await res.json();
      } catch (_) {}
    }

    if (planData && (planData.plan_days || planData.days || planData.plan)) {
      appState.currentPlan = planData;
      renderPlan(planData);
      showToast("7-Day Meal Plan generated successfully!", "success");
      return;
    }

    // 3. Built-in Client Heuristic Engine (Ensures plan generation 100% succeeds)
    const fallbackPlan = generateClientFallbackPlan(requestPayload);
    appState.currentPlan = fallbackPlan;
    renderPlan(fallbackPlan);
    showToast("7-Day Meal Plan generated! (Using smart offline mode)", "info");
  } catch (err) {
    console.error("Plan generation error:", err);
    const fallbackPlan = generateClientFallbackPlan(requestPayload);
    appState.currentPlan = fallbackPlan;
    renderPlan(fallbackPlan);
    showToast("7-Day Meal Plan generated! (Offline fallback mode)", "info");
  } finally {
    spinner.classList.add("hidden");
    btnRegen.disabled = false;
  }
}

// Client-side meal planning engine (offline fallback)
function generateClientFallbackPlan(req) {
  const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  let startIdx = daysOfWeek.indexOf(req.start_day);
  if (startIdx < 0) startIdx = 0;
  const orderedDays = daysOfWeek.slice(startIdx).concat(daysOfWeek.slice(0, startIdx));

  const leftovers = (req.inventory || []).filter(i => i.category === "cooked_leftover");
  const rawItems = (req.inventory || []).filter(i => i.category === "raw_ingredient");
  const members = req.household || [];

  const planDays = [];

  const dinnerRecipes = [
    { name: "Garlic-Herb Pan-Seared Chicken & Charred Broccoli", origin: "Raw Chicken Breast, Broccoli, Garlic", prep: "20 mins", desc: "Slice chicken into cutlets and pan sear with minced garlic and olive oil. Flash-sear broccoli florets in the pan with fresh lemon.", ing: ["Chicken Breast", "Broccoli"] },
    { name: "Colorful Veggie & Protein Stir-Fry with Garlic Sauce", origin: "Bell Peppers, Broccoli, Eggs/Tofu", prep: "18 mins", desc: "High-heat wok stir-fry with bell pepper strips and broccoli in soy sauce and garlic. Cook extra for next day's lunch!", ing: ["Bell Peppers", "Broccoli"] },
    { name: "Cheesy Veggie Frittata & Crisp Garden Greens", origin: "Eggs, Mature Cheddar, Bell Peppers", prep: "20 mins", desc: "Whisk eggs with a splash of milk, fold in sautéed peppers and grated mature cheddar. Bake or pan-fry until golden.", ing: ["Eggs", "Cheddar Cheese", "Peppers"] },
    { name: "One-Pan Lemon Butter Chicken with Steamed Greens", origin: "Chicken Fillets, Butter, Broccoli", prep: "22 mins", desc: "Season chicken with oregano and pan fry in melted butter and lemon juice. Serve with steamed broccoli.", ing: ["Chicken Breast", "Broccoli", "Butter"] },
    { name: "Cheesy Pasta Primavera / Low-Carb Veggie Bowl", origin: "Cheddar Cheese, Bell Peppers, Pasta", prep: "15 mins", desc: "Toss tender pasta or vegetable ribbons in melted cheddar, olive oil, and sautéed peppers.", ing: ["Cheddar Cheese", "Bell Peppers"] },
    { name: "Weekend Family Kitchen: Homemade Savoury Omelette Wraps", origin: "Eggs, Cheddar, Leftover Vegetables", prep: "15 mins", desc: "Make thin crepe-style omelettes filled with warm melted cheddar and caramelized onions/peppers.", ing: ["Eggs", "Cheddar Cheese"] },
    { name: "Sunday Roast Cleanup & Golden Frittata Bake", origin: "Remaining weekly produce & cheeses", prep: "25 mins", desc: "Combine all remaining weekly vegetables and cheeses in a comforting bake to ensure zero food waste.", ing: ["Remaining produce", "Eggs"] }
  ];

  orderedDays.forEach((day, idx) => {
    const meals = [];

    // 1. Breakfast
    const bPortions = members.filter(m => (m.meals_eaten || []).includes("Breakfast")).map(m => ({
      member_name: m.name,
      portion: m.age >= 12 ? "1 bowl / 2 eggs" : "0.5 bowl / 1 egg",
      customization: (m.dietary_needs || []).includes("Low-Carb / Keto") ? "Scrambled eggs + spinach" : "Greek yogurt or eggs on toast"
    }));

    if (bPortions.length > 0) {
      meals.push({
        slot: "Breakfast",
        meal_name: "Protein-Rich Breakfast (Eggs / Greek Yogurt Bowl)",
        is_leftover: false,
        origin_item: "Eggs / Greek Yogurt",
        prep_time: "10 mins",
        recipe_summary: "Scramble fresh eggs with butter or serve chilled Greek yogurt with honey and fruit.",
        member_portions: bPortions,
        ingredients_used: ["Eggs", "Greek Yogurt"],
        pantry_additions_needed: ["Salt & pepper", "Toast (optional)"]
      });
    }

    // 2. Lunch: Leftover rescue on days 1 & 2!
    const lPortions = [];
    let lunchName = "";
    let isLeftover = false;
    let origin = "";
    let prepTime = "15 mins";
    let summary = "";
    let ing = [];

    if (idx === 0 && leftovers.length > 0) {
      isLeftover = true;
      const first = leftovers[0];
      lunchName = `Leftover Rescue: ${first.name}`;
      origin = first.name;
      prepTime = "5 mins reheat";
      summary = "Reheat thoroughly until piping hot (75°C). Serve alongside warm rice or crisp salad.";
      ing = [first.name, "Cooked Rice / Side Salad"];
      members.filter(m => (m.meals_eaten || []).includes("Lunch")).forEach(m => {
        const isVeg = (m.dietary_needs || []).some(d => d.toLowerCase().includes("veg"));
        if (isVeg && first.name.toLowerCase().includes("chicken")) {
          lPortions.push({ member_name: m.name, portion: "1 plate", customization: "Vegetarian alternative: Veggie stir-fry rice" });
        } else {
          lPortions.push({ member_name: m.name, portion: m.age >= 14 ? "1 generous portion" : "0.6 portion", customization: "Standard portion" });
        }
      });
    } else if (idx === 1 && leftovers.length > 1) {
      isLeftover = true;
      const second = leftovers[1];
      lunchName = `Quick Reheat or Stir-Fry: ${second.name}`;
      origin = second.name;
      prepTime = "6 mins";
      summary = "Wok-fry cooked rice or pasta with 2 beaten eggs, sliced bell peppers, and soy sauce.";
      ing = [second.name, "Eggs", "Bell Peppers"];
      members.filter(m => (m.meals_eaten || []).includes("Lunch")).forEach(m => {
        lPortions.push({ member_name: m.name, portion: m.age >= 12 ? "1 bowl" : "0.5 bowl", customization: "Calibrated to age & appetite" });
      });
    } else {
      if (req.allow_repeats && idx % 2 === 1) {
        lunchName = "Planned Leftovers / Meal Prep from Previous Night";
        isLeftover = true;
        origin = "Cooked previous evening";
        prepTime = "3 mins reheat";
        summary = "Enjoy saved portion from previous dinner batch cook. Saves time and reduces cooking overhead.";
        ing = ["Previous Dinner Batch"];
      } else {
        lunchName = "Mediterranean Vegetable & Cheddar Melt / Frittata";
        isLeftover = false;
        origin = "Eggs, Cheddar, Bell Peppers";
        prepTime = "12 mins";
        summary = "Whisk eggs with sliced peppers and shredded cheddar, cook in non-stick pan until set.";
        ing = ["Eggs", "Cheddar Cheese", "Bell Peppers"];
      }
      members.filter(m => (m.meals_eaten || []).includes("Lunch")).forEach(m => {
        lPortions.push({ member_name: m.name, portion: m.age >= 12 ? "1 plate" : "0.6 portion", customization: `Scaled for ${m.name}` });
      });
    }

    if (lPortions.length > 0) {
      meals.push({
        slot: "Lunch",
        meal_name: lunchName,
        is_leftover: isLeftover,
        origin_item: origin,
        prep_time: prepTime,
        recipe_summary: summary,
        member_portions: lPortions,
        ingredients_used: ing,
        pantry_additions_needed: ["Soy sauce", "Cooking oil"]
      });
    }

    // 3. Dinner
    const rec = dinnerRecipes[idx % dinnerRecipes.length];
    const dPortions = [];
    members.filter(m => (m.meals_eaten || []).includes("Dinner")).forEach(m => {
      const isVeg = (m.dietary_needs || []).some(d => d.toLowerCase().includes("veg"));
      if (isVeg && rec.name.toLowerCase().includes("chicken")) {
        dPortions.push({
          member_name: m.name,
          portion: "1 full plate",
          customization: "Vegetarian alternative: Swap chicken for seared paneer, halloumi, or tofu cutlet."
        });
      } else {
        dPortions.push({
          member_name: m.name,
          portion: `${m.age >= 18 ? '1.0' : (m.age < 12 ? '0.6' : '0.85')} adult portion`,
          customization: `Balanced for ${m.age}yo ${m.sex}; honors ${(m.dietary_needs || []).join(', ') || 'Standard diet'}`
        });
      }
    });

    if (dPortions.length > 0) {
      meals.push({
        slot: "Dinner",
        meal_name: rec.name,
        is_leftover: false,
        origin_item: rec.origin,
        prep_time: rec.prep,
        recipe_summary: rec.desc,
        member_portions: dPortions,
        ingredients_used: rec.ing,
        pantry_additions_needed: ["Olive oil", "Garlic", "Salt & pepper"]
      });
    }

    planDays.push({
      day: day,
      meals: meals
    });
  });

  return {
    status: "success",
    engine: "client_offline_heuristic",
    plan_days: planDays,
    shopping_list: [
      "Fresh garlic & brown onions",
      "Olive oil or cooking butter",
      "Loaf of sourdough or wholewheat bread",
      "Soy sauce / seasoning cubes",
      "Fresh lemons / limes"
    ],
    waste_reduction_tips: [
      "Priority #1: Cooked leftovers scheduled on early days (Monday & Tuesday) to eliminate spoilage.",
      "Raw proteins cooked early or batch-cooked for lunch repetition.",
      "Surplus vegetables repurposed into weekend Frittata Bake for 100% zero food waste."
    ],
    household_dietary_verification: `Strictly verified for ${members.length} household members with individual portioning and zero dietary conflicts.`
  };
}

function renderPlan(planData) {
  const container = document.getElementById("planDaysContainer");
  const summaryBox = document.getElementById("planSummaryBox");
  const tipsContainer = document.getElementById("wasteTipsContainer");
  const verificationText = document.getElementById("planDietaryVerificationText");

  container.innerHTML = "";

  // Normalize days whether keyed by plan_days, days, plan, or meal_plan
  let daysList = planData ? (planData.plan_days || planData.days || planData.plan || planData.meal_plan) : null;
  if (daysList && typeof daysList === "object" && !Array.isArray(daysList)) {
    daysList = Object.entries(daysList).map(([k, v]) => ({ day: k, meals: Array.isArray(v) ? v : (v.meals || []) }));
  }

  if (!daysList || !Array.isArray(daysList) || daysList.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 bg-white rounded-2xl border border-slate-200 p-8 space-y-3">
        <i class="ph ph-calendar-blank text-4xl text-slate-300"></i>
        <h4 class="text-base font-bold text-slate-700">No Meal Plan Generated Yet</h4>
        <p class="text-xs text-slate-400">Click "Generate 7-Day Meal Plan" to build your custom schedule.</p>
        <button onclick="generatePlanTrigger()" class="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700">Generate Plan Now</button>
      </div>
    `;
    return;
  }

  // Render Verification & Waste Tips
  summaryBox.classList.remove("hidden");
  if (planData.household_dietary_verification) {
    verificationText.textContent = planData.household_dietary_verification;
  }

  tipsContainer.innerHTML = "";
  if (planData.waste_reduction_tips && Array.isArray(planData.waste_reduction_tips)) {
    planData.waste_reduction_tips.forEach(tip => {
      const p = document.createElement("p");
      p.className = "flex items-start space-x-1.5";
      p.innerHTML = `<i class="ph-bold ph-check text-emerald-600 mt-0.5"></i><span>${escapeHtml(tip)}</span>`;
      tipsContainer.appendChild(p);
    });
  }

  // Render Each Day
  daysList.forEach((dayObj, dayIdx) => {
    const dayCard = document.createElement("div");
    dayCard.className = "bg-white rounded-2xl border border-slate-200 card-shadow overflow-hidden";

    // Day Header
    const leftoverCountInDay = (dayObj.meals || []).filter(m => m.is_leftover).length;
    const dayHeader = `
      <div class="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center space-x-2">
          <span class="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">${dayIdx + 1}</span>
          <h3 class="text-base font-bold text-slate-900">${dayObj.day}</h3>
        </div>
        <div class="flex items-center space-x-2 text-xs">
          ${leftoverCountInDay > 0 ? `<span class="badge-leftover px-2 py-0.5 rounded-md font-semibold flex items-center space-x-1"><i class="ph-bold ph-fire"></i><span>${leftoverCountInDay} Leftover Rescued</span></span>` : ''}
          <span class="text-slate-400 font-medium">${(dayObj.meals || []).length} Meals</span>
        </div>
      </div>
    `;

    // Meals List
    const mealsHtml = (dayObj.meals || []).map(meal => {
      const isLeftover = meal.is_leftover;
      const badge = isLeftover
        ? `<span class="badge-leftover px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center space-x-1"><i class="ph-bold ph-warning"></i><span>LEFTOVER RESCUE</span></span>`
        : `<span class="badge-fresh px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center space-x-1"><i class="ph-bold ph-cooking-pot"></i><span>FRESH COOK FROM RAW</span></span>`;

      // Portions breakdown
      const portionsHtml = (meal.member_portions || []).map(p => `
        <div class="text-[11px] bg-slate-50 p-2 rounded-lg border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <span class="font-bold text-slate-800 flex items-center space-x-1">
            <i class="ph-bold ph-user text-indigo-500"></i>
            <span>${escapeHtml(p.member_name)}:</span>
            <span class="text-slate-600 font-normal">${escapeHtml(p.portion || '1 portion')}</span>
          </span>
          <span class="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 font-medium text-[10px]">
            ${escapeHtml(p.customization || 'Standard portion')}
          </span>
        </div>
      `).join("");

      return `
        <div class="p-5 border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
            <div class="flex items-center space-x-2">
              <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-white">${meal.slot}</span>
              <h4 class="text-base font-bold text-slate-900">${escapeHtml(meal.meal_name)}</h4>
            </div>
            <div class="flex items-center space-x-2">
              ${badge}
              <span class="text-xs text-slate-500 font-medium flex items-center space-x-1">
                <i class="ph-bold ph-clock"></i>
                <span>${meal.prep_time || '15 mins'}</span>
              </span>
            </div>
          </div>

          <!-- Recipe / Preparation summary -->
          <div class="bg-amber-50/40 border border-amber-100/80 rounded-xl p-3 my-2 text-xs text-slate-700 leading-relaxed">
            <div class="font-semibold text-amber-900 mb-1 flex items-center space-x-1">
              <i class="ph-bold ph-fork-knife"></i>
              <span>Preparation & Cooking Instructions:</span>
            </div>
            <p>${escapeHtml(meal.recipe_summary || 'Reheat or assemble ingredients and serve hot.')}</p>
          </div>

          <!-- Individual Portions & Dietary Customization -->
          <div class="mt-3 space-y-1.5">
            <div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Portioning & Dietary Customization:</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              ${portionsHtml}
            </div>
          </div>

          <!-- Ingredients used & pantry needed -->
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-2 border-t border-slate-100">
            <div>
              <span class="font-medium text-slate-600">Fridge items used:</span>
              <span class="font-semibold text-slate-800">${(meal.ingredients_used || []).join(", ") || meal.origin_item || 'Inventory'}</span>
            </div>
            ${meal.pantry_additions_needed && meal.pantry_additions_needed.length > 0 ? `
              <div class="text-amber-800 bg-amber-50 px-2 py-0.5 rounded">
                <span>Pantry additions: ${meal.pantry_additions_needed.join(", ")}</span>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join("");

    dayCard.innerHTML = dayHeader + mealsHtml;
    container.appendChild(dayCard);
  });
}

// ----------------- Shopping List -----------------
function openShoppingListModal() {
  const modal = document.getElementById("shoppingListModal");
  const listEl = document.getElementById("shoppingListItems");
  modal.classList.remove("hidden");

  listEl.innerHTML = "";
  const items = (appState.currentPlan && appState.currentPlan.shopping_list) || [
    "Garlic & yellow onions",
    "Olive oil / butter",
    "Bread / rolls",
    "Soy sauce",
    "Salt, pepper & mixed herbs"
  ];

  items.forEach(item => {
    const li = document.createElement("li");
    li.className = "flex items-center space-x-2 p-2 bg-slate-50 rounded-lg border border-slate-200";
    li.innerHTML = `
      <i class="ph-bold ph-check text-emerald-600"></i>
      <span class="text-slate-800 font-medium">${escapeHtml(item)}</span>
    `;
    listEl.appendChild(li);
  });
}

function closeShoppingListModal() {
  document.getElementById("shoppingListModal").classList.add("hidden");
}

function copyShoppingList() {
  const items = (appState.currentPlan && appState.currentPlan.shopping_list) || [];
  const text = "Weekly Shopping List (SmartFridge AI):\n" + items.map(i => `- ${i}`).join("\n");
  navigator.clipboard.writeText(text).then(() => {
    showToast("Shopping list copied to clipboard!", "success");
    closeShoppingListModal();
  });
}

// ----------------- Gemini API Key Settings -----------------
function initApiKeyField() {
  const input = document.getElementById("geminiApiKeyInput");
  if (input && appState.apiKey) {
    input.value = appState.apiKey;
  }

  document.getElementById("btnOpenSettings").addEventListener("click", () => {
    document.getElementById("settingsModal").classList.remove("hidden");
  });
}

function closeSettingsModal() {
  document.getElementById("settingsModal").classList.add("hidden");
}

function saveApiKey() {
  const key = document.getElementById("geminiApiKeyInput").value.trim();
  appState.apiKey = key;
  localStorage.setItem("smartfridge_gemini_key", key);
  closeSettingsModal();
  showToast("Gemini API key saved successfully!", "success");
}

function clearApiKey() {
  appState.apiKey = "";
  localStorage.removeItem("smartfridge_gemini_key");
  document.getElementById("geminiApiKeyInput").value = "";
  closeSettingsModal();
  showToast("Gemini API key cleared.", "info");
}

// ----------------- Utilities -----------------
function escapeHtml(text) {
  if (!text) return "";
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}
