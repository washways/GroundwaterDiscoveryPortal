# 🌍 Groundwater Discovery Portal

> **A satellite-powered screening tool for mapping groundwater potential in data-scarce regions.**

[![Live App](https://img.shields.io/badge/Launch-GEE%20App-blue?style=for-the-badge&logo=google-earth)](https://washways.projects.earthengine.app/view/groundwaterdiscoveryportal)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)
[![Website](https://img.shields.io/badge/Web-washways.org-orange?style=for-the-badge)](https://washways.org/groundwaterdiscoveryportal)

The Groundwater Discovery Portal computes a **Groundwater Potential Index (GWPI)** scored 0–10 by combining satellite-derived indicators of aquifer storage, climatic recharge, and yield pathways — with a multiplicative terrain constraint that prevents the "additive fallacy" common in traditional overlay models. It runs entirely on [Google Earth Engine](https://earthengine.google.com/).

---

## 📑 Table of Contents

- [Live App & Website](#-live-app--website)
- [Why This Tool Exists](#-why-this-tool-exists)
- [How It Works (Overview)](#-how-it-works-overview)
- [The Three Pillars + Constraint](#-the-three-pillars--constraint)
  - [Pillar 1: Storage (The Receptor)](#pillar-1-storage-the-receptor-)
  - [Pillar 2: Supply (The Source)](#pillar-2-supply-the-source-)
  - [Pillar 3: Yield (The Pathway)](#pillar-3-yield-the-pathway-)
  - [Terrain Constraint (Penalty)](#terrain-constraint-penalty-)
  - [Final Score Formula](#final-score-formula)
- [Score Interpretation Guide](#-score-interpretation-guide)
- [Data Sources](#-data-sources)
- [How to Use the App](#-how-to-use-the-app)
- [Configuration & Parameters](#-configuration--parameters)
- [Click-to-Query Diagnostics](#-click-to-query-diagnostics)
- [Auto-Stretch Visualization](#-auto-stretch-visualization)
- [National Export (Malawi)](#-national-export-malawi)
- [Technical Architecture](#-technical-architecture)
- [Limitations & Caveats](#-limitations--caveats)
- [Repository Structure](#-repository-structure)
- [Deployment](#-deployment)
- [Contributing](#-contributing)
- [Citation](#-citation)
- [License](#-license)

---

## 🚀 Live App & Website

| Link | Description |
|------|-------------|
| **[Launch GEE App →](https://washways.projects.earthengine.app/view/groundwaterdiscoveryportal)** | Interactive map app (runs in browser via Google Earth Engine) |
| **[washways.org/groundwaterdiscoveryportal](https://washways.org/groundwaterdiscoveryportal)** | Landing page with embedded app + documentation |
| **[GitHub Repository](https://github.com/washways/GroundwaterDiscoveryPortal)** | Source code, methodology docs, and issue tracker |

---

## 🎯 Why This Tool Exists

Millions of people in sub-Saharan Africa depend on groundwater from **crystalline basement aquifers** — complex geological settings where boreholes have high failure rates (30–50% in some regions). Traditional approaches to siting boreholes rely on expensive geophysical surveys or luck.

This tool provides a **first-pass screening layer** using freely available satellite data to identify where groundwater is *most likely* to be found. It does **not** replace hydrogeological field investigation — it tells you **where to look first**.

### Key design principles:
1. **Physically-grounded**: Based on the Source–Pathway–Receptor hydrogeological framework, not statistical black boxes
2. **Multiplicative constraint**: Steep terrain is penalised multiplicatively, preventing mountains from scoring high due to fracture signals alone (the "Additive Fallacy")
3. **Transparent**: Every component is visible as a toggleable map layer; click any point for full diagnostics
4. **Open data**: Uses only public satellite datasets (plus two uploaded asset layers)
5. **Adjustable**: User can tune pillar weights, dry-season month, and output resolution

---

## 🧠 How It Works (Overview)

The model follows the **Source–Pathway–Receptor** conceptual framework:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Storage (Receptor)  ──┐                                       │
│   "Is there room for    │                                       │
│    water underground?"  │    Weighted                           │
│                         ├──→  Sum   ──→ × Penalty ──→ Score    │
│   Supply (Source)  ─────┤   (0–1)       (0–1)        (0–10)   │
│   "Is there enough      │                                       │
│    rainfall/recharge?"  │                                       │
│                         │                                       │
│   Yield (Pathway)  ─────┘                                       │
│   "Can water move                                               │
│    through the rock?"           Constraint                      │
│                          exp(-slope) × exp(-HAND)               │
│                          "Is terrain too steep?"                 │
└─────────────────────────────────────────────────────────────────┘
```

Each pillar is independently normalised to **0–1**, combined using user-adjustable weights (default: 40 / 30 / 30), and multiplied by a terrain penalty (also 0–1). The result is scaled to **0–10**.

---

## 🔬 The Three Pillars + Constraint

### Pillar 1: Storage (The Receptor) 🔵

**Question**: *How much weathered rock exists below the water table to store groundwater?*

| Input | Source | Resolution |
|-------|--------|-----------|
| DTB (Depth to Bedrock) | `projects/washways/assets/BDTICMM250m` | 250 m |
| HAND (Height Above Nearest Drainage) | MERIT Hydro v1.0.1 | 90 m |

**Computation:**
```
DTB_minus_HAND = DTB − HAND          // Saturated regolith thickness estimate
Storage_raw    = clamp(DTB_minus_HAND, 0, 200)
Storage        = log(1 + Storage_raw) / log(201)    // 0 → 0, 200 → 1
```

**Why DTB − HAND?**
In crystalline basement terrains, groundwater lives in the **saprolite** (weathered rock). DTB tells us how deep the weathering goes. But a hilltop with 50 m of DTB may still be *dry* if it sits 60 m above the nearest stream (HAND = 60). Subtracting HAND estimates how much of that weathered zone is likely *saturated*.

**Why log-normalise?**
The raw difference has a long tail (some pixels show >150 m). The log transform compresses the tail while preserving better discrimination in the critical 0–50 m range where most boreholes operate.

---

### Pillar 2: Supply (The Source) 🟢

**Question**: *Is there enough climatic moisture surplus to recharge the aquifer?*

| Input | Source | Resolution |
|-------|--------|-----------|
| Aridity Index v3.1 | `projects/washways/assets/AridityIndexv31yrFixed` | ~1 km |
| Upstream Area (UPA) | MERIT Hydro v1.0.1 | 90 m |

**Computation:**
```
AI_norm    = unitScale(clamp(AI, 0.05, 1.5))      // Climate moisture proxy (0–1)
UPA_factor = unitScale(clamp(log10(UPA), −2, 4))   // Topographic concentration (0–1)
Supply     = AI_norm × UPA_factor                   // Both must be favourable
```

**Why multiply?**
A wet climate (high AI) still won't deliver much recharge to a ridge with tiny upstream area. Conversely, a huge catchment in a hyper-arid zone won't help either. The product ensures *both* conditions must be met.

---

### Pillar 3: Yield (The Pathway) 🟡

**Question**: *Can the aquifer transmit water to a borehole?*

This pillar blends **five sub-components**, each normalised to 0–1:

| Component | Weight | What It Captures | Source |
|-----------|--------|-------------------|--------|
| **FracturesN** | 28% | Lineament/fracture damage zones | Canny edge detection on MERIT elevation + 150 m Gaussian blur |
| **SoilTrans** | 28% | Soil hydraulic transmissivity | SoilGrids v2: sand%, clay%, CFVO%, bulk density (depth-weighted 0–60 cm) |
| **TPIN** | 16% | Valley/convergence tendency | Topographic Position Index: elv − focal_mean(elv, 250 m) |
| **NDVIN** | 16% | Phreatophyte signal (bio-sensor) | Dry-season Sentinel-2 NDVI median (10 m, aggregated) |
| **LithFactor** | 12% | Lithological prior | Neutral 0.5 constant (or GFV quaternary/precambrian if enabled) |

**Key insights:**
- **Fractures**: The Canny edge detector finds sharp topographic breaks that often align with fault traces. The Gaussian blur simulates the ~100 m **damage zone** around each fracture where permeability is enhanced.
- **NDVI as a bio-sensor**: In the late dry season, green vegetation is likely **phreatophytes** — trees accessing shallow groundwater. This is one of the most powerful signals in data-scarce settings.
- **SoilTrans formula**: `0.45×sand + 0.20×cfvo + 0.25×(1−clay) + 0.10×(1−bulk_density)` — sandy, coarse-fragment-rich soils with low clay and low compaction indicate better infiltration.

```
Yield = 0.28×FracturesN + 0.16×TPIN + 0.16×NDVIN + 0.28×SoilTrans + 0.12×LithFactor
```

---

### Terrain Constraint (Penalty) 🔴

**The problem it solves:**
Many groundwater maps use **additive** models. Mountains end up scoring high because fracture density and slope features add positive signal. But in steep rocky terrain, gravity moves water as **surface runoff** before it can infiltrate. This is the **"Additive Fallacy"**.

**Solution — multiplicative penalty:**
```
Penalty = exp(−0.15 × slope) × exp(−0.1 × HAND)
```

| Terrain | Slope | HAND | Penalty | Effect |
|---------|-------|------|---------|--------|
| Flat valley floor | 2° | 3 m | ~0.95 | Pillars dominate |
| Gentle hillslope | 8° | 15 m | ~0.45 | Moderate suppression |
| Steep mountain | 25° | 80 m | ~0.001 | Score collapses to ~zero |

**Why multiplicative?** Because `score × 0.001` ≈ 0 regardless of how high the pillars scored. An additive penalty of −5 would still leave a score of 3–4 on mountains, which is dangerously misleading.

---

### Final Score Formula

```
Score = 10 × (wStorage × Storage + wSupply × Supply + wYield × Yield) × Penalty
```

| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| wStorage | 40% | 0–100 | Normalised to sum to 1 with other weights |
| wSupply | 30% | 0–100 | " |
| wYield | 30% | 0–100 | " |
| Dry-season month | 9 (September) | 1–12 | Set to your region's late dry season |
| Output scale | 250 m | 90–500 m | Lower = finer detail but slower |

---

## 📊 Score Interpretation Guide

| Score | Class | Colour | What to Do |
|-------|-------|--------|------------|
| **0–2.0** | Very Low | 🔴 `#e51f1f` | Low combined evidence. De-prioritise unless strong local knowledge exists. |
| **2.0–3.5** | Low | 🟠 `#f2a134` | Some signal, but weak. Cross-reference with borehole logs before acting. |
| **3.5–5.0** | Medium | 🟡 `#f7e379` | Promising. Identify which pillar(s) are driving the score and verify locally. |
| **5.0–6.2** | High | 🟢 `#bbdb44` | Strong screening signal. Good candidate for geophysical survey + test borehole. |
| **6.2–10** | Exceptional | 🟢 `#44ce1b` | Top-tier signal. Still verify geology, community access, and water quality. |

> ⚠️ **A high score is a hypothesis, not a guarantee.** Always verify with the pillar layers (toggle them on) and field data before investing in drilling.

---

## 📡 Data Sources

| Dataset | GEE Asset | Resolution | Pillar | Link |
|---------|-----------|-----------|--------|------|
| MERIT Hydro v1.0.1 | `MERIT/Hydro/v1_0_1` | 90 m | Base + Supply + Constraint | [Catalog](https://developers.google.com/earth-engine/datasets/catalog/MERIT_Hydro_v1_0_1) |
| Depth to Bedrock | `projects/washways/assets/BDTICMM250m` | 250 m | Storage | Private asset (Shangguan et al. 2017) |
| Aridity Index v3.1 | `projects/washways/assets/AridityIndexv31yrFixed` | ~1 km | Supply | [Figshare](https://figshare.com/articles/dataset/Global_Aridity_Index_and_Potential_Evapotranspiration_ETO_Climate_Database_v3/7504448) |
| Sentinel-2 SR | `COPERNICUS/S2_SR_HARMONIZED` | 10 m | Yield (NDVI) | [Catalog](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED) |
| SoilGrids v2 | `projects/soilgrids-isric/*` | 250 m | Yield (SoilTrans) | [Catalog](https://developers.google.com/earth-engine/datasets/catalog/ISRIC_SoilGrids250m_v2_0) |
| GFV Lithology (optional) | `projects/sat-io/open-datasets/global_freshwater_variables/*` | ~1 km | Yield (LithFactor) | [Community Catalog](https://gee-community-catalog.org/projects/gfv/) |
| FAO GAUL 2015 | `FAO/GAUL/2015/level0` | Admin boundaries | Export only | [Catalog](https://developers.google.com/earth-engine/datasets/catalog/FAO_GAUL_2015_level0) |

For detailed dataset documentation, see [docs/datasets.md](docs/datasets.md).

---

## 🗺️ How to Use the App

1. **Navigate** to your area of interest on the map
2. **Zoom in** to at least level 9 (district/catchment scale). The app blocks execution below zoom 7 and recommends ≥9.
3. **Adjust weights** (optional): Slide the Storage / Supply / Yield weight sliders
4. **Set dry-season month**: Default is September (month 9, appropriate for Malawi). Change for other regions.
5. **Set resolution**: Lower values = finer detail but slower. 250 m is a good default.
6. **Click RUN**: The model computes and renders all layers
7. **Explore layers**: Use the Layers panel to toggle individual pillars (Storage, Supply, Yield), input layers (DTB, HAND, NDVI, etc.), and the Penalty
8. **Click any point**: A diagnostic popup shows the score breakdown with pillar bar charts and raw values
9. **Enable Auto-stretch**: For better colour contrast, tick the checkbox — the index rescales to local percentiles (p2–p98)

---

## ⚙️ Configuration & Parameters

These constants are set at the top of the GEE script and can be modified:

| Constant | Default | Description |
|----------|---------|-------------|
| `DEFAULT_CENTER` | `{lon: 33.7741, lat: -13.9626}` | Initial map center (Malawi) |
| `DEFAULT_ZOOM` | `9` | Initial zoom level |
| `USE_SOILGRIDS_KSAT` | `false` | Enable SoilGrids saturated hydraulic conductivity |
| `USE_GFV_LITHO` | `false` | Enable GFV lithology layers for LithFactor |
| `MIN_RUN_ZOOM` | `7` | Hard block below this zoom |
| `RECOMM_ZOOM` | `9` | Suggested minimum zoom |
| `MAX_AOI_DEG` | `6.0` | Maximum AOI extent in degrees |

---

## 🖱️ Click-to-Query Diagnostics

Clicking any point on the map after running the model shows a popup with:

- **Final score** (0–10) and classification (Very Low → Exceptional)
- **Pillar bar charts**: visual breakdown of Storage, Supply, and Yield (0–100%)
- **Raw diagnostics**: DTB, HAND, Slope, AI_norm, UPA_factor, Penalty, NDVI_10m, SoilTrans, LithFactor
- **Guidance text**: what to do given this score level

The popup auto-dismisses after 12 seconds. A cyan crosshair marks the sampled location.

---

## 🔄 Auto-Stretch Visualization

When enabled, the app dynamically rescales the index layer colour ramp to the **2nd–98th percentile** of the current map view. This provides much better visual contrast when zoomed in (the fixed 1–7 range can look washed out at local scale).

- Works best at zoom ≥ 9
- Updates with a 650 ms debounce on map pan/zoom
- The current stretch range is displayed below the checkbox

---

## 🇲🇼 National Export (Malawi)

The script includes a function `buildGWPI_Malawi()` that computes the full national GWPI at 90 m resolution and exports it as a GEE Asset. This is useful for:
- Integration with GIS workflows (QGIS, ArcGIS)
- Offline analysis
- Avoiding interactive compute limitations

```javascript
// Build and export (run in GEE Code Editor, not the App)
var GWPI_MWI_90m = buildGWPI_Malawi(90, 9, 0.40, 0.30, 0.30);
Export.image.toAsset({
  image: GWPI_MWI_90m,
  description: 'MWI_GWPI_90m_asset_export',
  assetId: 'users/washways/MWI_GWPI_90m',
  region: MALAWI,
  scale: 90,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});
```

---

## 🏗️ Technical Architecture

See [docs/architecture.md](docs/architecture.md) for the full system diagram. Key points:

- **All computation runs server-side** on GEE infrastructure
- The UI is a GEE Apps client-side panel (sidebar + map)
- AOI is **dynamically computed** from map bounds with safety caps and fallbacks
- A **component stack** (24-band image) is built for click queries — all pillar inputs, intermediates, and outputs in one image for efficient point sampling

---

## ⚠️ Limitations & Caveats

| Limitation | Explanation |
|-----------|-------------|
| **Screening tool only** | Not a substitute for hydrogeological investigation, geophysics, or test drilling |
| **Resolution ceiling** | Limited by the coarsest input: DTB and SoilGrids at 250 m |
| **Fracture proxy is heuristic** | Canny edges on elevation ≠ mapped geological faults |
| **Static climate** | Aridity Index is a long-term average, not year-specific recharge |
| **Neutral lithology** | LithFactor defaults to 0.5 unless GFV layers are enabled |
| **NDVI seasonality** | Dry-season month must be set correctly for each region |
| **No water quality** | High index ≠ potable water (fluoride, arsenic, salinity not assessed) |
| **Zoom-dependent** | Results are computed for the current map view; zoomed-out runs may timeout |

---

## 📁 Repository Structure

```
GroundwaterDiscoveryPortal/
├── README.md                     ← You are here
├── METHODOLOGY.md                ← Full scientific methodology with equations
├── CONTRIBUTING.md               ← How to contribute
├── CHANGELOG.md                  ← Version history
├── LICENSE                       ← MIT License
├── .gitignore
│
├── gee/
│   └── groundwater_discovery_portal.js   ← The complete GEE script
│
├── docs/
│   ├── architecture.md           ← System architecture & data flow diagram
│   ├── datasets.md               ← Complete dataset catalog with links
│   └── deployment.md             ← GEE App + washways.org deployment guide
│
└── site/
    └── index.html                ← Landing page for washways.org (embeds GEE app)
```

---

## 🚀 Deployment

### GEE App
The app is published via the GEE Apps platform. See [docs/deployment.md](docs/deployment.md) for step-by-step instructions.

### washways.org/groundwaterdiscoveryportal
The `site/index.html` landing page **embeds the GEE app in an iframe** so users can interact with the portal directly from washways.org. It also provides a direct "Launch App" button as a fallback. Deploy by uploading the `site/` folder to your web host.

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas:
- **Calibration data**: Borehole yield measurements to validate the index
- **Regional adaptation**: Optimal dry-season months and weight presets for new countries
- **New datasets**: Higher-resolution geology, aquifer test results, geophysical layers

---

## 📖 Citation

If you use this tool in your work, please cite:

```
WASHways (2026). Groundwater Discovery Portal: A satellite-derived screening
tool for groundwater potential mapping. https://github.com/washways/GroundwaterDiscoveryPortal
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

The input datasets have their own licenses — see [docs/datasets.md](docs/datasets.md) for details.

---

<p align="center">
  <strong>Built by <a href="https://washways.org">WASHways</a></strong><br>
  <em>Improving water access through open science and technology.</em>
</p>
