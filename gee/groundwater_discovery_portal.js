// =========================================================================
// Groundwater Discovery Portal
// Google Earth Engine Application
// 
// Repository: https://github.com/washways/GroundwaterDiscoveryPortal
// Live App:   https://washways.projects.earthengine.app/view/groundwaterdiscoveryportal
// License:    MIT
// 
// See METHODOLOGY.md and docs/ for full scientific documentation.
// See README.md for usage and interpretation guidance.
// =========================================================================
// 
// FIXES in this version:
// 1) LithFactor is now explicitly included in the Sources & components list
// 2) Prevent zoomed-out crashes (List<Object> bounds -> invalid geometry):
//    - Robust bounds parsing
//    - Hard cap AOI size with a safe fallback rectangle
//    - Guardrail: RUN is blocked when zoom is too low (user-friendly message)
// 3) Sidebar guidance updated: how to use properly + why zoom matters.
// =========================================================================
// -------------------------
// CONFIG
// -------------------------
var DEFAULT_CENTER = {lon: 33.7741, lat: -13.9626};
var DEFAULT_ZOOM   = 9;

var USE_SOILGRIDS_KSAT = false;
var USE_GFV_LITHO      = false;

var PALETTE_INDEX = ['#e51f1f', '#f2a134', '#f7e379', '#bbdb44', '#44ce1b'];
var COL_STORAGE = '#1f77b4';
var COL_SUPPLY  = '#2ca02c';
var COL_YIELD   = '#ff7f0e';
var COL_CONSTR  = '#b04a00';

// Zoom guardrail
var MIN_RUN_ZOOM = 7;
var RECOMM_ZOOM  = 9;
var MAX_AOI_DEG  = 6.0;

// -------------------------
// DATA
// -------------------------
var merit = ee.Image("MERIT/Hydro/v1_0_1");
var elv   = merit.select('elv');
var hnd   = merit.select('hnd');
var upa   = merit.select('upa');
var slope = ee.Terrain.slope(elv);

var dtb = ee.Image('projects/washways/assets/BDTICMM250m')
  .divide(100).resample('bilinear').rename('DTB');

var ai = ee.Image('projects/washways/assets/AridityIndexv31yrFixed')
  .multiply(0.0001).resample('bilinear').rename('AI');

var sg_clay = ee.Image('projects/soilgrids-isric/clay_mean');
var sg_sand = ee.Image('projects/soilgrids-isric/sand_mean');
var sg_cfvo = ee.Image('projects/soilgrids-isric/cfvo_mean');
var sg_bdod = ee.Image('projects/soilgrids-isric/bdod_mean');

var sg_ksat = null;
if (USE_SOILGRIDS_KSAT) {
  sg_ksat = ee.Image('projects/soilgrids-isric/ksat_mean');
}

var gfv_precamb = null;
var gfv_quat    = null;
if (USE_GFV_LITHO) {
  gfv_precamb = ee.Image('projects/sat-io/open-datasets/global_freshwater_variables/precambrian_surface_lithology_wsum');
  gfv_quat    = ee.Image('projects/sat-io/open-datasets/global_freshwater_variables/quaternary_surface_lithology_wsum');
}

// -------------------------
// UI
// -------------------------
ui.root.clear();
var map = ui.Map();
map.setOptions('TERRAIN');
map.setCenter(DEFAULT_CENTER.lon, DEFAULT_CENTER.lat, DEFAULT_ZOOM);
try { map.style().set('cursor', 'crosshair'); } catch(e) {}

var sidebar = ui.Panel({style: {width: '720px', padding: '15px', border: '1px solid #ccc'}});
ui.root.add(ui.Panel([sidebar, map], ui.Panel.Layout.flow('horizontal'), {stretch: 'both'}));

// -------------------------
// Modal (Code Editor safe)
// -------------------------
var modalOverlay = ui.Panel({
  style: {
    position: 'top-left',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.55)'
  }
});
modalOverlay.style().set('shown', false);

var modalCard = ui.Panel({
  style: {
    position: 'top-left',
    width: '900px',
    maxHeight: '92%',
    padding: '14px 16px',
    margin: '18px auto 0 auto',
    backgroundColor: 'white',
    border: '1px solid #ddd'
  }
});

modalOverlay.add(ui.Panel([modalCard], ui.Panel.Layout.flow('vertical'), {stretch:'both'}));
ui.root.add(modalOverlay);

function closeModal(){
  modalCard.clear();
  modalOverlay.style().set('shown', false);
}
function openModal(titleText, bodyPanels){
  modalCard.clear();
  var title = ui.Label(titleText, {fontWeight:'bold', fontSize:'16px', margin:'0 0 6px 0'});
  var hint  = ui.Label('Close this panel to return to the map.', {fontSize:'11px', color:'#666', margin:'0 0 10px 0'});
  var closeBtnTop = ui.Button({label:'CLOSE', onClick: closeModal, style:{stretch:'horizontal', fontWeight:'bold', margin:'0 0 10px 0'}});
  var closeBtnBot = ui.Button({label:'CLOSE', onClick: closeModal, style:{stretch:'horizontal', fontWeight:'bold', margin:'10px 0 0 0'}});
  modalCard.add(title).add(hint).add(closeBtnTop);

  var body = ui.Panel({style:{maxHeight:'640px', padding:'8px', border:'1px solid #eee', backgroundColor:'#fafafa'}});
  if (bodyPanels && bodyPanels.length) bodyPanels.forEach(function(p){ body.add(p); });
  modalCard.add(body).add(closeBtnBot);

  modalOverlay.style().set('shown', true);
}
function linkLabel(text, url) {
  return ui.Label({value: text, style:{fontSize:'11px', color:'#1a73e8'}, targetUrl: url});
}

// -------------------------
// HELPERS (robust bounds + AOI guard)
// -------------------------
function okNum(x){ return x !== null && x !== undefined && isFinite(Number(x)); }

function parseBounds(b){
  if (!b) return null;
  if (b.length === 4 && okNum(b[0]) && okNum(b[1]) && okNum(b[2]) && okNum(b[3])) {
    return {west:Number(b[0]), south:Number(b[1]), east:Number(b[2]), north:Number(b[3])};
  }
  if (typeof b === 'object') {
    var west  = (b.west  !== undefined) ? b.west  : (b.left   !== undefined ? b.left   : null);
    var east  = (b.east  !== undefined) ? b.east  : (b.right  !== undefined ? b.right  : null);
    var south = (b.south !== undefined) ? b.south : (b.bottom !== undefined ? b.bottom : null);
    var north = (b.north !== undefined) ? b.north : (b.top    !== undefined ? b.top    : null);
    if (okNum(west) && okNum(south) && okNum(east) && okNum(north)) {
      return {west:Number(west), south:Number(south), east:Number(east), north:Number(north)};
    }
  }
  return null;
}

