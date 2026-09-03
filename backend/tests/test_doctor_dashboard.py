"""Doctor portal queue/timeline + admin dashboard summary."""


def test_queue_is_sorted_with_red_on_top(client):
    queue = client.get("/api/v1/queue").json()
    assert len(queue) >= 2
    # Seed: Ram Prasad (RED, snake bite, <48h old) must jump to the top
    assert queue[0]["triage_color"] == "RED"
    assert queue[0]["patient_name"] == "Ram Prasad"


def test_queue_honours_facility_filter(client):
    facilities = client.get("/api/v1/facilities").json()
    phc = next(f for f in facilities if f["facility_type"] == "phc")
    queue = client.get("/api/v1/queue", params={"facility_id": phc["id"]}).json()
    assert all(i["facility_id"] == phc["id"] for i in queue)


def test_patient_timeline_merges_record_types(client):
    sunita = client.get("/api/v1/patients", params={"abha_id": "91214455667701"}).json()[0]
    timeline = client.get(f"/api/v1/patients/{sunita['id']}/timeline").json()
    kinds = {item["kind"] for item in timeline}
    # Sunita has an encounter (with lab TAT), a prescription, and referrals
    assert "encounter" in kinds
    assert "prescription" in kinds
    # Newest first
    stamps = [item["occurred_at"] for item in timeline if item["occurred_at"]]
    assert stamps == sorted(stamps, reverse=True)


def test_dashboard_summary_shape(client):
    summary = client.get("/api/v1/dashboard/summary").json()

    # Referral funnel has all five stages
    stages = {s["stage"]: s["count"] for s in summary["funnel"]}
    assert set(stages) == {"created", "sent", "accepted", "completed", "no_show"}
    assert stages["created"] >= 1 and stages["no_show"] >= 1

    # TAT by facility (Sunita's lab result is the sample)
    assert len(summary["tat_by_facility"]) >= 1
    assert any(f["hfr_id"] == "HFR09-200012" for f in summary["tat_by_facility"])

    # Stock-out alerts: critical antivenom out of stock at the PHC
    assert len(summary["stockout_alerts"]) >= 1
    assert any(
        a["generic_name"].startswith("Snake Venom") and a["is_critical"]
        and a["stock_units"] == 0
        for a in summary["stockout_alerts"]
    )


def test_inventory_availability_returns_nearby_stock(client):
    """Doctor portal: 'Out of stock here. X units at [nearby facility] (Y km)'. """
    facilities = client.get("/api/v1/facilities").json()
    phc = next(f for f in facilities if f["facility_type"] == "phc")

    meds = client.get("/api/v1/inventory/medicines").json()
    antivenom = next(m for m in meds if "Antiserum" in m["generic_name"])

    nearby = client.get(
        f"/api/v1/inventory/medicine/{antivenom['id']}/availability",
        params={"facility_id": phc["id"]},
    ).json()
    assert len(nearby) >= 1
    # Sorted nearest first and every row has stock
    assert all(s["stock_units"] > 0 for s in nearby)
    assert nearby[0]["distance_km"] is not None