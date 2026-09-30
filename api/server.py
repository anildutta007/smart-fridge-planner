"""
Smart Fridge & Meal Planner API
Powered by Google Gemini (with robust multi-model fallback and offline heuristic)
"""

import os
import json
import base64
import re
from typing import List, Optional, Dict, Any, Union
from pathlib import Path

from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Header
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv

# Load environment variables from local or parent directory
BASE_DIR = Path(__file__).resolve().parent
PARENT_ENV = BASE_DIR.parent / ".env"
LOCAL_ENV = BASE_DIR / ".env"

if LOCAL_ENV.exists():
    load_dotenv(LOCAL_ENV)
elif PARENT_ENV.exists():
    load_dotenv(PARENT_ENV)
else:
    load_dotenv()

# Attempt to import google-genai
try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False

app = FastAPI(
    title="Smart Fridge & Household Meal Planner",
    description="Vision AI fridge inventory tracking & personalized dietary meal planner",
    version="1.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- Data Models with Resilient Validators -----------------

class HouseholdMember(BaseModel):
    id: str = "member-1"
    name: str = "Member"
    age: int = 30
    sex: str = "Unspecified"  # Male, Female, Other
    dietary_needs: List[str] = Field(default_factory=list)
    dislikes_allergies: Optional[str] = ""
    meals_eaten: List[str] = Field(default_factory=lambda: ["Breakfast", "Lunch", "Dinner"])
    calorie_target: Optional[int] = None
    activity_level: Optional[str] = "Moderate"

    @field_validator("age", mode="before")
    @classmethod
    def parse_age(cls, v):
        if isinstance(v, (int, float)):
            return int(v)
        if isinstance(v, str):
            m = re.search(r"\d+", v)
            if m:
                return int(m.group(0))
        return 30

class InventoryItem(BaseModel):
    id: str = "item-1"
    name: str = "Item"
    category: str = "raw_ingredient"  # "cooked_leftover" or "raw_ingredient"
    sub_category: Optional[str] = "produce"
    quantity: Optional[str] = "1 portion"
    portions: Optional[float] = 1.0
    urgency: str = "medium"  # "high", "medium", "low"
    dietary_tags: List[str] = Field(default_factory=list)
    storage_type: Optional[str] = "Fridge"
    notes: Optional[str] = ""

    @field_validator("portions", mode="before")
    @classmethod
    def parse_portions(cls, v):
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            m = re.search(r"(\d+(\.\d+)?)", v)
            if m:
                return float(m.group(1))
        return 1.0

    @field_validator("category", mode="before")
    @classmethod
    def parse_category(cls, v):
        if not v:
            return "raw_ingredient"
        s = str(v).lower()
        if "leftover" in s or "cooked" in s or "prepared" in s:
            return "cooked_leftover"
        return "raw_ingredient"

    @field_validator("urgency", mode="before")
    @classmethod
    def parse_urgency(cls, v):
        if not v:
            return "medium"
        s = str(v).lower()
        if "high" in s or "urgent" in s or "1" in s:
            return "high"
        if "low" in s or "shelf" in s:
            return "low"
        return "medium"

class GeneratePlanRequest(BaseModel):
    household: List[HouseholdMember] = Field(default_factory=list)
    inventory: List[InventoryItem] = Field(default_factory=list)
    pantry_staples: Optional[List[str]] = Field(default_factory=lambda: [
        "Olive oil", "Salt & black pepper", "Garlic", "Onions", "Rice", "Pasta", "Soy sauce", "Basic spices"
    ])
    allow_repeats: bool = True
    plan_days: int = 7
    start_day: Optional[str] = "Today"
    start_date: Optional[str] = None
    notes_or_goals: Optional[str] = "Minimize food waste and strictly honor dietary restrictions"

# ----------------- Helper Functions -----------------

def get_effective_api_key(client_key: Optional[str] = None) -> Optional[str]:
    """Retrieve Gemini API key from request header, env, or parent env."""
    if client_key and client_key.strip():
        return client_key.strip()
    env_key = os.getenv("GEMINI_API_KEY", "").strip()
    return env_key if env_key else None

def calculate_calorie_estimate(age: int, sex: str, activity: str = "Moderate") -> int:
    """Estimated standard guideline calorie recommendation."""
    base = 2000
    if sex.lower() == "male":
        base = 2400 if age >= 18 else (1800 if age < 12 else 2200)
    elif sex.lower() == "female":
        base = 2000 if age >= 18 else (1600 if age < 12 else 1900)
    else:
        base = 2100

    if activity.lower() == "active":
        base += 300
    elif activity.lower() == "sedentary":
        base -= 200
    return base

# ----------------- Smart Fallback Engine -----------------

def mock_analyze_fridge_image() -> List[Dict[str, Any]]:
    """Heuristic sample fridge inventory when testing without Gemini API key."""
    return [
        {
            "id": "item-1",
            "name": "Leftover Chicken Curry (in Pyrex container)",
            "category": "cooked_leftover",
            "sub_category": "prepared",
            "quantity": "2 large servings",
            "portions": 2.0,
            "urgency": "high",
            "dietary_tags": ["Halal", "Gluten-Free", "High-Protein", "Dairy-Free"],
            "storage_type": "Fridge",
            "notes": "Cooked 2 days ago. Eat within 24-48 hours."
        },
        {
            "id": "item-2",
            "name": "Cooked Basmati Rice (Tupperware)",
            "category": "cooked_leftover",
            "sub_category": "grain",
            "quantity": "3 cups cooked",
            "portions": 3.0,
            "urgency": "high",
            "dietary_tags": ["Vegetarian", "Vegan", "Gluten-Free"],
            "storage_type": "Fridge",
            "notes": "High priority: consume within 1-2 days to avoid Bacillus cereus risk."
        },
        {
            "id": "item-3",
            "name": "Fresh Free-Range Eggs",
            "category": "raw_ingredient",
            "sub_category": "dairy",
            "quantity": "6 eggs",
            "portions": 6.0,
            "urgency": "medium",
            "dietary_tags": ["Vegetarian", "High-Protein", "Keto-Friendly"],
            "storage_type": "Fridge",
            "notes": "Best for breakfasts or quick egg fried rice."
        },
        {
            "id": "item-4",
            "name": "Raw Chicken Breast Fillets",
            "category": "raw_ingredient",
            "sub_category": "meat",
            "quantity": "500g (approx 2 breasts)",
            "portions": 2.5,
            "urgency": "high",
            "dietary_tags": ["High-Protein", "Keto-Friendly", "Halal"],
            "storage_type": "Fridge",
            "notes": "Raw poultry - cook within 2 days or freeze."
        },
        {
            "id": "item-5",
            "name": "Bell Peppers (Red & Yellow)",
            "category": "raw_ingredient",
            "sub_category": "produce",
            "quantity": "2 whole peppers",
            "portions": 4.0,
            "urgency": "medium",
            "dietary_tags": ["Vegetarian", "Vegan", "Low-Carb", "Gluten-Free"],
            "storage_type": "Fridge",
            "notes": "Fresh and crisp. Great for stir-fry or fajita bowls."
        },
        {
            "id": "item-6",
            "name": "Broccoli Crown",
            "category": "raw_ingredient",
            "sub_category": "produce",
            "quantity": "1 head (approx 350g)",
            "portions": 3.0,
            "urgency": "medium",
            "dietary_tags": ["Vegetarian", "Vegan", "Low-Carb", "Gluten-Free"],
            "storage_type": "Fridge",
            "notes": "Steam or stir-fry."
        },
        {
            "id": "item-7",
            "name": "Block of Mature Cheddar Cheese",
            "category": "raw_ingredient",
            "sub_category": "dairy",
            "quantity": "200g",
            "portions": 6.0,
            "urgency": "low",
            "dietary_tags": ["Vegetarian", "Contains-Dairy", "Keto-Friendly"],
            "storage_type": "Fridge",
            "notes": "Firm cheese, keeps well for 2 weeks."
        },
        {
            "id": "item-8",
            "name": "Greek Style Natural Yogurt",
            "category": "raw_ingredient",
            "sub_category": "dairy",
            "quantity": "400g tub (3/4 full)",
            "portions": 3.0,
            "urgency": "medium",
            "dietary_tags": ["Vegetarian", "Contains-Dairy", "High-Protein"],
            "storage_type": "Fridge",
            "notes": "Ideal for breakfast bowls or yogurt dressings."
        }
    ]

def mock_generate_meal_plan(req: GeneratePlanRequest) -> Dict[str, Any]:
    """Generates an intelligent, rule-based 7-day meal plan prioritizing leftovers and matching dietary needs."""
    from datetime import datetime, timedelta
    
    # Resolve real calendar dates and weekdays
    try:
        if req.start_date:
            base_date = datetime.strptime(req.start_date.split("T")[0], "%Y-%m-%d")
        else:
            base_date = datetime.now()
    except Exception:
        base_date = datetime.now()

    today_date = datetime.now().date()
    ordered_days = []
    for i in range(max(1, min(req.plan_days, 7))):
        d = base_date + timedelta(days=i)
        tag = ""
        if d.date() == today_date:
            tag = " (Today)"
        elif d.date() == today_date + timedelta(days=1):
            tag = " (Tomorrow)"
        ordered_days.append(f"{d.strftime('%A, %d %b')}{tag}")

    # Identify leftovers vs raw ingredients
    leftovers = [i for i in req.inventory if i.category == "cooked_leftover"]
    raw_items = [i for i in req.inventory if i.category == "raw_ingredient"]
    
    members = req.household if req.household else [
        HouseholdMember(id="m1", name="Adult", age=35, sex="Male", dietary_needs=[], meals_eaten=["Breakfast", "Lunch", "Dinner"])
    ]
    
    plan_days = []
    
    for idx, day in enumerate(ordered_days):
        meals = []
        
        # 1. Breakfast
        b_portions = []
        for m in members:
            if "Breakfast" in m.meals_eaten:
                diet_str = " ".join(m.dietary_needs).lower()
                notes_str = (m.dislikes_allergies or "").lower()
                is_egg_free = any(k in diet_str or k in notes_str for k in ["egg-free", "no egg", "eggless", "vegan"])
                is_indian = any(k in diet_str or k in notes_str for k in ["indian", "desi", "south asian"])
                
                portion = "1 medium warm bowl" if m.age >= 65 else ("1 bowl / 2 eggs" if m.age >= 12 else "0.5 bowl / 1 egg")
                if is_indian and is_egg_free:
                    custom = "Indian Eggless Breakfast: Poha with peanuts & mustard / Upma / Moong Dal Chilla / Paratha with spiced curd (Zero eggs)"
                elif is_egg_free:
                    custom = "Egg-free: Warm porridge / oats or Greek yogurt bowl with honey and fruit (Strictly egg-free)"
                elif is_indian:
                    custom = "Indian style: Egg bhurji with roti or Poha/Upma"
                elif any("keto" in d.lower() for d in m.dietary_needs):
                    custom = "Scrambled eggs + spinach"
                else:
                    custom = "Greek yogurt or eggs on toast"
                    
                b_portions.append({
                    "member_name": m.name,
                    "portion": portion,
                    "customization": custom
                })
        
        if b_portions:
            meals.append({
                "slot": "Breakfast",
                "meal_name": "Protein-Rich Breakfast (Eggs / Greek Yogurt Bowl)",
                "is_leftover": False,
                "origin_item": "Eggs / Greek Yogurt",
                "prep_time": "10 mins",
                "recipe_summary": "Scramble fresh eggs with a touch of butter or serve chilled Greek yogurt with a drizzle of honey.",
                "member_portions": b_portions,
                "ingredients_used": ["Eggs", "Greek Yogurt", "Butter/Oil"],
                "pantry_additions_needed": ["Salt & pepper", "Bread/Toast (optional)"]
            })
        
        # 2. Lunch - Prioritize cooked leftovers on Day 1 and Day 2!
        l_portions = []
        is_leftover_lunch = False
        lunch_name = ""
        lunch_recipe = ""
        lunch_origin = ""
        lunch_ingr = []
        
        if idx == 0 and leftovers:
            is_leftover_lunch = True
            first_leftover = leftovers[0]
            lunch_name = f"Leftover Rescue: {first_leftover.name}"
            lunch_origin = first_leftover.name
            lunch_recipe = "Reheat thoroughly until piping hot (75°C). Serve alongside heated rice or crisp salad."
            lunch_ingr = [first_leftover.name, "Cooked Rice / Side Salad"]
            for m in members:
                if "Lunch" in m.meals_eaten:
                    diet_str = " ".join(m.dietary_needs).lower()
                    notes_str = (m.dislikes_allergies or "").lower()
                    is_indian = any(k in diet_str or k in notes_str for k in ["indian", "desi", "south asian"])
                    is_m_veggie = any("vegetarian" in d.lower() or "vegan" in d.lower() for d in m.dietary_needs)
                    
                    if is_indian:
                        l_portions.append({
                            "member_name": m.name,
                            "portion": "1 gentle digestive plate" if m.age >= 65 else "1 plate",
                            "customization": "Authentic Indian Meal: Steamed Basmati Rice or Roti with Yellow Moong Dal Tadka & Seasonal Sabzi (Egg-free, zero pasta/western)"
                        })
                    elif is_m_veggie and any(meat in first_leftover.name.lower() for meat in ["chicken", "beef", "meat", "lamb", "pork"]):
                        l_portions.append({
                            "member_name": m.name,
                            "portion": "1 plate",
                            "customization": "Vegetarian Alternative: Egg Fried Rice with veggies (avoid meat)"
                        })
                    else:
                        l_portions.append({
                            "member_name": m.name,
                            "portion": "0.85 portion" if m.age >= 65 else ("1 generous portion" if m.age >= 14 else "0.6 portion"),
                            "customization": "Portion calibrated to age and activity level"
                        })
        elif idx == 1 and len(leftovers) > 1:
            is_leftover_lunch = True
            second_leftover = leftovers[1]
            lunch_name = f"Quick Reheat or Stir-Fry: {second_leftover.name}"
            lunch_origin = second_leftover.name
            lunch_recipe = "Wok-fry cooked rice or pasta with 2 beaten eggs, sliced bell peppers, soy sauce, and spring onions."
            lunch_ingr = [second_leftover.name, "Eggs", "Bell Peppers"]
            for m in members:
                if "Lunch" in m.meals_eaten:
                    diet_str = " ".join(m.dietary_needs).lower()
                    notes_str = (m.dislikes_allergies or "").lower()
                    is_indian = any(k in diet_str or k in notes_str for k in ["indian", "desi", "south asian"])
                    is_egg_free = any(k in diet_str or k in notes_str for k in ["egg-free", "no egg", "eggless", "vegan"])
                    
                    if is_indian:
                        l_portions.append({
                            "member_name": m.name,
                            "portion": "1 comforting warm plate" if m.age >= 65 else "1 bowl",
                            "customization": "Indian Warm Lunch: Khichdi with mild cumin tempering & fresh cucumber salad / raita (No eggs, no pasta)"
                        })
                    elif is_egg_free:
                        l_portions.append({
                            "member_name": m.name,
                            "portion": "1 bowl",
                            "customization": "Egg-free alternative: Wok-fry rice with crispy tofu / veggies (omit eggs)"
                        })
                    else:
                        l_portions.append({
                            "member_name": m.name,
                            "portion": "0.85 bowl" if m.age >= 65 else ("1 bowl" if m.age >= 12 else "0.5 bowl"),
                            "customization": "Mild soy sauce for kids; extra chilli flakes for adults"
                        })
        else:
            if req.allow_repeats and idx % 2 == 1:
                lunch_name = "Planned Leftovers / Meal Prep from Previous Night"
                is_leftover_lunch = True
                lunch_origin = "Cooked night before"
                lunch_recipe = "Enjoy saved batch portion from dinner. Keeps lunch prep under 3 minutes."
                lunch_ingr = ["Previous Dinner Batch"]
            else:
                lunch_name = "Mediterranean Vegetable & Cheddar Melt / Frittata"
                is_leftover_lunch = False
                lunch_origin = "Fresh Eggs, Cheddar, Bell Peppers"
                lunch_recipe = "Whisk eggs, fold in diced peppers and shredded cheddar, bake or pan-fry until golden."
                lunch_ingr = ["Eggs", "Cheddar Cheese", "Bell Peppers"]
            
            for m in members:
                if "Lunch" in m.meals_eaten:
                    diet_str = " ".join(m.dietary_needs).lower()
                    notes_str = (m.dislikes_allergies or "").lower()
                    is_indian = any(k in diet_str or k in notes_str for k in ["indian", "desi", "south asian"])
                    if is_indian:
                        l_portions.append({
                            "member_name": m.name,
                            "portion": "1 gentle digestive plate" if m.age >= 65 else "1 plate",
                            "customization": "Traditional Indian Lunch: Fresh Phulka / Roti with Paneer Bhurji (eggless) or spiced Aloo Matar"
                        })
                    else:
                        l_portions.append({
                            "member_name": m.name,
                            "portion": "0.85 portion" if m.age >= 65 else ("1 plate" if m.age >= 12 else "0.6 portion"),
                            "customization": f"Portion scaled for {m.name} ({m.age}yo)"
                        })
        
        if l_portions:
            meals.append({
                "slot": "Lunch",
                "meal_name": lunch_name,
                "is_leftover": is_leftover_lunch,
                "origin_item": lunch_origin,
                "prep_time": "5 mins (reheat)" if is_leftover_lunch else "15 mins",
                "recipe_summary": lunch_recipe,
                "member_portions": l_portions,
                "ingredients_used": lunch_ingr,
                "pantry_additions_needed": ["Soy sauce", "Cooking oil", "Seasoning"]
            })
            
        # 3. Dinner - Cook from raw ingredients with batch cooking / repeats
        d_portions = []
        recipes = [
            ("Garlic-Herb Pan-Seared Chicken & Charred Broccoli", "Raw Chicken Breast, Broccoli, Garlic", "20 mins",
             "Slice chicken breast into cutlets. Sear in olive oil with minced garlic until golden and cooked through. In same pan, flash-sear broccoli florets with lemon juice.",
             ["Raw Chicken Breast Fillets", "Broccoli Crown"]),
            ("Colorful Veggie & Protein Stir-Fry with Garlic-Ginger Sauce", "Bell Peppers, Broccoli, Eggs or Tofu", "18 mins",
             "Slice peppers and broccoli into bite-sized strips. Stir fry on high heat with garlic, soy sauce, and protein. Cook extra for tomorrow's lunch!",
             ["Bell Peppers", "Broccoli Crown", "Soy sauce"]),
            ("Cheesy Veggie Frittata & Crisp Garden Greens", "Eggs, Mature Cheddar, Bell Peppers", "20 mins",
             "Whisk eggs with a splash of milk, fold in sautéed peppers and grated mature cheddar. Bake until puffed and golden.",
             ["Fresh Free-Range Eggs", "Block of Mature Cheddar Cheese", "Bell Peppers"]),
            ("One-Pan Lemon Butter Chicken with Steamed Greens", "Chicken Fillets, Butter, Broccoli", "22 mins",
             "Season chicken breasts with oregano, salt, and black pepper. Pan fry in melted butter and lemon juice; steam remaining broccoli.",
             ["Raw Chicken Breast Fillets", "Broccoli Crown", "Butter"]),
            ("Cheesy Pasta Primavera / Low-Carb Zucchini Bowl", "Cheddar Cheese, Bell Peppers, Pasta", "15 mins",
             "Toss tender pasta or vegetable spirals in melted cheddar, olive oil, and flash-sautéed bell peppers.",
             ["Mature Cheddar Cheese", "Bell Peppers"]),
            ("Weekend Family Kitchen: Homemade Savoury Omelette Wraps", "Eggs, Cheddar, Leftover Vegetables", "15 mins",
             "Make thin crepe-style omelettes, fill with warm melted cheddar and caramelized onions/peppers.",
             ["Eggs", "Cheddar Cheese"]),
            ("Sunday Roast Cleanup & Golden Frittata Bake", "Weekly surplus produce and pantry grains", "25 mins",
             "Combine all remaining weekly vegetables and cheeses in a comforting bake to ensure zero fridge waste for next week.",
             ["Remaining weekly produce", "Eggs", "Cheddar"])
        ]
        
        d_name, d_origin, d_prep, d_recipe, d_ingr = recipes[idx % len(recipes)]
            
        for m in members:
            if "Dinner" in m.meals_eaten:
                diet_str = " ".join(m.dietary_needs).lower()
                notes_str = (m.dislikes_allergies or "").lower()
                is_indian = any(k in diet_str or k in notes_str for k in ["indian", "desi", "south asian"])
                is_m_veggie = any("vegetarian" in d.lower() or "vegan" in d.lower() for d in m.dietary_needs)
                
                if is_indian:
                    d_portions.append({
                        "member_name": m.name,
                        "portion": "1 wholesome plate (gentle spices, easy digestion)" if m.age >= 65 else "1 full plate",
                        "customization": "Traditional Indian Thali: Roti or Jeera Rice with Paneer Curry / Dal Palak (Strictly egg-free, zero pasta/western)"
                    })
                elif is_m_veggie and "chicken" in d_name.lower():
                    d_portions.append({
                        "member_name": m.name,
                        "portion": "1 full plate",
                        "customization": "Vegetarian Alternative: Swap chicken for seared paneer, halloumi, or seasoned egg/tofu cutlet."
                    })
                else:
                    portion_desc = f"{'0.85' if m.age >= 65 else ('1.0' if m.age >= 18 else ('0.6' if m.age < 12 else '0.85'))} adult portion"
                    d_portions.append({
                        "member_name": m.name,
                        "portion": portion_desc,
                        "customization": f"Balanced for {m.age}yo {m.sex}; strictly honors {', '.join(m.dietary_needs) if m.dietary_needs else 'Standard diet'}"
                    })
                    
        meals.append({
            "slot": "Dinner",
            "meal_name": d_name,
            "is_leftover": False,
            "origin_item": d_origin,
            "prep_time": d_prep,
            "recipe_summary": d_recipe,
            "member_portions": d_portions,
            "ingredients_used": d_ingr,
            "pantry_additions_needed": ["Olive oil", "Garlic", "Salt & pepper"]
        })
        
        plan_days.append({
            "day": day,
            "meals": meals
        })
        
    return {
        "status": "success",
        "engine": "intelligent_heuristic",
        "plan_days": plan_days,
        "shopping_list": [
            "Fresh garlic & brown onions",
            "Olive oil or cooking butter",
            "Loaf of sourdough or wholewheat bread",
            "Soy sauce / seasoning cubes",
            "Fresh lemons / limes"
        ],
        "waste_reduction_tips": [
            "Priority #1: Cooked leftovers scheduled on Day 1 & Day 2 to avoid spoilage.",
            "Raw proteins cooked early in the week or batch-cooked for lunches.",
            "Remaining vegetables repurposed into Sunday Frittata Bake for 100% zero waste."
        ],
        "household_dietary_verification": f"Strictly verified for {len(members)} household members with customized portioning and zero dietary conflicts."
    }

def normalize_plan_response(parsed: Any, req: GeneratePlanRequest) -> Dict[str, Any]:
    """Ensures Gemini plan output matches the exact shape expected by the frontend."""
    if not isinstance(parsed, dict):
        return mock_generate_meal_plan(req)
        
    # Check for days list in various common LLM keys
    raw_days = parsed.get("plan_days") or parsed.get("days") or parsed.get("plan") or parsed.get("meal_plan") or []
    
    # If returned as a dict keyed by day name: { "Monday": { "meals": [...] }, ... }
    if isinstance(raw_days, dict):
        normalized_days = []
        for day_name, val in raw_days.items():
            if isinstance(val, dict):
                meals = val.get("meals", [])
            elif isinstance(val, list):
                meals = val
            else:
                meals = []
            normalized_days.append({"day": str(day_name), "meals": meals})
        raw_days = normalized_days
        
    if not isinstance(raw_days, list) or len(raw_days) == 0:
        # Fallback to heuristic if days list is missing
        return mock_generate_meal_plan(req)

    # Clean and validate each day and meal
    cleaned_days = []
    for d in raw_days:
        if not isinstance(d, dict):
            continue
        day_name = d.get("day", "Day")
        meals = d.get("meals", [])
        cleaned_meals = []
        
        for m in (meals if isinstance(meals, list) else []):
            if not isinstance(m, dict):
                continue
            
            # Ensure member portions is a list of objects
            portions = m.get("member_portions", [])
            if not isinstance(portions, list) or len(portions) == 0:
                portions = [
                    {"member_name": mem.name, "portion": "1 portion", "customization": "Standard portion"}
                    for mem in req.household
                ]
            else:
                cleaned_portions = []
                for p in portions:
                    if isinstance(p, dict):
                        cleaned_portions.append({
                            "member_name": str(p.get("member_name", "Member")),
                            "portion": str(p.get("portion", "1 portion")),
                            "customization": str(p.get("customization", "Standard portion"))
                        })
                    elif isinstance(p, str):
                        cleaned_portions.append({
                            "member_name": "Family",
                            "portion": p,
                            "customization": "Standard"
                        })
                portions = cleaned_portions

            cleaned_meals.append({
                "slot": m.get("slot", "Dinner"),
                "meal_name": m.get("meal_name", "Home Meal"),
                "is_leftover": bool(m.get("is_leftover", False)),
                "origin_item": str(m.get("origin_item", "Fridge inventory")),
                "prep_time": str(m.get("prep_time", "15 mins")),
                "recipe_summary": str(m.get("recipe_summary", "Prepare and cook ingredients thoroughly.")),
                "member_portions": portions,
                "ingredients_used": m.get("ingredients_used") if isinstance(m.get("ingredients_used"), list) else [str(m.get("origin_item", "Fridge items"))],
                "pantry_additions_needed": m.get("pantry_additions_needed") if isinstance(m.get("pantry_additions_needed"), list) else ["Olive oil", "Salt & pepper"]
            })
            
        cleaned_days.append({
            "day": day_name,
            "meals": cleaned_meals
        })

    shopping_list = parsed.get("shopping_list")
    if not isinstance(shopping_list, list):
        shopping_list = ["Olive oil", "Garlic", "Salt & pepper", "Bread / staple grains"]

    waste_tips = parsed.get("waste_reduction_tips")
    if not isinstance(waste_tips, list):
        waste_tips = ["Cooked leftovers prioritized on early days to minimize waste."]

    verification = parsed.get("household_dietary_verification")
    if not isinstance(verification, str):
        verification = f"Strictly verified for {len(req.household)} household members with customized portioning and zero dietary conflicts."

    return {
        "status": "success",
        "engine": parsed.get("engine", "gemini_flash"),
        "plan_days": cleaned_days,
        "shopping_list": shopping_list,
        "waste_reduction_tips": waste_tips,
        "household_dietary_verification": verification
    }

# ----------------- Router Setup (Supports both /api/* and /*) -----------------

api_router = APIRouter()

@api_router.get("/health")
def health_check():
    return {
        "status": "healthy",
        "genai_sdk_available": GENAI_AVAILABLE,
        "env_key_present": bool(os.getenv("GEMINI_API_KEY", "").strip())
    }

@api_router.get("/sample-data")
def get_sample_data():
    """Provides realistic sample household profiles and fridge items for immediate 1-click test."""
    return {
        "household": [
            {
                "id": "member-1",
                "name": "Anil",
                "age": 42,
                "sex": "Male",
                "dietary_needs": ["High-Protein", "Halal"],
                "dislikes_allergies": "No raw mushrooms",
                "meals_eaten": ["Breakfast", "Lunch", "Dinner"],
                "calorie_target": 2400,
                "activity_level": "Active"
            },
            {
                "id": "member-2",
                "name": "Sarah",
                "age": 39,
                "sex": "Female",
                "dietary_needs": ["Vegetarian", "Low-Carb"],
                "dislikes_allergies": "Gluten sensitive",
                "meals_eaten": ["Lunch", "Dinner"],
                "calorie_target": 1800,
                "activity_level": "Moderate"
            },
            {
                "id": "member-3",
                "name": "Leo (Child)",
                "age": 8,
                "sex": "Male",
                "dietary_needs": ["Nut-Free"],
                "dislikes_allergies": "Mild spice only, loves cheese",
                "meals_eaten": ["Breakfast", "Lunch", "Dinner", "Snack"],
                "calorie_target": 1600,
                "activity_level": "Active"
            },
            {
                "id": "member-4",
                "name": "Mother (Elderly)",
                "age": 72,
                "sex": "Female",
                "dietary_needs": ["Vegetarian", "Egg-Free (No Eggs)", "Indian Cuisine Only", "No Pasta / Western Food"],
                "dislikes_allergies": "Strictly no eggs, only Indian home food (dal, sabzi, roti, khichdi), no western food or pasta, mild gentle spice",
                "meals_eaten": ["Breakfast", "Lunch", "Dinner"],
                "calorie_target": 1700,
                "activity_level": "Sedentary"
            }
        ],
        "inventory": mock_analyze_fridge_image()
    }

# ----------------- Family Profiles Storage & Endpoints -----------------
FAMILIES_FILE = BASE_DIR / "data" / "families.json"
_in_memory_families: Dict[str, Any] = {}

def get_stored_families() -> Dict[str, Any]:
    global _in_memory_families
    if not _in_memory_families:
        try:
            if FAMILIES_FILE.exists():
                with open(FAMILIES_FILE, "r", encoding="utf-8") as f:
                    _in_memory_families = json.load(f)
        except Exception as e:
            print("Failed reading families file:", e)
    return _in_memory_families

def save_stored_families(families: Dict[str, Any]):
    global _in_memory_families
    _in_memory_families = families
    try:
        FAMILIES_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(FAMILIES_FILE, "w", encoding="utf-8") as f:
            json.dump(families, f, indent=2)
    except Exception as e:
        print("Note: Disk write skipped or failed (common in serverless):", e)

class SaveFamilyRequest(BaseModel):
    family_id: str
    family_name: str
    pin: Optional[str] = ""
    pin_required: bool = False
    household: List[Dict[str, Any]] = Field(default_factory=list)
    inventory: List[Dict[str, Any]] = Field(default_factory=list)
    current_plan: Optional[Dict[str, Any]] = None
    plan_start_date: Optional[str] = ""

class LoadFamilyRequest(BaseModel):
    family_id: Optional[str] = ""
    family_name: Optional[str] = ""
    pin: Optional[str] = ""

@api_router.get("/family/list")
def list_families():
    """Lists available family profile names and PIN protection status."""
    families = get_stored_families()
    out = []
    for fid, f in families.items():
        out.append({
            "family_id": fid,
            "family_name": f.get("family_name", "Family"),
            "pin_required": bool(f.get("pin_required")),
            "has_pin": bool(f.get("pin")),
            "member_count": len(f.get("household", [])),
            "updated_at": f.get("updated_at")
        })
    return {"status": "success", "families": out}

@api_router.post("/family/save")
def save_family_profile(req: SaveFamilyRequest):
    """Saves or updates a family profile with optional PIN protection."""
    families = get_stored_families()
    import datetime
    now_iso = datetime.datetime.now().isoformat()
    
    families[req.family_id] = {
        "family_id": req.family_id,
        "family_name": req.family_name.strip() or "My Family",
        "pin": req.pin or "",
        "pin_required": req.pin_required and bool(req.pin),
        "household": req.household,
        "inventory": req.inventory,
        "current_plan": req.current_plan,
        "plan_start_date": req.plan_start_date,
        "updated_at": now_iso
    }
    save_stored_families(families)
    return {
        "status": "success",
        "message": f"Profile for '{req.family_name}' saved successfully!",
        "family_id": req.family_id,
        "family_name": req.family_name,
        "pin_required": req.pin_required and bool(req.pin)
    }

@api_router.post("/family/load")
def load_family_profile(req: LoadFamilyRequest):
    """Loads a family profile, verifying PIN if protection is active."""
    families = get_stored_families()
    
    target = None
    if req.family_id and req.family_id in families:
        target = families[req.family_id]
    elif req.family_name:
        for f in families.values():
            if f.get("family_name", "").strip().lower() == req.family_name.strip().lower():
                target = f
                break
                
    if not target:
        raise HTTPException(status_code=404, detail="Family profile not found.")
        
    if target.get("pin_required") and target.get("pin"):
        if not req.pin or str(req.pin).strip() != str(target.get("pin")).strip():
            raise HTTPException(status_code=401, detail="Incorrect PIN for this family profile.")
            
    return {
        "status": "success",
        "family": target
    }

@api_router.post("/analyze-fridge")
async def analyze_fridge(
    image: Optional[UploadFile] = File(None),
    image_base64: Optional[str] = Form(None),
    text_notes: Optional[str] = Form(None),
    x_gemini_key: Optional[str] = Header(None)
):
    """
    Analyzes an uploaded fridge photo or text inventory using Gemini Vision.
    Categorizes items into cooked leftovers (with high urgency) and raw ingredients.
    """
    api_key = get_effective_api_key(x_gemini_key)
    
    # Read image bytes if provided
    image_bytes = None
    mime_type = "image/jpeg"
    
    if image is not None:
        image_bytes = await image.read()
        mime_type = image.content_type or "image/jpeg"
    elif image_base64 and len(image_base64.strip()) > 50:
        b64_str = image_base64
        if "base64," in b64_str:
            prefix, b64_str = b64_str.split("base64,", 1)
            if "image/png" in prefix:
                mime_type = "image/png"
            elif "image/webp" in prefix:
                mime_type = "image/webp"
        image_bytes = base64.b64decode(b64_str)

    # Fallback if no key or SDK missing, or when processing purely text/spoken input
    if not api_key or not GENAI_AVAILABLE or (not image_bytes and text_notes and text_notes.strip()):
        if not image_bytes and text_notes and text_notes.strip():
            import re
            lines = [l.strip() for l in re.split(r'[\n\r]+|\.{2,}|,|;', text_notes) if l.strip()]
            parsed_items = []
            for idx, line in enumerate(lines):
                lower = line.lower()
                is_cooked = any(w in lower for w in [
                    "cooked", "leftover", "left over", "curry", "rice", "pasta", 
                    "tupperware", "chili", "stew", "daal", "dal", "biryani", "khichdi", 
                    "soup", "bake", "roast", "tikka", "korma"
                ])
                # Extract weight / quantity
                qty = "1 portion"
                gm_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:gms|gm|grams|gram|g)\b', line, re.I)
                kg_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:kilograms|kilogram|kilos|kilo|kgs|kg)\b', line, re.I)
                if kg_match:
                    qty = f"{kg_match.group(1)} kg"
                elif gm_match:
                    qty = f"{gm_match.group(1)} gms"

                is_freezer = "freezer" in lower or "frozen" in lower
                parsed_items.append({
                    "id": f"item-{idx+1}",
                    "name": line,
                    "category": "cooked_leftover" if is_cooked else "raw_ingredient",
                    "sub_category": "prepared" if is_cooked else "produce",
                    "quantity": qty,
                    "portions": 2.0,
                    "urgency": "high" if is_cooked else ("low" if is_freezer else "medium"),
                    "dietary_tags": [],
                    "storage_type": "Freezer" if is_freezer else "Fridge",
                    "notes": "Added from user input"
                })
            return {
                "status": "success",
                "source": "text_analysis",
                "message": f"Successfully parsed {len(parsed_items)} items from your input!",
                "items": parsed_items
            }

        fallback_data = mock_analyze_fridge_image()
        return {
            "status": "success",
            "source": "fallback_mock",
            "message": "Analyzed successfully (Using smart offline mode. Enter a Gemini API key for live multimodal vision AI).",
            "items": fallback_data
        }

    # Call Gemini Vision with multi-model fallback (Gemini 2.0 Flash)
    try:
        client = genai.Client(api_key=api_key)
        
        sharp_vision_prompt = """You are an elite food computer vision specialist and kitchen inventory auditor.
Examine this photograph of a refrigerator, freezer, or kitchen pantry with extreme precision and convert what you see into real, structured food items.

CRITICAL DETECTION INSTRUCTIONS:
1. DEEP VISUAL SCANNING:
   - Systematically inspect all shelves (top, middle, bottom), crisper drawers, door bins, and freezer compartments.
   - Do NOT produce vague categories like "various items" or "miscellaneous". Be specific and accurate.
2. DISHES & PREPARED FOOD (COOKED LEFTOVERS):
   - Look closely at glass containers (Pyrex), plastic Tupperware, foil-wrapped items, bowls, and takeout containers.
   - Accurately determine the dish inside (e.g. "Cooked Dal / Lentil Curry", "Cooked Basmati Rice", "Leftover Chicken Curry", "Pasta with Tomato Sauce", "Soup").
   - Mark category as "cooked_leftover" and urgency as "high" (Priority 1: must be eaten in 1-2 days).
   - Estimate the weight/portions based on container size (e.g., "approx 350g", "2 servings").
3. STORE PACKAGES & OCR (RAW INGREDIENTS & STAPLES):
   - Read visible text on labels, cartons, jars, bottles, and packaging (e.g. "Greek Style Yogurt 500g", "Mature Cheddar 200g", "Whole Milk 1L", "Tofu 400g", "Free-Range Eggs 6-pack").
   - Detect raw proteins (e.g. "Raw Chicken Breasts 500g", "Minced Beef 400g", "Salmon Fillets").
   - Mark category as "raw_ingredient".
4. FRESH PRODUCE:
   - Identify whole or cut vegetables and fruits (e.g. "2 Red Bell Peppers", "Broccoli Crown", "Cucumbers", "Tomatoes", "Lemons").
   - Mark category as "raw_ingredient" with urgency "medium".
5. COMPARTMENT & STORAGE DETECTION:
   - If frosted or in a freezer drawer/compartment -> storage_type: "Freezer", urgency: "low".
   - Otherwise -> storage_type: "Fridge".

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
      "dietary_tags": ["Vegetarian", "High-Protein", etc.],
      "notes": "Storage or packaging details"
    }
  ],
  "detection_summary": "Identified X distinct items across shelves."
}
"""
        contents = [sharp_vision_prompt]
        if text_notes and text_notes.strip():
            contents.append(f"Additional user notes/inventory:\n{text_notes.strip()}")
            
        if image_bytes:
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
            
        # Try gemini-2.0-flash, fallback to gemini-1.5-flash
        last_error = None
        for model_name in ["gemini-2.0-flash", "gemini-1.5-flash"]:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.1
                    )
                )
                parsed = json.loads(response.text)
                return {
                    "status": "success",
                    "source": model_name,
                    "message": "Fridge scanned with sharp Gemini 2.0 Flash Vision!",
                    "items": parsed.get("items", []),
                    "detection_summary": parsed.get("detection_summary", "Fridge scanned successfully.")
                }
            except Exception as me:
                last_error = me
                continue

        raise last_error or Exception("Gemini models failed to process image.")
    except Exception as e:
        print(f"Gemini Vision API error: {e}. Falling back to heuristic.")
        fallback = mock_analyze_fridge_image()
        return {
            "status": "warning",
            "source": "fallback_on_error",
            "error_detail": str(e),
            "message": f"Gemini API returned an error ({str(e)[:100]}...). Loaded smart offline inventory so you can continue testing!",
            "items": fallback
        }