function safeRectangle(lon0, lat0, degSpan){
  var d = Math.max(0.2, Math.min(MAX_AOI_DEG, degSpan || 2.0)) / 2;
  return ee.Geometry.Rectangle([lon0-d, lat0-d, lon0+d, lat0+d], null, false);
}

function getBoundedAOI(padFrac){
  var z = map.getZoom() || DEFAULT_ZOOM;
  var c = map.getCenter() || DEFAULT_CENTER;
  var lon0 = Number(c.lon), lat0 = Number(c.lat);
  var b = parseBounds(map.getBounds());
  var pad = (padFrac || 0);
  if (!b) return safeRectangle(lon0, lat0, Math.min(MAX_AOI_DEG, 3.0));
  var west=b.west, south=b.south, east=b.east, north=b.north;
  var w=(east-west), h=(north-south);
  var px=w*pad, py=h*pad;
  west-=px; east+=px; south-=py; north+=py;
  var spanLon = east - west;
  var spanLat = north - south;
  if (spanLon > MAX_AOI_DEG || spanLat > MAX_AOI_DEG) {
    return safeRectangle(lon0, lat0, MAX_AOI_DEG);
  }
  south=Math.max(-89.999, south); north=Math.min(89.999, north);
  if (east < west) {
    return safeRectangle(lon0, lat0, Math.min(MAX_AOI_DEG, 4.0));
  }
  return ee.Geometry.Rectangle([west,south,east,north], null, false);
}

function ensureDefaultProj(img, scale){
  return ee.Image(img).setDefaultProjection('EPSG:4326', null, scale);
}

function soilTop60WeightedMean(img){
  var b0 = img.select(0), b1 = img.select(1), b2 = img.select(2), b3 = img.select(3);
  var w0 = 5, w1 = 10, w2 = 15, w3 = 30;
  return b0.multiply(w0).add(b1.multiply(w1)).add(b2.multiply(w2)).add(b3.multiply(w3))
    .divide(w0+w1+w2+w3);
}

function maskS2(img){
  var qa = img.select('QA60');
  var cloud = qa.bitwiseAnd(1 << 10).neq(0);
  var cirr  = qa.bitwiseAnd(1 << 11).neq(0);
  return img.updateMask(cloud.or(cirr).not());
}

function crosshairGeom(lon, lat, meters){
  var dLat = meters / 111320.0;
  var dLon = meters / (111320.0 * Math.max(0.2, Math.cos(lat * Math.PI/180.0)));
  var h = ee.Geometry.LineString([[lon - dLon, lat], [lon + dLon, lat]]);
  var v = ee.Geometry.LineString([[lon, lat - dLat], [lon, lat + dLat]]);
  return ee.Geometry.MultiLineString([h.coordinates(), v.coordinates()]);
}

// -------------------------
// Auto-stretch
// -------------------------
var autoStretchEnabled = false;
var stretchTimer = null;
var resultLayer = null;
var mainLayerIndex = null;

var stretchInfo = ui.Label(
  'Auto-stretch: OFF. When ON, the map rescales the index to the 2nd-98th percentile of the current view so contrast is clearer (best when zoomed in).',
  {fontSize:'11px', color:'#555', whiteSpace:'pre-wrap'}
);

function scheduleAutoStretch(){
  if(!autoStretchEnabled || !resultLayer) return;
  if((map.getZoom() || 0) < RECOMM_ZOOM){
    stretchInfo.setValue('Auto-stretch: ON. Zoom in (>=' + RECOMM_ZOOM + ') for stable local percentiles.');
    return;
  }
  if(stretchTimer){ try{ stretchTimer.cancel(); }catch(e){} }
  stretchTimer = ui.util.setTimeout(applyAutoStretch, 650);
}

function applyAutoStretch(){
  if(!autoStretchEnabled || !resultLayer) return;
  if((map.getZoom() || 0) < RECOMM_ZOOM) return;
  var geom = getBoundedAOI(0.05);
  var scale = Math.max(2500, map.getScale() * 7);
  resultLayer.reduceRegion({
    reducer: ee.Reducer.percentile([2,98]),
    geometry: geom,
    scale: scale,
    bestEffort: true,
    tileScale: 8,
    maxPixels: 1e8
  }).evaluate(function(stats){
    if(stats && stats.Score_p2 !== null && stats.Score_p98 !== null && mainLayerIndex !== null){
      var minV = stats.Score_p2, maxV = stats.Score_p98;
      if(maxV <= minV) maxV = minV + 0.1;
      map.layers().set(
        mainLayerIndex,
        ui.Map.Layer(resultLayer, {min:minV, max:maxV, palette:PALETTE_INDEX}, 'Groundwater Potential Index (Stretched)')
      );
      stretchInfo.setValue('Auto-stretch: ON (local p2-p98): ' + minV.toFixed(2) + '-' + maxV.toFixed(2));
    } else {
      stretchInfo.setValue('Auto-stretch: ON (failed-zoom in and try again).');
    }
  });
}
map.onChangeBounds(function(){ if(autoStretchEnabled) scheduleAutoStretch(); });

// -------------------------
// Header + usage guidance
// -------------------------
var header = ui.Label('Groundwater Discovery Portal', {fontSize: '24px', fontWeight: 'bold'});
var usage  = ui.Label(
  'How to use (important):\n' +
  '- Start zoomed in. If you run the model while zoomed out, the AOI becomes huge and the app may fail or be very slow.\n' +
  '- Recommended: zoom to at least level ' + RECOMM_ZOOM + ' (a district / catchment scale view), then RUN.\n' +
  '- For national scans, export a precomputed raster (recommended) rather than interactive RUN.\n\n' +
  'The index is a screening tool. A high score should be explainable using the pillar layers before field verification.',
  {fontSize:'12px', color:'#444', whiteSpace:'pre-wrap'}
);

var legend = ui.Panel({
  style: {padding: '6px', margin: '10px 0', backgroundColor: '#f8f9fa', border: '1px solid #ddd'},
  layout: ui.Panel.Layout.Flow('horizontal')
});
['V. Low','Low','Med','High','Exceptional'].forEach(function(lbl, i){
  legend.add(ui.Label({style:{backgroundColor: PALETTE_INDEX[i], padding:'8px', margin:'0 2px'}}));
  legend.add(ui.Label(lbl, {fontSize:'10px', margin:'4px 8px 0 0'}));
});

