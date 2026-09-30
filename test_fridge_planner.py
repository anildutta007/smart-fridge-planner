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

if __name__ == "__main__":
    try:
        test_health()
        test_sample_data()
        test_analyze_fridge_fallback()
        test_generate_meal_plan()
        print("\nALL TESTS PASSED SUCCESSFULLY!")
    except Exception as e:
        print(f"\n[FAIL] Test failed: {e}", file=sys.stderr)
        raise
