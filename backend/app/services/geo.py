"""Geographic helpers for 'X units available at [nearby facility] (Y km away)'."""

import math
from typing import Optional


def haversine_km(lat1: Optional[float], lon1: Optional[float],
                 lat2: Optional[float], lon2: Optional[float]) -> Optional[float]:
    """Great-circle distance in kilometres between two lat/lon points.

    Returns None if any coordinate is missing.
    """
    if None in (lat1, lon1, lat2, lon2):
        return None

    r = 6371.0  # Earth radius (km)
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(a)), 1)