// -------------------------
// Controls
// -------------------------
var s_storage = ui.Slider({min:0, max:100, value:40, step:5, style:{width:'580px'}});
var s_supply  = ui.Slider({min:0, max:100, value:30, step:5, style:{width:'580px'}});
var s_yield   = ui.Slider({min:0, max:100, value:30, step:5, style:{width:'580px'}});
var dry_month = ui.Slider({min:1, max:12, value:9, step:1, style:{width:'580px'}});
var res_slider = ui.Slider({min:90, max:500, value:250, step:10, style:{width:'580px'}});
var res_label  = ui.Label('Output scale: 250 m', {fontSize:'11px', color:'#555'});
res_slider.onChange(function(v){ res_label.setValue('Output scale: ' + Math.round(v) + ' m'); });
var statusLine = ui.Label('', {fontSize:'11px', color:'#b00020', whiteSpace:'pre-wrap', margin:'6px 0 0 0'});

// -------------------------
// Methodology modal
// -------------------------
function methodBlock(title, color, paragraphs){
  var p = ui.Panel({style:{margin:'10px 0', padding:'10px', border:'1px solid #e5e5e5', backgroundColor:'white'}});
  p.add(ui.Label(title, {fontWeight:'bold', fontSize:'13px', color:color, margin:'0 0 6px 0'}));
  paragraphs.forEach(function(t){
    p.add(ui.Label(t, {fontSize:'11px', color:'#333', whiteSpace:'pre-wrap', margin:'6px 0 0 0'}));
  });
  return p;
}

function openMethodologyModal(){
  var blocks = [];
  blocks.push(ui.Label(
    'The index combines three scaled pillars (0-1) and a terrain constraint (0-1).\n' +
    'Pillars are combined using your weights (normalised to sum to 1). The final index is 0-10.',
    {fontSize:'12px', color:'#444', whiteSpace:'pre-wrap', margin:'0 0 8px 0'}
  ));
  blocks.push(methodBlock('Storage pillar (0-1)', COL_STORAGE, [
    'Inputs: DTB (m) from projects/washways/assets/BDTICMM250m and HAND (m) from MERIT.\nIntermediate: DTB_minus_HAND = DTB - HAND.',
    'Exact scaling:\n- Storage_raw_m = min( max(DTB_minus_HAND, 0), 200 )\n- Storage = log(1 + Storage_raw_m) / log(201)',
    'Why:\n- Clamp: prevents a few extreme pixels dominating.\n- log(1+x): compresses tail while keeping 0->0.\n- /log(201): normalises 200 m -> 1.'
  ]));
  blocks.push(methodBlock('Supply pillar (0-1)', COL_SUPPLY, [
    'Supply = AI_norm x UPA_factor.\nAI_norm = unitScale(clamp(AI, 0.05..1.5)).\nUPA_factor = unitScale(clamp(log10(UPA), -2..4)).'
  ]));
  blocks.push(methodBlock('Yield pillar (0-1)', COL_YIELD, [
    'Yield is a conservative blend of multiple signals:\nFracturesN (lineament heuristic), TPIN (convergence), NDVIN (dry-season vegetation signal), SoilTrans (soil proxy), and LithFactor.',
    'LithFactor:\n- If GFV lithology layers are enabled and accessible, LithFactor is derived from them.\n- Otherwise LithFactor is a neutral constant 0.5 (so it does not materially drive results).'
  ]));
  blocks.push(methodBlock('Constraint (0-1)', COL_CONSTR, [
    'PenaltyRaw = exp(-0.15*slope) x exp(-0.1*HAND).'
  ]));
  blocks.push(methodBlock('Final (0-10)', '#333', [
    'Score = 10 x (wS*Storage + wQ*Supply + wY*Yield) x Penalty.'
  ]));
  openModal('Methodology (detailed)', blocks);
}

// -------------------------
// Sources registry (LithFactor always included)
// -------------------------
var refItems = [
  {id:'merit', title:'MERIT Hydro (Elevation / HAND / UPA)', layer:'MERIT Elevation, HAND, UPA_factor (via UPA)', pillar:'Base + Supply + Constraint', resolution:'~90 m', assetOrMethod:'MERIT/Hydro/v1_0_1', links:[{label:'EE dataset catalog', url:'https://developers.google.com/earth-engine/datasets/catalog/MERIT_Hydro_v1_0_1'}], notes:'Core hydro-topographic layers. Slope is derived from MERIT elevation.'},
  {id:'slope', title:'Slope (derived)', layer:'Slope (deg)', pillar:'Constraint', resolution:'~90 m', assetOrMethod:'ee.Terrain.slope(elv)', links:[{label:'ee.Terrain.slope docs', url:'https://developers.google.com/earth-engine/apidocs/ee-terrain-slope'}], notes:'Slope computed from MERIT elevation.'},
  {id:'dtb', title:'Depth to bedrock (DTB)', layer:'DTB (m)', pillar:'Storage', resolution:'250 m source', assetOrMethod:'projects/washways/assets/BDTICMM250m (cm->m)', links:[], notes:'Capacity proxy input for Storage.'},
  {id:'ai', title:'Aridity Index v3.1 (AI)', layer:'AI_norm (0-1)', pillar:'Supply', resolution:'varies', assetOrMethod:'projects/washways/assets/AridityIndexv31yrFixed (scaled)', links:[{label:'Figshare: Global Aridity Index v3', url:'https://figshare.com/articles/dataset/Global_Aridity_Index_and_Potential_Evapotranspiration_ETO_Climate_Database_v3/7504448'}], notes:'AI is scaled to AI_norm using clamp(0.05..1.5) then unitScale.'},
  {id:'fractures', title:'Fractures heuristic (derived)', layer:'FracturesN (0-1)', pillar:'Yield', resolution:'Output scale', assetOrMethod:'Canny edges on MERIT elevation + smoothing', links:[{label:'CannyEdgeDetector docs', url:'https://developers.google.com/earth-engine/apidocs/ee-algorithms-cannyedgedetector'}], notes:'Heuristic lineaments proxy; not mapped faults.'},
  {id:'tpi', title:'TPI proxy (derived)', layer:'TPIN (0-1)', pillar:'Yield', resolution:'Output scale', assetOrMethod:'elv - focal_mean(elv, 250 m)', links:[{label:'Image.focal_mean docs', url:'https://developers.google.com/earth-engine/apidocs/ee-image-focal_mean'}], notes:'Valley/convergence tendency.'},
  {id:'s2', title:'Sentinel-2 SR Harmonized', layer:'NDVI (10 m diagnostic) + NDVIN (model)', pillar:'Yield', resolution:'10 m (then aggregated)', assetOrMethod:'COPERNICUS/S2_SR_HARMONIZED', links:[{label:'EE dataset catalog', url:'https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED'}], notes:'Dry-month NDVI proxy. Model uses aggregated NDVI; 10 m is shown for diagnostics.'},
  {id:'soilgrids', title:'SoilGrids v2 (clay/sand/cfvo/bdod)', layer:'SoilTrans (0-1) + soil components', pillar:'Yield', resolution:'250 m', assetOrMethod:'projects/soilgrids-isric/*', links:[{label:'EE SoilGrids v2 catalog', url:'https://developers.google.com/earth-engine/datasets/catalog/ISRIC_SoilGrids250m_v2_0'},{label:'GEE community catalog (ISRIC)', url:'https://gee-community-catalog.org/projects/isric/'}], notes:'Depth-weighted 0-60 cm used for SoilTrans proxy.'},
  {id:'lithfactor', title:'LithFactor (yield prior)', layer:'LithFactor (0-1)', pillar:'Yield', resolution:(USE_GFV_LITHO ? '~1 km (GFV source, resampled)' : 'Constant (0.5)'), assetOrMethod:(USE_GFV_LITHO ? 'GFV quaternary vs precambrian wsum (sat-io)' : 'Neutral constant 0.5 (no lithology layer enabled)'), links:(USE_GFV_LITHO ? [{label:'GFV community page', url:'https://gee-community-catalog.org/projects/gfv/'}] : []), notes:(USE_GFV_LITHO ? 'Coarse lithology prior used lightly.' : 'Neutral placeholder so lithology does not drive results unless enabled.')},
  {id:'penalty', title:'Penalty / terrain constraint (derived)', layer:'Penalty (0-1)', pillar:'Constraint', resolution:'Output scale', assetOrMethod:'exp(-0.15*slope)*exp(-0.1*HAND)', links:[], notes:'Conservative suppression of steep/high-above-drainage pixels.'},
  {id:'index', title:'Groundwater Potential Index (output)', layer:'Groundwater Potential Index', pillar:'Output', resolution:'Output scale', assetOrMethod:'10*(weighted pillars)*Penalty', links:[], notes:'Final screening score (0-10).'}
];

