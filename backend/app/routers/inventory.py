"""Medicine + inventory endpoints.

GET /api/v1/inventory/medicine/{id}/availability?facility_id=... powers the
doctor portal's "Out of stock here. X units available at [nearby facility]
(Y km away)" alert box.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Facility, Inventory, Medicine
from ..schemas import (
    InventoryOut,
    InventoryPatch,
    MedicineOut,
    NearbyStock,
)
from ..services.geo import haversine_km

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _to_out(db: Session, inv: Inventory) -> InventoryOut:
    med = db.get(Medicine, inv.medicine_id)
    fac = db.get(Facility, inv.facility_id)
    return InventoryOut(
        id=inv.id,
        medicine_id=inv.medicine_id,
        medicine_name=(med.brand_name or med.generic_name) if med else None,
        generic_name=med.generic_name if med else None,
        is_critical=med.is_critical if med else None,
        facility_id=inv.facility_id,
        facility_name=fac.name if fac else None,
        hfr_id=fac.hfr_id if fac else None,
        stock_units=inv.stock_units,
        reorder_level=inv.reorder_level,
        is_low=inv.is_low,
        is_out_of_stock=inv.is_out_of_stock,
    )


@router.get("", response_model=list[InventoryOut])
def list_inventory(
    facility_id: str | None = None,
    low_only: bool = False,
    out_of_stock: bool = False,
    db: Session = Depends(get_db),
):
    query = db.query(Inventory)
    if facility_id:
        query = query.filter(Inventory.facility_id == facility_id)
    rows = [_to_out(db, r) for r in query.all()]
    if low_only:
        rows = [r for r in rows if r.is_low]
    if out_of_stock:
        rows = [r for r in rows if r.is_out_of_stock]
    return rows


@router.get("/medicines", response_model=list[MedicineOut])
def list_medicines(db: Session = Depends(get_db)):
    return db.query(Medicine).order_by(Medicine.generic_name).all()


@router.get("/medicine/{medicine_id}/availability", response_model=list[NearbyStock])
def medicine_availability(
    medicine_id: str,
    facility_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Stocks of a medicine across facilities with stock > 0, sorted by distance."""
    med = db.get(Medicine, medicine_id)
    if not med:
        raise HTTPException(status_code=404, detail="Medicine not found")

    origin = db.get(Facility, facility_id) if facility_id else None
    stocks = (
        db.query(Inventory)
        .filter(Inventory.medicine_id == medicine_id, Inventory.stock_units > 0)
        .all()
    )

    items: list[NearbyStock] = []
    for s in stocks:
        fac = db.get(Facility, s.facility_id)
        if not fac:
            continue
        distance = (
            haversine_km(origin.latitude, origin.longitude, fac.latitude, fac.longitude)
            if origin else None
        )
        items.append(NearbyStock(
            facility_id=fac.id,
            facility_name=fac.name,
            hfr_id=fac.hfr_id,
            facility_type=fac.facility_type,
            stock_units=s.stock_units,
            distance_km=distance,
            is_critical=med.is_critical,
        ))

    # Nearest first (facilities without coordinates sink to the bottom)
    items.sort(key=lambda x: (x.distance_km is None, x.distance_km or 0))
    return items


@router.patch("/{inventory_id}", response_model=InventoryOut)
def update_inventory(inventory_id: str, payload: InventoryPatch, db: Session = Depends(get_db)):
    inv = db.get(Inventory, inventory_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Inventory row not found")
    if payload.stock_units is not None:
        inv.stock_units = max(0, payload.stock_units)
    if payload.reorder_level is not None:
        inv.reorder_level = max(0, payload.reorder_level)
    db.commit()
    db.refresh(inv)
    return _to_out(db, inv)