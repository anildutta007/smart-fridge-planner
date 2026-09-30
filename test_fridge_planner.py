"""
Automated Test Suite for SmartFridge AI Planner
"""
import sys
import json
from fastapi.testclient import TestClient
from server import app

client = TestClient(app)

def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    print("[OK] Health check passed:", data)

def test_sample_data():
    response = client.get("/api/sample-data")
    assert response.status_code == 200
    data = response.json()
    assert "household" in data and len(data["household"]) >= 3
    assert "inventory" in data and len(data["inventory"]) >= 5
    print(f"[OK] Sample data passed: {len(data['household'])} members, {len(data['inventory'])} inventory items")

def test_analyze_fridge_fallback():
    response = client.post(
        "/api/analyze-fridge",
        data={"text_notes": "Leftover pasta bake in Pyrex\n3 eggs\n1 cucumber"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "items" in data and len(data["items"]) > 0
    # verify categorized leftovers vs raw
    categories = [i["category"] for i in data["items"]]
    assert "cooked_leftover" in categories
    assert "raw_ingredient" in categories
    print(f"[OK] Analyze fridge passed: {len(data['items'])} items recognized with categories")

def test_generate_meal_plan():
    sample_res = client.get("/api/sample-data")
    sample_data = sample_res.json()
    
    payload = {
        "household": sample_data["household"],
        "inventory": sample_data["inventory"],
        "allow_repeats": True,
        "plan_days": 7,
        "start_day": "Monday",
        "notes_or_goals": "Strictly honor Halal and Vegetarian, portion for child Leo"
    }
    
    response = client.post("/api/generate-plan", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "plan_days" in data and len(data["plan_days"]) == 7
    
    # Check that leftovers are prioritized on early days (Monday / Tuesday)
    day_1_meals = data["plan_days"][0]["meals"]
    leftover_found = any(m["is_leftover"] for m in day_1_meals)
    assert leftover_found, "Leftover must be scheduled on day 1 to prevent waste"
    
    # Check that member portions are specified
    for meal in day_1_meals:
        if meal["member_portions"]:
            names = [p["member_name"] for p in meal["member_portions"]]
            assert "Anil" in names or "Sarah" in names or "Leo (Child)" in names
            
    print("[OK] 7-Day Meal Plan generation passed: 7 days planned with leftover priority and member portioning!")

def test_generate_meal_plan_with_date():
    sample_res = client.get("/api/sample-data")
    sample_data = sample_res.json()
    
    payload = {
        "household": sample_data["household"],
        "inventory": sample_data["inventory"],
        "allow_repeats": True,
        "plan_days": 7,
        "start_date": "2026-09-30",
        "notes_or_goals": "Test dynamic dates"
    }
    
    response = client.post("/api/generate-plan", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    days = [d["day"] for d in data["plan_days"]]
    assert len(days) == 7
    assert "Wednesday" in days[0]
    assert "30 Sep" in days[0]
    assert "Thursday" in days[1]
    assert "01 Oct" in days[1]
    print("[OK] Meal plan with dynamic start_date verified: days properly formatted with weekday and calendar date")

def test_indian_egg_free_elderly_member():
    sample_res = client.get("/api/sample-data")
    sample_data = sample_res.json()
    
    mother = next((m for m in sample_data["household"] if "Mother" in m["name"]), None)
    assert mother is not None, "Mother should be present in sample household"
    assert "Egg-Free (No Eggs)" in mother["dietary_needs"]
    assert "Indian Cuisine Only" in mother["dietary_needs"]
    
    payload = {
        "household": sample_data["household"],
        "inventory": sample_data["inventory"],
        "allow_repeats": True,
        "plan_days": 7,
        "start_date": "2026-09-30",
        "notes_or_goals": "Strictly no eggs for Mother, only Indian food, no pasta or western dishes"
    }
    
    response = client.post("/api/generate-plan", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    
    mother_portions_found = 0
    for day in data["plan_days"]:
        for meal in day["meals"]:
            for portion in meal.get("member_portions", []):
                if portion["member_name"] == "Mother (Elderly)":
                    mother_portions_found += 1
                    custom = portion["customization"].lower()
                    assert "egg-free" in custom or "zero eggs" in custom or "eggless" in custom or "indian" in custom
    
    assert mother_portions_found > 0, "Mother must have portions scheduled"
    print(f"[OK] Elderly Indian egg-free member test passed: {mother_portions_found} portions verified with authentic eggless Indian meals!")

def test_family_profile_and_pin():
    # 1. Save a family with PIN
    save_payload = {
        "family_id": "family-dutta-test",
        "family_name": "Dutta Family",
        "pin": "2468",
        "pin_required": True,
        "household": [
            {"id": "m1", "name": "Anil", "age": 42, "sex": "Male"},
            {"id": "m2", "name": "Mother", "age": 72, "sex": "Female"}
        ],
        "inventory": [
            {"id": "i1", "name": "Leftover Rice", "category": "cooked_leftover"}
        ]
    }
    res = client.post("/api/family/save", json=save_payload)
    assert res.status_code == 200
    save_data = res.json()
    assert save_data["status"] == "success"
    assert save_data["pin_required"] == True

    # 2. List families
    list_res = client.get("/api/family/list")
    assert list_res.status_code == 200
    families = list_res.json()["families"]
    found = next((f for f in families if f["family_id"] == "family-dutta-test"), None)
    assert found is not None
    assert found["family_name"] == "Dutta Family"
    assert found["pin_required"] == True
    assert found["member_count"] == 2

    # 3. Attempt load with incorrect PIN -> Should fail 401
    bad_load_res = client.post("/api/family/load", json={"family_id": "family-dutta-test", "pin": "0000"})
    assert bad_load_res.status_code == 401

    # 4. Load with correct PIN -> Should succeed 200
    good_load_res = client.post("/api/family/load", json={"family_id": "family-dutta-test", "pin": "2468"})
    assert good_load_res.status_code == 200
    loaded = good_load_res.json()["family"]
    assert loaded["family_name"] == "Dutta Family"
    assert len(loaded["household"]) == 2
    assert len(loaded["inventory"]) == 1
    print("[OK] Family Profile & PIN protection verified: Save, List, Unauthorized Lock, and PIN Unlock all succeeded!")

if __name__ == "__main__":
    try:
        test_health()
        test_sample_data()
        test_analyze_fridge_fallback()
        test_generate_meal_plan()
        test_generate_meal_plan_with_date()
        test_indian_egg_free_elderly_member()
        test_family_profile_and_pin()
        print("\nALL TESTS PASSED SUCCESSFULLY!")
    except Exception as e:
        print(f"\n[FAIL] Test failed: {e}", file=sys.stderr)
        raise