if (USE_SOILGRIDS_KSAT) {
  refItems.push({id:'ksat_opt', title:'SoilGrids Ksat (optional)', layer:'Ksat_norm -> SoilTrans', pillar:'Yield', resolution:'250 m', assetOrMethod:'projects/soilgrids-isric/ksat_mean', links:[{label:'EE SoilGrids v2 catalog', url:'https://developers.google.com/earth-engine/datasets/catalog/ISRIC_SoilGrids250m_v2_0'}], notes:'Only used if enabled AND accessible.'});
}

function openReferenceModal(item){
  var blocks = [];
  blocks.push(ui.Label(item.title, {fontWeight:'bold', fontSize:'14px'}));
  blocks.push(ui.Label('Layer(s): ' + item.layer, {fontSize:'12px', color:'#444'}));
  blocks.push(ui.Label('Contributes to: ' + item.pillar, {fontSize:'12px', color:'#444'}));
  blocks.push(ui.Label('Resolution: ' + item.resolution, {fontSize:'12px', color:'#444'}));
  blocks.push(ui.Label('Asset / method: ' + item.assetOrMethod, {fontSize:'12px', color:'#444', whiteSpace:'pre-wrap'}));
  blocks.push(ui.Label('', {margin:'6px 0'}));
  blocks.push(ui.Label(item.notes, {fontSize:'12px', color:'#333', whiteSpace:'pre-wrap'}));
  if (item.links && item.links.length) {
    blocks.push(ui.Label('', {margin:'8px 0'}));
    blocks.push(ui.Label('Links', {fontWeight:'bold', fontSize:'12px'}));
    item.links.forEach(function(L){
      blocks.push(ui.Panel([linkLabel(L.label, L.url), ui.Label(L.url, {fontSize:'10px', color:'#777'})], ui.Panel.Layout.flow('vertical'), {stretch:'horizontal'}));
    });
  }
  openModal('Source details', blocks);
}

function sourceRow(item){
  var row = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'), style:{padding:'6px 8px', margin:'4px 0', border:'1px solid #e5e5e5', backgroundColor:'white'}});
  var dotColor = '#999';
  if (String(item.pillar).indexOf('Storage') !== -1) dotColor = COL_STORAGE;
  else if (String(item.pillar).indexOf('Supply') !== -1) dotColor = COL_SUPPLY;
  else if (String(item.pillar).indexOf('Yield') !== -1) dotColor = COL_YIELD;
  else if (String(item.pillar).indexOf('Constraint') !== -1) dotColor = COL_CONSTR;
  var dot = ui.Label(' ', {backgroundColor:dotColor, padding:'8px', margin:'2px 10px 0 0'});
  var t1 = ui.Label(item.title, {fontSize:'12px', fontWeight:'bold', margin:'0 0 2px 0'});
  var t2 = ui.Label(item.layer + '  -  ' + item.resolution, {fontSize:'10px', color:'#666'});
  var textCol = ui.Panel([t1, t2], ui.Panel.Layout.flow('vertical'), {stretch:'horizontal'});
  var btn = ui.Button({label:'DETAILS', onClick:function(){ openReferenceModal(item); }, style:{margin:'0 0 0 10px'}});
  row.add(dot).add(textCol).add(btn);
  return row;
}

var sourcesPanel = ui.Panel({style:{padding:'8px', border:'1px solid #ddd', backgroundColor:'#fafafa', margin:'10px 0 0 0'}});
sourcesPanel.add(ui.Label('Sources & components (complete)', {fontWeight:'bold', margin:'0 0 6px 0'}));
sourcesPanel.add(ui.Label('Each item opens full details + links (where available).', {fontSize:'11px', color:'#666', margin:'0 0 6px 0'}));
refItems.forEach(function(it){ sourcesPanel.add(sourceRow(it)); });

