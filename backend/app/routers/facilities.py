"""Facilities (HFR registry) endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Facility
from ..schemas import FacilityCreate, FacilityOut

router = APIRouter(prefix="/facilities", tags=["facilities"])


@router.get("", response_model=list[FacilityOut])
def list_facilities(
    facility_type: str | None = None,
    district: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(Facility)
    if facility_type:
        query = query.filter(Facility.facility_type == facility_type)
    if district:
        query = query.filter(Facility.district == district)
    return query.order_by(Facility.name).all()


@router.get("/{facility_id}", response_model=FacilityOut)
def get_facility(facility_id: str, db: Session = Depends(get_db)):
    facility = db.get(Facility, facility_id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    return facility


@router.post("", response_model=FacilityOut, status_code=201)
def create_facility(payload: FacilityCreate, db: Session = Depends(get_db)):
    existing = db.query(Facility).filter(Facility.hfr_id == payload.hfr_id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"HFR ID {payload.hfr_id} already exists")
    facility = Facility(**payload.model_dump())
    db.add(facility)
    db.commit()
    db.refresh(facility)
    return facility