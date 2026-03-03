# Dataset Reference — Groundwater Discovery Portal

Complete catalog of every dataset used by the Groundwater Potential Index (GWPI).

---

## Core Datasets

| # | Dataset | GEE Asset / Collection | Bands Used | Native Resolution | Role in Model | License / Citation |
|---|---------|----------------------|------------|-------------------|---------------|-------------------|
| 1 | **MERIT Hydro v1.0.1** | `MERIT/Hydro/v1_0_1` | `elv` (elevation), `hnd` (Height Above Nearest Drainage), `upa` (upstream area) | ~90 m | Base topography, Storage (HAND), Supply (UPA), Constraint (slope from elv) | [Yamazaki et al. 2019](https://developers.google.com/earth-engine/datasets/catalog/MERIT_Hydro_v1_0_1) |
| 2 | **Depth to Bedrock (DTB)** | `projects/washways/assets/BDTICMM250m` | Single band (cm → m via ÷100) | 250 m | Storage pillar — weathered regolith thickness | [Shangguan et al. 2017](https://doi.org/10.1002/2016MS000686) |
| 3 | **Global Aridity Index v3.1** | `projects/washways/assets/AridityIndexv31yrFixed` | Single band (×0.0001 scaling) | ~1 km | Supply pillar — climate recharge proxy | [Zomer et al. 2022, Figshare](https://figshare.com/articles/dataset/Global_Aridity_Index_and_Potential_Evapotranspiration_ETO_Climate_Database_v3/7504448) |
| 4 | **Sentinel-2 SR Harmonized** | `COPERNICUS/S2_SR_HARMONIZED` | `B8` (NIR), `B4` (Red), `QA60` (cloud mask) | 10 m | Yield pillar — dry-season NDVI as phreatophyte proxy | [Copernicus / ESA](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED) |
| 5 | **SoilGrids v2** (ISRIC) | `projects/soilgrids-isric/clay_mean`, `sand_mean`, `cfvo_mean`, `bdod_mean` | Top 4 depth layers (0–5, 5–15, 15–30, 30–60 cm) | 250 m | Yield pillar — soil transmissivity proxy | [Poggio et al. 2021](https://developers.google.com/earth-engine/datasets/catalog/ISRIC_SoilGrids250m_v2_0) |

## Optional / Toggleable Datasets

| # | Dataset | GEE Asset | Enable Flag | Role | Notes |
|---|---------|-----------|-------------|------|-------|
| 6 | **SoilGrids Ksat** | `projects/soilgrids-isric/ksat_mean` | `USE_SOILGRIDS_KSAT = true` | Replaces SoilPerm in SoilTrans with measured saturated hydraulic conductivity | Not enabled by default due to limited availability |
| 7 | **GFV Lithology layers** | `projects/sat-io/open-datasets/global_freshwater_variables/precambrian_surface_lithology_wsum`, `quaternary_surface_lithology_wsum` | `USE_GFV_LITHO = true` | Drives LithFactor from lithology instead of neutral constant | Coarse resolution (~1 km); not enabled by default |

## Derived Layers (computed at runtime)

| Layer | Derivation | Pillar |
|-------|-----------|--------|
| **Slope** (deg) | `ee.Terrain.slope(elv)` from MERIT elevation | Constraint |
| **FracturesN** (0–1) | Canny edge detection on MERIT elevation, Gaussian-blurred at 150 m | Yield |
| **TPIN** (0–1) | `elv − focal_mean(elv, 250m circle)` → unitScale(−5, 5) | Yield |
| **NDVIN** (0–1) | Dry-month Sentinel-2 NDVI median → unitScale(0.05, 0.60) | Yield |
| **SoilTrans** (0–1) | Weighted blend of sand%, clay%, CFVO%, bulk density (or Ksat if enabled) | Yield |
| **LithFactor** (0–1) | Neutral 0.5 constant (or GFV-derived if enabled) | Yield |
| **Penalty** (0–1) | `exp(−0.15 × slope) × exp(−0.1 × HAND)` | Constraint |

## Administrative Boundaries (Export only)

| Dataset | GEE Asset | Use |
|---------|-----------|-----|
| **FAO GAUL 2015 Level 0** | `FAO/GAUL/2015/level0` | Malawi national boundary for asset export |

---

## Data Access Notes

- Assets prefixed with `projects/washways/` are **private uploads** to the WASHways GEE project. To replicate, you need equivalent datasets uploaded to your own GEE project.
- All other assets are from the **public GEE Data Catalog** or **GEE Community Catalog** and are freely accessible with an Earth Engine account.
- Sentinel-2 imagery is filtered to 2024–2025 and to a user-specified dry-season month (default: September, month 9).