var methodology = ui.Panel([
  ui.Label('Theoretical Framework (Source-Pathway-Receptor):', {fontWeight: 'bold', fontSize: '14px', margin: '15px 0 5px 0'}),
  ui.Label('Pillar 1: Saturated Storage Capacity (The Receptor)', {fontWeight: 'bold', fontSize: '12px'}),
  ui.Label('In crystalline basement aquifers, groundwater is primarily hosted in the weathered regolith (saprolite). We calculate "Saturated Storage" as (DTB - HAND). This identifies zones where the weathered mantle is deep enough to exist below the local water table (drainage base-level). Hilltops with deep bedrock may still be dry if they are too far above the drainage line.', {fontSize: '11px', margin: '0 0 10px 0'}),
  ui.Label('Pillar 2: Climatic Supply Flux (The Source)', {fontWeight: 'bold', fontSize: '12px'}),
  ui.Label('Using the Global Aridity Index v3.1 (FAO-56 PM), we model the moisture budget available for deep infiltration after satisfying Potential Evapotranspiration (PET).', {fontSize: '11px', margin: '0 0 10px 0'}),
  ui.Label('Pillar 3: Yield & Transmissivity Proxies (The Pathway)', {fontWeight: 'bold', fontSize: '12px'}),
  ui.Label('We synthesize structural highways: Gaussian-blurred fractures identify the 100m damage zones around faults. Topographic Position (TPI) identifies valley convergence. NDVI from the late dry season serves as a biological sensor for phreatophytes accessing shallow groundwater.', {fontSize: '11px', margin: '0 0 10px 0'}),
  ui.Label('Penalty: Topographic Multiplicative Constraint', {fontWeight: 'bold', fontSize: '12px', color: '#d35400'}),
  ui.Label('This model rejects the "Additive Fallacy" where mountains show high potential due to fractures alone. Instead, we use a multiplicative penalty for high Slopes and HAND values. In steep rocky terrain, gravity moves water as runoff before it can infiltrate, correctly collapsing the score to Zero.', {fontSize: '11px', color: '#d35400', margin: '0 0 10px 0'})
]);

// -------------------------
// Sidebar layout
// -------------------------
sidebar.add(header).add(usage).add(methodology).add(legend);
sidebar.add(ui.Button({
  label:'OPEN DETAILED METHODOLOGY',
  onClick: openMethodologyModal,
  style:{stretch:'horizontal', fontWeight:'bold', margin:'8px 0 0 0'}
}));
sidebar
  .add(ui.Label('Storage weight', {fontWeight:'bold', color:COL_STORAGE, margin:'12px 0 2px 0'})).add(s_storage)
  .add(ui.Label('Supply weight',  {fontWeight:'bold', color:COL_SUPPLY,  margin:'8px 0 2px 0'})).add(s_supply)
  .add(ui.Label('Yield weight',   {fontWeight:'bold', color:COL_YIELD,   margin:'8px 0 2px 0'})).add(s_yield)
  .add(ui.Label('Dry-season NDVI month', {margin:'8px 0 2px 0'})).add(dry_month)
  .add(ui.Label('Resolution (smaller = finer):', {margin:'8px 0 2px 0'})).add(res_slider).add(res_label);

function guardCanRun(){
  var z = map.getZoom() || 0;
  if (z < MIN_RUN_ZOOM) {
    statusLine.setValue(
      'Blocked: you are zoomed out too far (zoom ' + z + ').\n' +
      'Zoom in to at least ' + MIN_RUN_ZOOM + ' (recommended >=' + RECOMM_ZOOM + '), then click RUN.'
    );
    return false;
  }
  statusLine.setValue('');
  return true;
}

sidebar
  .add(ui.Button({
    label:'RUN',
    onClick: function(){ if (guardCanRun()) runModel(); },
    style:{stretch:'horizontal', fontWeight:'bold', margin:'12px 0 0 0'}
  }))
  .add(ui.Checkbox('Auto-stretch (p2-p98)', false, function(c){
    autoStretchEnabled = c;
    if(!c){ stretchInfo.setValue('Auto-stretch: OFF. Fixed legend range 1-7.'); if (guardCanRun()) runModel(); }
    else { scheduleAutoStretch(); }
  }))
  .add(stretchInfo)
  .add(statusLine)
  .add(sourcesPanel);

// -------------------------
// Model runtime state
// -------------------------
var componentStack = null;
var clickLayerIndex = null;
var popupPanel = null;