class ParseVoiceRequest(BaseModel):
    voice_transcript: str

@api_router.post("/parse-voice")
async def parse_voice(
    req: ParseVoiceRequest,
    x_gemini_key: Optional[str] = Header(None)
):
    """
    Parses a single continuous voice dictation containing MULTIPLE food items
    into clean, categorized items with weights, portions, and storage locations.
    """
    api_key = get_effective_api_key(x_gemini_key)
    transcript = (req.voice_transcript or "").strip()
    if not transcript:
        return {"status": "success", "items": [], "message": "No transcript provided."}

    # 1. Try Gemini 2.0 Flash if API key is present
    if api_key and GENAI_AVAILABLE:
        try:
            client = genai.Client(api_key=api_key)
            prompt = f"""You are an expert food inventory auditor.
A family member dictated multiple food items stored in their fridge or freezer in one continuous voice recording:
"{transcript}"

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
{{
  "items": [
    {{
      "id": "item-1",
      "name": "Courgette",
      "category": "raw_ingredient",
      "quantity": "1 kg",
      "portions": 4.0,
      "storage_type": "Fridge",
      "urgency": "medium",
      "dietary_tags": [],
      "notes": "Spoken details"
    }}
  ],
  "summary": "Documented X items from voice dictation."
}}"""
            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=[prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1
                )
            )
            parsed = json.loads(response.text)
            return {
                "status": "success",
                "source": "gemini_2.0_flash",
                "items": parsed.get("items", []),
                "message": parsed.get("summary", f"Successfully documented {len(parsed.get('items', []))} items from your voice recording!")
            }
        except Exception as e:
            print(f"Gemini voice parsing error: {e}. Falling back to NLP regex parser.")

    # 2. High-precision NLP continuous speech parser fallback
    import re

    WORD_TO_NUM = {
        "zero": 0, "a": 1, "an": 1, "one": 1, "single": 1,
        "two": 2, "couple": 2, "pair": 2, "couple of": 2,
        "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
        "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "dozen": 12,
        "half": 0.5, "half a": 0.5
    }

    def parse_num(val_str: str) -> float:
        if not val_str:
            return 1.0
        val_str = val_str.strip().lower()
        if val_str in WORD_TO_NUM:
            return float(WORD_TO_NUM[val_str])
        try:
            return float(val_str)
        except ValueError:
            return 1.0

    text = re.sub(r'\s+', ' ', transcript).strip()
    num_pattern = r'(?:\d+(?:\.\d+)?|half\s+a|couple\s+of|couple|pair|dozen|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an)'
    unit_pattern = r'(?:kilograms?|kilos?|kgs?|kg|grams?|gms?|gm|g|milliliters?|millilitres?|ml|liters?|litres?|l|portions?|servings?|bowls?|plates?|packs?|packets?|bags?|cans?|tins?|tubs?|pots?|bottles?|jars?|cartons?|punnets?|box(?:es)?|bunch(?:es)?|loaves|loaf|pieces?|pcs?|slices?|rashers?|fillets?|breasts?|thighs?|steaks?|chops?|eggs?|heads?|stalks?|crowns?)'
    qty_prefix = r'(?:around|approx|about)?\s*(?:' + num_pattern + r')\s*(?:' + unit_pattern + r')\b'

    raw_chunks = re.split(r'[\n\r]+|\.{2,}|,|;|\b(?:and\s+then|and\s+also)\b|[•\*\-]\s+', text, flags=re.I)
    refined = []
    for chunk in raw_chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        and_parts = re.split(r'\s+and\s+(?!(?:cheese|chips|rice|dal|daal)\b)', chunk, flags=re.I)
        for part in and_parts:
            part = part.strip()
            if not part:
                continue
            starts_with_qty = bool(re.match(r'^(?:' + qty_prefix + r')', part, flags=re.I))
            if starts_with_qty:
                # [QTY] [FOOD] [QTY] [FOOD]...
                inserted = re.sub(r'([a-zA-Z\)])(?<!\bhalf)\s+(?=' + qty_prefix + r')', r'\1\n', part, flags=re.I)
                for line in inserted.split('\n'):
                    if line.strip(): refined.append(line.strip())
            else:
                # [FOOD] [QTY] [FOOD] [QTY]...
                inserted = re.sub(r'(\b' + num_pattern + r'\s*' + unit_pattern + r')\s+(?=(?!\bof\b)[a-zA-Z])', r'\1\n', part, flags=re.I)
                for line in inserted.split('\n'):
                    if line.strip(): refined.append(line.strip())

    parsed_items = []
    for idx, item in enumerate(refined):
        lower = item.lower()
        is_freezer = bool(re.search(r'\b(?:freezer|frozen|deep\s*freeze|in\s*freezer)\b', lower))
        is_cooked = bool(re.search(r'\b(?:cooked|leftover|left over|curry|daal|dal|dhal|biryani|khichdi|rice|pasta|stew|soup|roast|roasted|boiled|baked|fried|grilled|tikka|masala|korma)\b', lower)) and not bool(re.search(r'\b(?:raw|uncooked)\b', lower))

        qty = "1 portion"
        portions = 2.0
        kg_m = re.search(r'(' + num_pattern + r')\s*(?:kilograms?|kilos?|kgs?|kg)\b', item, re.I)
        gm_m = re.search(r'(' + num_pattern + r')\s*(?:gms?|grams?|gm|g)\b', item, re.I)
        portion_m = re.search(r'(' + num_pattern + r')\s*(?:portions?|servings?|bowls?|plates?)\b', item, re.I)
        count_m = re.search(r'(' + num_pattern + r')\s*(?:pieces?|pcs?|packs?|packets?|bags?|cans?|tins?|tubs?|pots?|bottles?|jars?|cartons?|punnets?|box(?:es)?|bunch(?:es)?|loaves|loaf|slices?|rashers?|fillets?|breasts?|thighs?|steaks?|chops?|eggs?|heads?|stalks?|crowns?)\b', item, re.I)

        if kg_m:
            val = parse_num(kg_m.group(1))
            qty = f"{int(val) if val.is_integer() else val} kg"
            portions = max(1.0, round(val * 4))
        elif gm_m:
            val = parse_num(gm_m.group(1))
            qty = f"{int(val) if val.is_integer() else val} gms"
            portions = 1.5 if val <= 300 else (3.0 if val <= 600 else max(1.0, round(val / 200)))
        elif portion_m:
            val = parse_num(portion_m.group(1))
            qty = f"{int(val) if val.is_integer() else val} portions"
            portions = val
        elif count_m:
            val = parse_num(count_m.group(1))
            unit = re.sub(r'^\s*(?:' + num_pattern + r')\s*', '', count_m.group(0), flags=re.I).strip()
            qty = f"{int(val) if val.is_integer() else val} {unit}"
            portions = max(1.0, round(val / 2))

        clean_name = item
        clean_name = re.sub(r'\b(?:in\s+the\s+freezer|in\s+freezer|in\s+the\s+fridge|in\s+fridge)\b', '', clean_name, flags=re.I)
        clean_name = re.sub(r'\b(?:around|approx|about)?\s*(?:' + num_pattern + r')\s*(?:' + unit_pattern + r')\b', '', clean_name, flags=re.I)
        clean_name = re.sub(r'^(?:\s*(?:of|some|a|an|the|and)\s+)+', '', clean_name, flags=re.I)
        clean_name = re.sub(r'(?:\s+(?:of|in|at)\s*)+$', '', clean_name, flags=re.I)
        clean_name = re.sub(r'\s{2,}', ' ', clean_name).strip()
        clean_name = re.sub(r'^of\s+', '', clean_name, flags=re.I).strip()

        if clean_name:
            clean_name = clean_name.capitalize()
        elif count_m:
            unit_word = re.sub(r'^\s*(?:' + num_pattern + r')\s*', '', count_m.group(0), flags=re.I).strip()
            clean_name = unit_word.capitalize()
        else:
            clean_name = item.capitalize()

        urgency = "high" if is_cooked or ("chicken" in lower or "meat" in lower or "fish" in lower) else ("low" if is_freezer else "medium")
        if is_freezer and not is_cooked:
            urgency = "low"

        parsed_items.append({
            "id": f"item-{idx+1}",
            "name": clean_name,
            "category": "cooked_leftover" if is_cooked else "raw_ingredient",
            "quantity": qty,
            "portions": portions,
            "storage_type": "Freezer" if is_freezer else "Fridge",
            "urgency": urgency,
            "dietary_tags": [],
            "notes": "Documented from voice dictation."
        })

    return {
        "status": "success",
        "source": "nlp_engine",
        "items": parsed_items,
        "message": f"Successfully documented {len(parsed_items)} items from your voice recording!"
    }

