# Methodology — Groundwater Discovery Portal

## Theoretical Framework: Source–Pathway–Receptor

The Groundwater Potential Index (GWPI) is grounded in the hydrogeological **Source–Pathway–Receptor** conceptual model, adapted for remote sensing in data-scarce crystalline basement terrains (common across sub-Saharan Africa).

| Concept | Hydrogeological Meaning | Model Pillar |
|---------|------------------------|--------------|
| **Receptor** | Where water is stored — the aquifer volume | **Storage** |
| **Source** | Where recharge comes from — climatic moisture surplus | **Supply** |
| **Pathway** | How water reaches and moves through the aquifer — fractures, transmissive soils, structural conduits | **Yield** |

A **multiplicative terrain constraint** (Penalty) ensures that steep, elevated terrain — where runoff dominates over infiltration — suppresses the score regardless of how high the pillars are.

---

## Pillar 1: Saturated Storage Capacity (The Receptor)

### Rationale
In crystalline basement aquifers, groundwater is primarily hosted in the **weathered regolith (saprolite)**. The thickness of this saturated weathered zone is the primary control on how much water the aquifer can store.

### Inputs
- **DTB** — Depth to Bedrock (metres), from the global DTB dataset (Shangguan et al. 2017)
- **HAND** — Height Above Nearest Drainage (metres), from MERIT Hydro

### Computation
```
DTB_minus_HAND = DTB − HAND
Storage_raw_m  = clamp(DTB_minus_HAND, 0, 200)
Storage        = log(1 + Storage_raw_m) / log(201)
```

### Why This Works
- **DTB − HAND** approximates the thickness of weathered material that lies *below* the local water table (drainage base-level). A hilltop with deep bedrock may still be dry if HAND is large.
- **Clamping to 200 m** prevents outlier pixels from dominating.
- **Log transform** compresses the long tail while preserving 0 → 0 and 200 → 1. This gives proportionally more discrimination in the critical 0–50 m range.

---

## Pillar 2: Climatic Supply Flux (The Source)

### Rationale
Groundwater recharge requires a moisture surplus after evapotranspiration is satisfied. The Aridity Index (AI = P/PET) is a direct, globally available proxy for this surplus.

### Inputs
- **AI** — Global Aridity Index v3.1 (FAO-56 Penman-Monteith reference ET)
- **UPA** — Upstream Drainage Area (km²) from MERIT Hydro

### Computation
```
AI_norm    = unitScale(clamp(AI, 0.05, 1.5))
UPA_factor = unitScale(clamp(log10(UPA), −2, 4))
Supply     = AI_norm × UPA_factor
```

### Why This Works
- **AI_norm** captures the climate moisture budget: higher AI = wetter = more recharge potential.
- **UPA_factor** adds a topographic concentration effect: larger upstream areas funnel more water to convergence zones.
- The product ensures both conditions must be favourable.

---

## Pillar 3: Yield & Transmissivity Proxies (The Pathway)

### Rationale
Even with storage and recharge, the aquifer must be able to *transmit* water to a borehole. In crystalline basement, this is controlled by fracture networks, soil permeability, and weathering intensity.

### Components and Weights

| Component | Weight | Source | Rationale |
|-----------|--------|--------|-----------|
| **FracturesN** | 0.28 | Canny edge detection on MERIT elv + Gaussian blur (150 m) | Heuristic proxy for lineaments and fracture damage zones |
| **SoilTrans** | 0.28 | SoilGrids v2 (sand%, clay%, CFVO%, bulk density) | Soil hydraulic transmissivity proxy |
| **TPIN** | 0.16 | elv − focal_mean(elv, 250 m) | Topographic convergence — valleys collect water |
| **NDVIN** | 0.16 | Dry-season Sentinel-2 NDVI | Phreatophytes as biological sensors of shallow groundwater |
| **LithFactor** | 0.12 | Neutral 0.5 (or GFV lithology if enabled) | Lithological prior |