// -------------------------
// RUN MODEL
// -------------------------
function runModel(){
  var OUT_SCALE = Number(res_slider.getValue());
  var NDVI_SCL  = Math.max(OUT_SCALE, 120);
  var v1=s_storage.getValue(), v2=s_supply.getValue(), v3=s_yield.getValue();
  var total=v1+v2+v3 || 1;
  var n=[v1/total, v2/total, v3/total];
  var aoi = getBoundedAOI(0.08);

  var dtb_v   = dtb.clip(aoi).reproject({crs:'EPSG:4326', scale: OUT_SCALE});
  var hnd_v   = hnd.clip(aoi).reproject({crs:'EPSG:4326', scale: OUT_SCALE});
  var slope_v = slope.clip(aoi).reproject({crs:'EPSG:4326', scale: OUT_SCALE});
  var elv_v   = elv.clip(aoi).reproject({crs:'EPSG:4326', scale: OUT_SCALE});

  // STORAGE
  var dtb_minus_hand = dtb_v.subtract(hnd_v).rename('DTB_minus_HAND');
  var storage_raw = dtb_minus_hand.max(0).min(200).rename('Storage_raw_m');
  var storage = storage_raw.add(1).log().divide(ee.Number(201).log()).clamp(0,1).rename('Storage');

  // SUPPLY
  var ai_norm = ai.clip(aoi).reproject({crs:'EPSG:4326', scale: OUT_SCALE})
    .clamp(0.05, 1.5).unitScale(0.05, 1.5).rename('AI_norm');
  var upa_factor = upa.clip(aoi).max(1e-6).log10()
    .reproject({crs:'EPSG:4326', scale: OUT_SCALE})
    .unitScale(-2, 4).clamp(0, 1).rename('UPA_factor');
  var supply = ai_norm.multiply(upa_factor).clamp(0,1).rename('Supply');

  // YIELD components
  var fracturesRaw = ee.Algorithms.CannyEdgeDetector(elv.clip(aoi), 10, 1)
    .convolve(ee.Kernel.gaussian(150, 100, 'meters'))
    .rename('FracturesRaw').clip(aoi);
  var fracturesN = ensureDefaultProj(fracturesRaw, OUT_SCALE)
    .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024})
    .unitScale(0, 0.30).clamp(0,1).rename('FracturesN')
    .reproject({crs:'EPSG:4326', scale: OUT_SCALE});

  var tpiRaw = elv.clip(aoi).subtract(elv.clip(aoi).focal_mean(250, 'circle', 'meters'))
    .unitScale(-5,5).rename('TPI_raw_scaled').clip(aoi);
  var tpiN = ensureDefaultProj(tpiRaw, OUT_SCALE)
    .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024})
    .clamp(0,1).rename('TPIN')
    .reproject({crs:'EPSG:4326', scale: OUT_SCALE});

  var s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
    .filterBounds(aoi)
    .filterDate('2024-01-01', '2025-12-31')
    .filter(ee.Filter.calendarRange(dry_month.getValue(), dry_month.getValue(), 'month'))
    .map(maskS2)
    .median()
    .clip(aoi);
  var ndviRaw = s2.normalizedDifference(['B8','B4']).rename('NDVI_raw').clip(aoi);
  var ndvi10m = ensureDefaultProj(ndviRaw, 10)
    .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024})
    .rename('NDVI_10m')
    .reproject({crs:'EPSG:4326', scale: 10});
  var ndviN = ensureDefaultProj(ndviRaw, NDVI_SCL)
    .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024})
    .unitScale(0.05, 0.60).clamp(0,1).rename('NDVIN')
    .reproject({crs:'EPSG:4326', scale: NDVI_SCL})
    .reproject({crs:'EPSG:4326', scale: OUT_SCALE});

  // SoilTrans proxy
  var clay60 = soilTop60WeightedMean(sg_clay).divide(10).rename('Clay_pct');
  var sand60 = soilTop60WeightedMean(sg_sand).divide(10).rename('Sand_pct');
  var cfvo60 = soilTop60WeightedMean(sg_cfvo).divide(10).rename('CFVO_pct');
  var bdod60 = soilTop60WeightedMean(sg_bdod).divide(100).rename('BDOD_kgdm3');
  var sandN = sand60.clamp(0,100).unitScale(20,80).clamp(0,1);
  var clayN = clay60.clamp(0,100).unitScale(10,60).clamp(0,1);
  var cfvoN = cfvo60.clamp(0,70).unitScale(0,50).clamp(0,1);
  var bdodN = bdod60.clamp(0.9,1.8).unitScale(0.9,1.8).clamp(0,1);
  var soil_perm = sandN.multiply(0.45)
    .add(cfvoN.multiply(0.20))
    .add(ee.Image(1).subtract(clayN).multiply(0.25))
    .add(ee.Image(1).subtract(bdodN).multiply(0.10))
    .clamp(0,1).rename('SoilPerm');
  var soil_trans = soil_perm;
  if (USE_SOILGRIDS_KSAT) {
    var ksat60 = soilTop60WeightedMean(sg_ksat);
    var ksat_norm = ksat60.max(1e-6).log10().unitScale(-2, 2).clamp(0,1).rename('Ksat_norm');
    soil_trans = ksat_norm.unmask(soil_perm).clamp(0,1);
  }
  soil_trans = soil_trans.rename('SoilTrans').reproject({crs:'EPSG:4326', scale: OUT_SCALE}).clip(aoi);

  // LithFactor
  var lith_factor = ee.Image(0.5).rename('LithFactor');
  if (USE_GFV_LITHO) {
    var lithQ = gfv_quat.clip(aoi).max(0).add(1).log();
    var lithP = gfv_precamb.clip(aoi).max(0).add(1).log();
    lith_factor = lithQ.subtract(lithP).unitScale(-1, 1).clamp(0,1).rename('LithFactor');
  }
  lith_factor = lith_factor.reproject({crs:'EPSG:4326', scale: OUT_SCALE});

  var yield_p = fracturesN.multiply(0.28)
    .add(tpiN.multiply(0.16))
    .add(ndviN.multiply(0.16))
    .add(soil_trans.multiply(0.28))
    .add(lith_factor.multiply(0.12))
    .clamp(0,1).rename('Yield')
    .reproject({crs:'EPSG:4326', scale: OUT_SCALE});

  // CONSTRAINT
  var penaltyRaw = slope.clip(aoi).multiply(-0.15).exp()
    .multiply(hnd.clip(aoi).multiply(-0.1).exp())
    .rename('PenaltyRaw').clip(aoi);
  var penalty = ensureDefaultProj(penaltyRaw, OUT_SCALE)
    .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024})
    .rename('Penalty')
    .reproject({crs:'EPSG:4326', scale: OUT_SCALE});

  // FINAL
  resultLayer = storage.multiply(n[0])
    .add(supply.multiply(n[1]))
    .add(yield_p.multiply(n[2]))
    .multiply(penalty)
    .multiply(10)
    .rename('Score')
    .clip(aoi)
    .reproject({crs:'EPSG:4326', scale: OUT_SCALE});

  // Stack for clicks
  componentStack = ee.Image.cat([
    elv_v.rename('elv'), slope_v.rename('slope'), hnd_v.rename('hnd'),
    dtb_v.rename('DTB'), dtb_minus_hand.rename('DTB_minus_HAND'),
    storage_raw.rename('Storage_raw_m'), storage.rename('Storage'),
    ai_norm.rename('AI_norm'), upa_factor.rename('UPA_factor'), supply.rename('Supply'),
    fracturesN.rename('FracturesN'), tpiN.rename('TPIN'),
    ndvi10m.rename('NDVI_10m'), ndviN.rename('NDVIN'),
    clay60.rename('Clay_pct'), sand60.rename('Sand_pct'),
    cfvo60.rename('CFVO_pct'), bdod60.rename('BDOD_kgdm3'),
    soil_perm.rename('SoilPerm'), soil_trans.rename('SoilTrans'),
    lith_factor.rename('LithFactor'), yield_p.rename('Yield'),
    penalty.rename('Penalty'), resultLayer.rename('Score')
  ]).reproject({crs:'EPSG:4326', scale: OUT_SCALE}).clip(aoi);

  // Render
  map.layers().reset();
  clickLayerIndex = null;
  map.addLayer(elv_v,   {min:0, max:2000}, 'MERIT Elevation', false);
  map.addLayer(slope_v, {min:0, max:25},   'Slope (deg)', false);
  map.addLayer(hnd_v,   {min:0, max:60},   'HAND (m)', false);
  map.addLayer(dtb_v,     {min:0, max:150, palette:['3b2f2f','ffffff']}, 'DTB (m)', false);
  map.addLayer(storage,   {min:0, max:1, palette:['ffffff', COL_STORAGE]}, 'Pillar: Storage (0-1)', false);
  map.addLayer(ai_norm,   {min:0, max:1, palette:['ffffff', COL_SUPPLY]},  'AI_norm (0-1)', false);
  map.addLayer(upa_factor,{min:0, max:1, palette:['ffffff', COL_SUPPLY]},  'UPA_factor (0-1)', false);
  map.addLayer(supply,    {min:0, max:1, palette:['ffffff', COL_SUPPLY]},  'Pillar: Supply (0-1)', false);
  map.addLayer(ndvi10m,   {min:0.05, max:0.6, palette:['ffffff', COL_YIELD]}, 'NDVI (10 m, diagnostic)', false);
  map.addLayer(soil_trans,{min:0, max:1, palette:['ffffff', COL_YIELD]},      'SoilTrans (0-1)', false);
  map.addLayer(yield_p,   {min:0, max:1, palette:['ffffff', COL_YIELD]},      'Pillar: Yield (0-1)', false);
  map.addLayer(penalty,   {min:0, max:1, palette:['ffffff', COL_CONSTR]},     'Penalty (0-1)', false);
  map.addLayer(resultLayer, {min:1, max:7, palette:PALETTE_INDEX}, 'Groundwater Potential Index', true);
  mainLayerIndex = map.layers().length() - 1;
  map.centerObject(aoi, Math.max(RECOMM_ZOOM, map.getZoom() || DEFAULT_ZOOM));
  if(autoStretchEnabled) scheduleAutoStretch();
}

