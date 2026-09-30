# SmartFridge AI - Household Meal & Leftovers Planner
### Vision-Powered Food Waste Reduction & Personalized Family 7-Day Meal Planner

A full-stack, AI-powered application designed to turn your fridge's contents (cooked leftovers and raw ingredients) into an optimized, zero-waste 7-day family meal plan that strictly honors the dietary requirements, ages, sexes, and meal schedules of every household member.

---

## 🌟 Key Features

### 1. Multimodal Fridge & Leftover Recognition
- **Photo Upload & Live Webcam Capture**: Take a snapshot of your fridge shelves using your phone/laptop camera or upload JPG/PNG/WEBP images.
- **Cooked Leftovers vs. Raw Ingredients Categorization**:
  - **Cooked Leftovers** (🚨 *Top Priority*): Automatically flagged with high urgency to be consumed in 1–2 days before spoiling.
  - **Raw Ingredients** (🥦 *Fresh & Perishable*): Flagged with shelf-life and portion counts.
- **Powered by Gemini 2.5 Flash Multimodal Vision**: Deeply identifies food containers, fresh produce, meats, dairy, and leftovers.
- **Smart Offline Fallback Mode**: Even without an API key configured yet, test immediately with realistic sample fridge items and heuristic planning.

### 2. Tailored Household Profiles (Age, Sex, Dietary Needs & Meal Counts)
- Customize every person in your house:
  - **Age & Sex**: Adjusts portion size, calorie targets, and nutritional density (e.g. child 8yo vs adult active male).
  - **Dietary Restrictions & Preferences**: Presets for Vegetarian, Vegan, Halal, Kosher, Gluten-Free, Dairy-Free, Low-Carb / Keto, High-Protein, Nut-Free, Diabetic-Friendly, plus custom allergy notes.
  - **Daily Meals Eaten**: Select which meals each member eats (Breakfast, Lunch, Dinner, Snack).
  - **Safety Check**: Ensures individuals with allergies or dietary restrictions are never assigned conflicting meals, automatically providing vegetarian/allergy-safe alternatives.

### 3. Leftovers Prioritization & Raw Ingredient Meal Crafting
- **Zero-Waste Leftover Rescue**: Leftovers are automatically scheduled for early days (Monday / Tuesday) to eliminate spoilage.
- **Recipes for Raw Ingredients**: Fresh raw ingredients (chicken breast, broccoli, bell peppers, eggs, cheese) are turned into step-by-step recipes with prep times and cooking instructions.
- **Meal Repetition & Batch Cooking**: Allows dishes to be repeated across the week (e.g. batch cooking dinner and having the remainder for lunch).
- **Individual Portion Breakdown**: Every single meal card shows who eats what and the specific portion / dietary tweak for each member.

### 4. Utilities
- **Weekly Shopping List**: Generates a consolidated list of minor pantry staples needed.
- **Print / PDF Ready**: Clean printer layout for sticking your weekly meal schedule on the fridge!
- **Local Storage Persistence**: Household members and fridge inventories are automatically saved in your browser.

---

## 🚀 Quick Start

### 1. Run the App
Double-click `run_fridge_planner.bat` in `C:\Anil Google Projects` or inside `smart-fridge-planner\run_planner.bat`:
```bash
cd "C:\Anil Google Projects\smart-fridge-planner"
python server.py
```
Open your browser at **`http://localhost:8050`**.

### 2. Configure Google Gemini API Key (Optional)
- You can add your API key to `.env` in `C:\Anil Google Projects\.env`:
  ```ini
  GEMINI_API_KEY=AIzaSy...
  ```
- Or click **"Gemini Key"** in the top right corner of the web application to save it directly in your browser.
*(If no key is entered, the app seamlessly runs in smart heuristic mode with sample data so you can test all features right away!)*

### 3. Test in 1-Click
1. In the **Household Profiles** tab, click **"Load Sample Family"** (Anil 42M Halal/High-Protein, Sarah 39F Veg/Low-Carb, Leo 8M Nut-Free Child).
2. In the **Fridge Snapshot & Inventory** tab, click **"Quick Sample Fridge"** (or upload your own photo).
3. Click **"Generate 7-Day Meal Plan"** to see the 7-day schedule with portions, recipes, and leftover priority!

---

## 🧪 Testing
Run the automated test suite anytime:
```bash
python test_fridge_planner.py
```
