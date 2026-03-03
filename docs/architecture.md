# System Architecture — Groundwater Discovery Portal

## Overview

The Groundwater Discovery Portal is a client-side Google Earth Engine (GEE) application. All computation happens server-side on GEE infrastructure; the UI runs in the browser via the GEE Apps framework.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     USER BROWSER                         │
│  ┌──────────────┐  ┌──────────────────────────────────┐ │
│  │   Sidebar     │  │            Map Panel              │ │
│  │  ┌──────────┐ │  │  ┌────────────────────────────┐  │ │
│  │  │ Weights  │ │  │  │  Google Earth Engine Map    │  │ │
│  │  │ Sliders  │ │  │  │  ┌──────────────────────┐  │  │ │
│  │  ├──────────┤ │  │  │  │ Raster Layers:       │  │  │ │
│  │  │ Dry Month│ │  │  │  │ • Base (elv/slope/..)│  │  │ │
│  │  │ Slider   │ │  │  │  │ • Pillar layers      │  │  │ │
│  │  ├──────────┤ │  │  │  │ • Final Index        │  │  │ │
│  │  │Resolution│ │  │  │  └──────────────────────┘  │  │ │
│  │  │ Slider   │ │  │  │                            │  │ │
│  │  ├──────────┤ │  │  │  ┌──────────────────────┐  │  │ │
│  │  │ [RUN]    │ │  │  │  │ Click Popup:         │  │  │ │
│  │  ├──────────┤ │  │  │  │ Score + Diagnostics  │  │  │ │
│  │  │ Auto-    │ │  │  │  └──────────────────────┘  │  │ │
│  │  │ stretch  │ │  │  └────────────────────────────┘  │ │
│  │  ├──────────┤ │  └──────────────────────────────────┘ │
│  │  │ Sources  │ │                                       │
│  │  │ Panel    │ │  ┌──────────────────────────────────┐ │
│  │  └──────────┘ │  │        Modal Overlay              │ │
│  └──────────────┘  │  (Methodology / Source details)    │ │
│                     └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│              GOOGLE EARTH ENGINE SERVERS                  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Data Catalog                                      │  │
│  │  • MERIT Hydro v1.0.1 (elv, hnd, upa)             │  │
│  │  • SoilGrids v2 (clay, sand, cfvo, bdod)          │  │
│  │  • Sentinel-2 SR Harmonized                       │  │
│  │  • FAO GAUL boundaries                            │  │
│  ├────────────────────────────────────────────────────┤  │
│  │  Private Assets (washways project)                 │  │
│  │  • BDTICMM250m (Depth to Bedrock)                 │  │
│  │  • AridityIndexv31yrFixed (Aridity Index v3.1)    │  │
│  ├────────────────────────────────────────────────────┤  │
│  │  Computation Pipeline                              │  │
│  │  1. Clip all inputs to AOI (map bounds)           │  │
│  │  2. Compute Storage pillar (DTB − HAND → log)     │  │
│  │  3. Compute Supply pillar (AI × UPA)              │  │
│  │  4. Compute Yield pillar (5 sub-components)       │  │
│  │  5. Compute Penalty (slope + HAND exponentials)   │  │
│  │  6. Combine: 10 × weighted_pillars × Penalty      │  │
│  │  7. Return tiled raster to browser                │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Computation Pipeline

### Step 1: Area of Interest (AOI) Resolution
When the user clicks **RUN**, the app:
1. Reads the current map bounds
2. Parses them safely (handles multiple format variants)
3. Applies a small padding (8%)
4. Caps the AOI to a maximum span of 6° × 6° to prevent compute failures
5. Falls back to a safe rectangle around map center if bounds are unparseable

### Step 2: Pillar Computation
Each pillar is computed independently and normalised to 0–1:
- **Storage**: DTB − HAND → clamp → log normalise
- **Supply**: AI_norm × UPA_factor
- **Yield**: weighted blend of FracturesN, TPIN, NDVIN, SoilTrans, LithFactor

### Step 3: Constraint
Multiplicative penalty from slope and HAND exponential decay.

### Step 4: Final Index
Weighted sum of pillars × penalty × 10 → Score (0–10).

### Step 5: Rendering
All layers are added to the map. Only the final index is visible by default; diagnostic layers can be toggled.

## Click-to-Query System
When the user clicks any point on the map:
1. A crosshair marker is placed
2. `componentStack.reduceRegion()` samples all 24 bands at the click location
3. Results are displayed in a bottom-left popup with:
   - Final score and classification
   - Pillar bar charts
   - Raw diagnostic values (DTB, HAND, slope, AI, UPA, NDVI, etc.)
4. The popup auto-dismisses after 12 seconds

## Auto-Stretch System
When enabled, the app periodically:
1. Computes the 2nd and 98th percentile of the visible Score layer
2. Re-renders the index layer with this local range
3. Provides much better visual contrast for zoomed-in views