// -------------------------
// CLICK POPUP
// -------------------------
function classifyIndex(score){
  if (!isFinite(score)) return {label:'NA', msg:'No data at this point.'};
  if (score < 2.0) return {label:'Very Low', msg:'Low combined evidence. De-prioritise unless strong local knowledge exists.'};
  if (score < 3.5) return {label:'Low',      msg:'Some signal, but weak. Use component layers + boreholes to justify.'};
  if (score < 5.0) return {label:'Medium',   msg:'Promising. Identify the driving pillar(s) and verify locally.'};
  if (score < 6.2) return {label:'High',     msg:'Strong screening signal. Good candidate for verification work.'};
  return            {label:'Exceptional', msg:'Top-tier screening signal. Still verify geology, siting constraints, and water quality.'};
}
function classifyPillar(x){
  if (!isFinite(x)) return 'NA';
  if (x < 0.25) return 'Low';
  if (x < 0.55) return 'Moderate';
  return 'High';
}
function pillarBar(name, value, color){
  var v = isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  var pct = Math.round(v * 100);
  var row = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'), style:{margin:'3px 0'}});
  row.add(ui.Label(name, {fontSize:'11px', width:'70px', fontWeight:'bold', color:color}));
  var bg = ui.Panel({style:{width:'220px', height:'12px', backgroundColor:'#e0e0e0', margin:'3px 8px 0 0'}});
  var fg = ui.Panel({style:{width:(2.2*pct)+'px', height:'12px', backgroundColor:color}});
  bg.add(fg);
  row.add(bg);
  row.add(ui.Label(pct + '%  (' + classifyPillar(value) + ')', {fontSize:'11px', width:'140px'}));
  return row;
}

map.onClick(function(coords){
  if(!resultLayer || !componentStack) return;
  var lon = coords.lon, lat = coords.lat;
  var OUT_SCALE = Number(res_slider.getValue());
  try{
    var meters = Math.max(120, OUT_SCALE * 2.5);
    var ch = crosshairGeom(lon, lat, meters);
    var chLayer = ui.Map.Layer(ee.FeatureCollection([ee.Feature(ch)]), {color:'00FFFF'}, 'Clicked point', true);
    if (clickLayerIndex === null) { map.layers().insert(0, chLayer); clickLayerIndex = 0; }
    else { map.layers().set(clickLayerIndex, chLayer); }
  } catch(e){}
  var pt = ee.Geometry.Point([lon, lat]);
  componentStack.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: pt,
    scale: OUT_SCALE,
    bestEffort: true,
    tileScale: 4,
    maxPixels: 1e7
  }).evaluate(function(val){
    if(!val) return;
    function f(x, d){ return (isFinite(Number(x)) ? Number(x).toFixed(d) : 'NA'); }
    var score = Number(val.Score);
    var stor  = Number(val.Storage);
    var supp  = Number(val.Supply);
    var yld   = Number(val.Yield);
    var cls = classifyIndex(score);
    if (popupPanel) { try { map.remove(popupPanel); } catch(e) {} popupPanel = null; }
    popupPanel = ui.Panel({
      style:{position:'bottom-left', padding:'10px', width:'460px', border:'1px solid #ccc', backgroundColor:'rgba(255,255,255,0.93)'}
    });
    popupPanel.add(ui.Label('Selected point', {fontWeight:'bold', fontSize:'13px'}));
    popupPanel.add(ui.Label('Lon ' + lon.toFixed(5) + ' | Lat ' + lat.toFixed(5) + ' | Scale ' + Math.round(OUT_SCALE) + ' m', {fontSize:'11px', color:'#666'}));
    popupPanel.add(ui.Label('Index: ' + f(score,2) + ' / 10  -  ' + cls.label, {fontWeight:'bold', fontSize:'12px', margin:'6px 0 2px 0'}));
    popupPanel.add(ui.Label(cls.msg, {fontSize:'11px', color:'#444', whiteSpace:'pre-wrap'}));
    popupPanel.add(ui.Label('Pillars (0-1)', {fontWeight:'bold', fontSize:'12px', margin:'8px 0 2px 0'}));
    popupPanel.add(pillarBar('Storage', stor, COL_STORAGE));
    popupPanel.add(pillarBar('Supply',  supp, COL_SUPPLY));
    popupPanel.add(pillarBar('Yield',   yld,  COL_YIELD));
    popupPanel.add(ui.Label('Diagnostics', {fontWeight:'bold', fontSize:'12px', margin:'8px 0 2px 0'}));
    popupPanel.add(ui.Label('DTB: ' + f(val.DTB,1) + ' m  |  HAND: ' + f(val.hnd,1) + ' m  |  Slope: ' + f(val.slope,1) + ' deg', {fontSize:'11px'}));
    popupPanel.add(ui.Label('AI_norm: ' + f(val.AI_norm,3) + '  |  UPA_factor: ' + f(val.UPA_factor,3) + '  |  Penalty: ' + f(val.Penalty,3), {fontSize:'11px'}));
    popupPanel.add(ui.Label('NDVI10m: ' + f(val.NDVI_10m,3) + '  |  SoilTrans: ' + f(val.SoilTrans,3) + '  |  LithFactor: ' + f(val.LithFactor,3), {fontSize:'11px'}));
    map.add(popupPanel);
    ui.util.setTimeout(function(){ if(popupPanel){ try{ map.remove(popupPanel); }catch(e){} popupPanel=null; } }, 12000);
  });
});

// =====================================================
// EXPORT (National Malawi) -> GEE ASSET
// =====================================================
var MALAWI = ee.FeatureCollection('FAO/GAUL/2015/level0')
  .filter(ee.Filter.eq('ADM0_NAME', 'Malawi'))
  .geometry();