### Component Details

#### FracturesN (Lineament Heuristic)
```
FracturesRaw = CannyEdgeDetector(elv, threshold=10, sigma=1)
               .convolve(Gaussian(150m, 100m))
FracturesN   = unitScale(clamp(FracturesRaw, 0, 0.30))
```
The Canny edge detector identifies sharp topographic breaks that often correspond to fault traces and fracture zones. The Gaussian blur simulates the ~100 m damage zone around each lineament where fracture permeability is enhanced.

#### SoilTrans (Soil Transmissivity Proxy)
```
SoilPerm = 0.45 × sandN + 0.20 × cfvoN + 0.25 × (1 − clayN) + 0.10 × (1 − bdodN)
```
Uses a depth-weighted average (0–60 cm) of SoilGrids properties. Sand content and coarse fragments increase permeability; clay and bulk density decrease it.

#### TPIN (Topographic Position)
```
TPI_raw = elv − focal_mean(elv, 250m circle)
TPIN    = unitScale(clamp(TPI_raw, −5, 5))
```
Negative TPI indicates valleys and convergence zones where groundwater naturally accumulates.

#### NDVIN (Vegetation Proxy)
```
NDVI_raw = S2_median.normalizedDifference(B8, B4)  // dry-season month
NDVIN    = unitScale(clamp(NDVI_raw, 0.05, 0.60))
```
In the late dry season, vegetation that remains green is likely accessing groundwater (phreatophytes). This is a powerful biological sensor.

### Yield Combination
```
Yield = 0.28×FracturesN + 0.16×TPIN + 0.16×NDVIN + 0.28×SoilTrans + 0.12×LithFactor
```

---

## Terrain Constraint (Multiplicative Penalty)

### The "Additive Fallacy"
Many groundwater potential maps use purely additive models. This creates a dangerous failure mode: **mountainous terrain scores highly** because fractures and slope features add positive signal, even though steep rocky terrain sheds water as runoff before it can infiltrate.

### Solution: Multiplicative Penalty
```
Penalty = exp(−0.15 × slope) × exp(−0.1 × HAND)
```

This ensures:
- **Steep slopes** (high slope°): Penalty → 0, score collapses
- **High above drainage** (high HAND): Penalty → 0, score collapses
- **Flat, low terrain**: Penalty ≈ 1, pillars dominate the score

The penalty is applied **multiplicatively**, not additively, meaning it can zero out even the highest pillar scores.

---

## Final Score

```
Score = 10 × (wStorage × Storage + wSupply × Supply + wYield × Yield) × Penalty
```

- **Weights** (wStorage, wSupply, wYield) are user-adjustable and normalised to sum to 1
- **Default weights**: Storage 40%, Supply 30%, Yield 30%
- **Output range**: 0–10

### Index Interpretation

| Score | Class | Guidance |
|-------|-------|----------|
| 0–2.0 | Very Low | Low combined evidence. De-prioritise unless strong local knowledge exists. |
| 2.0–3.5 | Low | Some signal, but weak. Use component layers + boreholes to justify. |
| 3.5–5.0 | Medium | Promising. Identify the driving pillar(s) and verify locally. |
| 5.0–6.2 | High | Strong screening signal. Good candidate for verification work. |
| 6.2–10 | Exceptional | Top-tier screening signal. Still verify geology, siting constraints, and water quality. |

---

## Limitations

1. **Screening tool only** — the GWPI is not a substitute for hydrogeological investigation
2. **Resolution ceiling** — limited by the coarsest input (250 m for SoilGrids/DTB)
3. **Fracture proxy is heuristic** — Canny edges on elevation are not mapped faults
4. **Static climate proxy** — AI is a long-term average, not year-specific recharge
5. **LithFactor is neutral by default** — without GFV lithology layers, geology does not differentiate the score
6. **NDVI seasonality** — the dry-season month must be set correctly for each region
7. **No water quality component** — high index ≠ potable water