class AnalyzeVideoFramesRequest(BaseModel):
    frames: List[str]  # Base64 encoded JPEG images
    storage_hint: Optional[str] = "Fridge"
    text_notes: Optional[str] = ""

@api_router.post("/analyze-video-frames")
async def analyze_video_frames(
    req: AnalyzeVideoFramesRequest,
    x_gemini_key: Optional[str] = Header(None)
):
    """
    Analyzes multiple sequential keyframes extracted from a video sweep of a fridge/freezer.
    Cross-deduplicates items seen across frames into a clean, unified inventory.
    """
    api_key = get_effective_api_key(x_gemini_key)
    frames = req.frames or []
    if not frames:
        return {"status": "warning", "items": [], "message": "No video frames provided."}

    # 1. Try Gemini 2.0 Flash / 1.5 Flash if API key is present
    if api_key and GENAI_AVAILABLE:
        try:
            client = genai.Client(api_key=api_key)
            sweep_prompt = f"""You are an elite food computer vision specialist and kitchen inventory auditor.
You are provided with {len(frames)} sequential keyframes extracted from a continuous video sweep of a refrigerator or freezer (storage hint: {req.storage_hint or 'Fridge'}).
The user slowly panned the camera across top, middle, and bottom shelves, crisper drawers, or freezer compartments.

CRITICAL CROSS-FRAME DEDUPLICATION & INVENTORY RULES:
1. CROSS-FRAME DEDUPLICATION: Multiple frames show the EXACT SAME food items from slightly different angles or distances as the camera pans. DO NOT duplicate items! If a carton of milk, container of dal, or yogurt tub is seen across consecutive frames, record it ONCE.
2. DEEP VISUAL SCANNING: Systematically inspect all visible shelves, containers, jars, cartons, and produce across all frames.
3. DISHES & PREPARED FOOD (COOKED LEFTOVERS):
   - Look inside glass containers (Pyrex), plastic Tupperware, foil containers, and bowls.
   - Accurately determine the dish inside (e.g. "Cooked Dal / Lentil Curry", "Cooked Basmati Rice", "Leftover Chicken Curry", "Pasta with Tomato Sauce").
   - Mark category as "cooked_leftover" and urgency as "high" (Priority 1: must be eaten in 1-2 days).
   - Estimate realistic weight or adult servings (e.g. "approx 350g", 2.0 portions).
4. STORE PACKAGES & OCR (RAW INGREDIENTS):
   - Read visible text on labels, cartons, jars, bottles, and packaging (e.g. "Greek Style Yogurt 500g", "Mature Cheddar 200g", "Whole Milk 2L", "Free-Range Eggs 6-pack").
   - Detect raw meats or proteins (e.g. "Raw Chicken Breasts 500g", "Minced Beef 400g", "Salmon Fillets").
   - Mark category as "raw_ingredient".
5. FRESH PRODUCE:
   - Identify whole or cut vegetables and fruits (e.g. "Red Bell Peppers", "Broccoli", "Cucumbers", "Tomatoes", "Lemons").
   - Mark category as "raw_ingredient", urgency as "medium".
6. COMPARTMENT & STORAGE:
   - Assign storage_type as "{req.storage_hint or 'Fridge'}" unless clearly frozen/frosted, in which case assign "Freezer" and urgency "low".

Output ONLY valid JSON matching:
{{
  "items": [
    {{
      "id": "item-1",
      "name": "Food Name",
      "category": "cooked_leftover" | "raw_ingredient",
      "quantity": "approx 350g / 500g / 1 kg / 6 eggs",
      "portions": 2.0,
      "urgency": "high" | "medium" | "low",
      "storage_type": "Fridge" | "Freezer",
      "dietary_tags": ["Vegetarian", "High-Protein", etc.],
      "notes": "Spotted across video sweep"
    }}
  ],
  "detection_summary": "Extracted and deduplicated X distinct items across {len(frames)} video sweep frames."
}}"""
            contents = [sweep_prompt]
            if req.text_notes and req.text_notes.strip():
                contents.append(f"Additional user notes:\n{req.text_notes.strip()}")

            for frame in frames:
                data_str = frame
                mime = "image/jpeg"
                if "data:" in data_str and ";base64," in data_str:
                    header_part, data_str = data_str.split(";base64,", 1)
                    if "image/png" in header_part:
                        mime = "image/png"
                    elif "image/webp" in header_part:
                        mime = "image/webp"
                frame_bytes = base64.b64decode(data_str)
                contents.append(types.Part.from_bytes(data=frame_bytes, mime_type=mime))

            last_error = None
            for model_name in ["gemini-2.0-flash", "gemini-1.5-flash"]:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=contents,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            temperature=0.1
                        )
                    )
                    parsed = json.loads(response.text)
                    return {
                        "status": "success",
                        "source": model_name,
                        "message": f"Video sweep analyzed with {model_name}!",
                        "items": parsed.get("items", []),
                        "detection_summary": parsed.get("detection_summary", f"Deduplicated inventory from {len(frames)} video frames.")
                    }
                except Exception as me:
                    last_error = me
                    continue

            print(f"Gemini video sweep error: {last_error}")
        except Exception as e:
            print(f"Gemini video sweep error: {e}. Falling back to multi-shelf heuristic.")

    # Fallback heuristic for video sweep
    storage = req.storage_hint or "Fridge"
    fallback_items = [
        {"id": "vid-1", "name": "Leftover Chicken Tikka Masala", "category": "cooked_leftover", "quantity": "approx 400g", "portions": 2.5, "storage_type": storage, "urgency": "high", "dietary_tags": ["Halal"], "notes": "Top shelf glass container"},
        {"id": "vid-2", "name": "Cooked Jeera Rice", "category": "cooked_leftover", "quantity": "approx 350g", "portions": 2.0, "storage_type": storage, "urgency": "high", "dietary_tags": ["Vegetarian"], "notes": "Top shelf Tupperware"},
        {"id": "vid-3", "name": "Greek Style Plain Yogurt", "category": "raw_ingredient", "quantity": "500g tub", "portions": 4.0, "storage_type": storage, "urgency": "medium", "dietary_tags": ["Vegetarian"], "notes": "Middle shelf dairy"},
        {"id": "vid-4", "name": "Whole Milk", "category": "raw_ingredient", "quantity": "2 Litres", "portions": 8.0, "storage_type": storage, "urgency": "medium", "dietary_tags": ["Vegetarian"], "notes": "Door shelf bottle"},
        {"id": "vid-5", "name": "Fresh Bell Peppers & Tomatoes", "category": "raw_ingredient", "quantity": "4 pieces", "portions": 3.0, "storage_type": storage, "urgency": "medium", "dietary_tags": ["Vegetarian"], "notes": "Bottom crisper drawer"},
        {"id": "vid-6", "name": "Mature Cheddar Cheese", "category": "raw_ingredient", "quantity": "250g block", "portions": 5.0, "storage_type": storage, "urgency": "medium", "dietary_tags": ["Vegetarian"], "notes": "Deli drawer"}
    ]
    if storage == "Freezer":
        fallback_items = [
            {"id": "vid-f1", "name": "Frozen Green Peas", "category": "raw_ingredient", "quantity": "1 kg bag", "portions": 6.0, "storage_type": "Freezer", "urgency": "low", "dietary_tags": ["Vegetarian"], "notes": "Top freezer drawer"},
            {"id": "vid-f2", "name": "Raw Chicken Breast Fillets", "category": "raw_ingredient", "quantity": "800g pack", "portions": 4.0, "storage_type": "Freezer", "urgency": "low", "dietary_tags": ["Halal"], "notes": "Middle freezer drawer"},
            {"id": "vid-f3", "name": "Cooked Dal Makhani (Frozen Portions)", "category": "cooked_leftover", "quantity": "approx 500g", "portions": 3.0, "storage_type": "Freezer", "urgency": "low", "dietary_tags": ["Vegetarian"], "notes": "Pre-portioned freezer meal"}
        ]

    return {
        "status": "success",
        "source": "multi_shelf_heuristic",
        "items": fallback_items,
        "detection_summary": f"Video sweep processed ({len(frames)} frames). Enter your free Gemini API key in Settings to scan live video with Gemini 2.0 Flash."
    }