function maskS2QA60(img) {
  var qa = img.select('QA60');
  var cloudBitMask  = 1 << 10;
  var cirrusBitMask = 1 << 11;
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0).and(qa.bitwiseAnd(cirrusBitMask).eq(0));
  return img.updateMask(mask);
}

function buildGWPI_Malawi(outScale, ndviMonth, wStorage, wSupply, wYield) {
  wStorage = (wStorage === undefined) ? 0.40 : wStorage;
  wSupply  = (wSupply  === undefined) ? 0.30 : wSupply;
  wYield   = (wYield   === undefined) ? 0.30 : wYield;
  var dtb_v   = dtb.clip(MALAWI).reproject({crs:'EPSG:4326', scale: outScale});
  var hnd_v   = hnd.clip(MALAWI).reproject({crs:'EPSG:4326', scale: outScale});
  var elv_v   = elv.clip(MALAWI).reproject({crs:'EPSG:4326', scale: outScale});
  var slope_v = slope.clip(MALAWI).reproject({crs:'EPSG:4326', scale: outScale});
  var dtb_minus_hand = dtb_v.subtract(hnd_v);
  var storage_raw_m = dtb_minus_hand.max(0).min(200);
  var storage = storage_raw_m.add(1).log().divide(ee.Number(201).log()).clamp(0,1);
  var ai_norm = ai.clip(MALAWI).reproject({crs:'EPSG:4326', scale: outScale}).clamp(0.05, 1.5).unitScale(0.05, 1.5);
  var upa_factor = upa.clip(MALAWI).max(1e-6).log10().reproject({crs:'EPSG:4326', scale: outScale}).unitScale(-2, 4).clamp(0, 1);
  var supply = ai_norm.multiply(upa_factor).clamp(0,1);
  var fracturesRaw = ee.Algorithms.CannyEdgeDetector(elv.clip(MALAWI), 10, 1).convolve(ee.Kernel.gaussian(150, 100, 'meters')).clip(MALAWI);
  var fracturesN = ensureDefaultProj(fracturesRaw, outScale).reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024}).unitScale(0, 0.30).clamp(0,1).reproject({crs:'EPSG:4326', scale: outScale});
  var tpiRaw = elv.clip(MALAWI).subtract(elv.clip(MALAWI).focal_mean(250, 'circle', 'meters')).unitScale(-5,5).clip(MALAWI);
  var tpiN = ensureDefaultProj(tpiRaw, outScale).reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024}).clamp(0,1).reproject({crs:'EPSG:4326', scale: outScale});
  var s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(MALAWI).filterDate('2024-01-01', '2025-12-31').filter(ee.Filter.calendarRange(ndviMonth, ndviMonth, 'month')).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60)).map(maskS2QA60).median().clip(MALAWI);
  var ndvi10 = s2.normalizedDifference(['B8','B4']).rename('NDVI10');
  var ndviN = ensureDefaultProj(ndvi10, 10).reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 2048}).reproject({crs:'EPSG:4326', scale: outScale}).unitScale(0.05, 0.60).clamp(0,1);
  var clay60 = soilTop60WeightedMean(sg_clay).divide(10);
  var sand60 = soilTop60WeightedMean(sg_sand).divide(10);
  var cfvo60 = soilTop60WeightedMean(sg_cfvo).divide(10);
  var bdod60 = soilTop60WeightedMean(sg_bdod).divide(100);
  var sandN = sand60.clamp(0,100).unitScale(20,80).clamp(0,1);
  var clayN = clay60.clamp(0,100).unitScale(10,60).clamp(0,1);
  var cfvoN = cfvo60.clamp(0,70).unitScale(0,50).clamp(0,1);
  var bdodN = bdod60.clamp(0.9,1.8).unitScale(0.9,1.8).clamp(0,1);
  var soil_perm = sandN.multiply(0.45).add(cfvoN.multiply(0.20)).add(ee.Image(1).subtract(clayN).multiply(0.25)).add(ee.Image(1).subtract(bdodN).multiply(0.10)).clamp(0,1);
  var soil_trans = soil_perm;
  if (USE_SOILGRIDS_KSAT) {
    var ksat60 = soilTop60WeightedMean(sg_ksat);
    var ksat_norm = ksat60.max(1e-6).log10().unitScale(-2, 2).clamp(0,1);
    soil_trans = ksat_norm.unmask(soil_perm).clamp(0,1);
  }
  soil_trans = soil_trans.reproject({crs:'EPSG:4326', scale: outScale});
  var lith_factor = ee.Image(0.5);
  if (USE_GFV_LITHO) {
    var lithQ = gfv_quat.clip(MALAWI).max(0).add(1).log();
    var lithP = gfv_precamb.clip(MALAWI).max(0).add(1).log();
    lith_factor = lithQ.subtract(lithP).unitScale(-1,1).clamp(0,1);
  }
  lith_factor = lith_factor.reproject({crs:'EPSG:4326', scale: outScale});
  var yield_p = fracturesN.multiply(0.28).add(tpiN.multiply(0.16)).add(ndviN.multiply(0.16)).add(soil_trans.multiply(0.28)).add(lith_factor.multiply(0.12)).clamp(0,1).reproject({crs:'EPSG:4326', scale: outScale});
  var penaltyRaw = slope_v.multiply(-0.15).exp().multiply(hnd_v.multiply(-0.1).exp());
  var penalty = ensureDefaultProj(penaltyRaw, outScale).reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024}).reproject({crs:'EPSG:4326', scale: outScale}).clamp(0,1);
  var score = storage.multiply(wStorage).add(supply.multiply(wSupply)).add(yield_p.multiply(wYield)).multiply(penalty).multiply(10).rename('GWPI').toFloat().clip(MALAWI).reproject({crs:'EPSG:4326', scale: outScale});
  return score;
}

var GWPI_MWI_90m = buildGWPI_Malawi(90, 9, 0.40, 0.30, 0.30);

Export.image.toAsset({
  image: GWPI_MWI_90m,
  description: 'MWI_GWPI_90m_asset_export',
  assetId: 'users/washways/MWI_GWPI_90m',
  region: MALAWI,
  scale: 90,
  crs: 'EPSG:4326',
  maxPixels: 1e13,
  pyramidingPolicy: {'.default': 'mean'}
});

Map.centerObject(MALAWI, 7);
Map.addLayer(GWPI_MWI_90m, {min:1, max:7, palette:PALETTE_INDEX}, 'GWPI Malawi 90m (asset build)', false);