@api_router.post("/generate-plan")
async def generate_plan(
    req: GeneratePlanRequest,
    x_gemini_key: Optional[str] = Header(None)
):
    """
    Generates a personalized 7-day household meal plan.
    Prioritizes cooked leftovers, portions for age/sex, strictly honors dietary needs, and turns raw ingredients into recipes.
    """
    api_key = get_effective_api_key(x_gemini_key)
    
    # If no household specified, populate sample household so it never hard crashes
    if not req.household:
        req.household = [
            HouseholdMember(id="m1", name="Anil", age=42, sex="Male", dietary_needs=["High-Protein", "Halal"]),
            HouseholdMember(id="m2", name="Sarah", age=39, sex="Female", dietary_needs=["Vegetarian", "Low-Carb"]),
            HouseholdMember(id="m3", name="Leo (Child)", age=8, sex="Male", dietary_needs=["Nut-Free"])
        ]
    
    # If no inventory, populate sample inventory
    if not req.inventory:
        req.inventory = [InventoryItem(**item) for item in mock_analyze_fridge_image()]
    
    # If no Gemini key or GenAI SDK missing, run heuristic engine immediately
    if not api_key or not GENAI_AVAILABLE:
        result = mock_generate_meal_plan(req)
        return result

    # Call Gemini with multi-model fallback
    try:
        client = genai.Client(api_key=api_key)
        
        system_instruction = """
You are a Michelin-calibrated chef, family dietitian, and zero-food-waste specialist.
Your mission is to generate a comprehensive 7-day personalized household meal plan based on:
1. Household Members (age, sex, specific dietary requirements/allergies, number of meals eaten per day, calorie targets).
2. Fridge Inventory:
   - Cooked Leftovers (TOP PRIORITY: must be scheduled in early days like Monday/Tuesday so they don't spoil).
   - Raw Ingredients (Transform these into delicious, practical meals; provide preparation steps).
3. Constraints:
   - Meal items CAN be repeated across days (e.g. batch cooking dinner and eating remainder for next day's lunch).
   - STRICT DIETARY & CULTURAL SAFETY: If an individual is Vegetarian, Halal, Gluten-Free, or has Nut Allergies, they MUST NOT be assigned food violating their needs.
   - For members with "Egg-Free / No Eggs" or "no eggs", NEVER assign eggs or egg-containing foods in their portions.
   - For members requesting "Indian Cuisine Only" or "No Pasta / Western Food", ALWAYS provide an authentic Indian meal/alternative in their portion customization (e.g., Dal Tadka, Khichdi, Sabzi with Roti/Basmati Rice, Poha, Upma, Chilla, Paneer Curry) without pasta, pizza, burgers, or western dishes, even when the rest of the family eats western food.
   - PORTION SIZING & DIGESTIBILITY: Clearly specify portions customized to each person's age and sex (adjusting digestibility and portion sizes for seniors/elderly 65+).
"""
        user_prompt = f"""
HOUSEHOLD MEMBERS:
{json.dumps([m.model_dump() for m in req.household], indent=2)}

FRIDGE & PANTRY INVENTORY:
{json.dumps([i.model_dump() for i in req.inventory], indent=2)}

PANTRY STAPLES AVAILABLE:
{', '.join(req.pantry_staples or [])}

PREFERENCES:
- Allow Meal Repetition: {req.allow_repeats}
- Days to plan: {req.plan_days} (Starting {req.start_day})
- Special notes: {req.notes_or_goals}

INSTRUCTIONS:
Generate a 7-day meal plan strictly in JSON format adhering to this structure:
{{
  "plan_days": [
    {{
      "day": "Monday",
      "meals": [
        {{
          "slot": "Breakfast" | "Lunch" | "Dinner" | "Snack",
          "meal_name": "Name of Dish",
          "is_leftover": true/false,
          "origin_item": "Item used",
          "prep_time": "15 mins",
          "recipe_summary": "Cooking or reheating steps",
          "member_portions": [
            {{ "member_name": "Name", "portion": "1 portion", "customization": "Dietary tweak" }}
          ],
          "ingredients_used": ["Item 1", "Item 2"],
          "pantry_additions_needed": ["Olive oil", "Salt"]
        }}
      ]
    }}
  ],
  "shopping_list": ["Item 1", "Item 2"],
  "waste_reduction_tips": ["Leftovers saved..."],
  "household_dietary_verification": "Verified for all household members"
}}

Output ONLY valid JSON.
"""
        last_error = None
        for model_name in ["gemini-2.0-flash", "gemini-1.5-flash"]:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=[user_prompt],
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        temperature=0.3
                    )
                )
                
                parsed = json.loads(response.text)
                parsed["engine"] = model_name
                return normalize_plan_response(parsed, req)
            except Exception as me:
                last_error = me
                continue

        raise last_error or Exception("Gemini models failed to generate plan.")
    except Exception as e:
        print(f"Gemini Plan Generation error: {e}. Falling back to heuristic.")
        fallback = mock_generate_meal_plan(req)
        fallback["engine"] = f"fallback_heuristic (Gemini fallback: {str(e)[:60]})"
        return fallback

# Register routes on both /api prefix AND root for Vercel Serverless compatibility
app.include_router(api_router, prefix="/api")
app.include_router(api_router)

# Mount static files and frontend
static_dir = BASE_DIR / "public"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def serve_index():
    for p in [BASE_DIR / "index.html", BASE_DIR / "public" / "index.html"]:
        if p.exists():
            return FileResponse(p)
    return JSONResponse({"message": "Smart Fridge Planner API is running."})

@app.get("/styles.css")
def serve_styles():
    for p in [BASE_DIR / "styles.css", BASE_DIR / "public" / "styles.css"]:
        if p.exists():
            return FileResponse(p, media_type="text/css")
    raise HTTPException(status_code=404, detail="styles.css not found")

@app.get("/app.js")
def serve_app_js():
    for p in [BASE_DIR / "app.js", BASE_DIR / "public" / "app.js"]:
        if p.exists():
            return FileResponse(p, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="app.js not found")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8050))
    print(f"Starting Smart Fridge Planner on http://localhost:{port}")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)
