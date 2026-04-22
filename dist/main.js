// map class initialize
var map = L.map('map').setView([33,6], 5);
map.zoomControl.setPosition('topright');
// Add map scale
L.control.scale({ position: 'bottomleft'}).addTo(map);

//Map coordinate display
const coordsSpan = document.getElementById('coords');
const coordsBox = document.getElementById('coords-box');
const toggleBtn = document.getElementById('toggle-coords');

// Update coordinates on mouse move
map.on('mousemove', (e) => {
    const lat = e.latlng.lat.toFixed(6);
    const lng = e.latlng.lng.toFixed(6);
    coordsSpan.innerHTML = `<b>LAT:</b> ${lat} &nbsp; <b>LNG:</b> ${lng}`;
});

// Toggle visibility
toggleBtn.addEventListener('click', () => {
    coordsBox.classList.toggle('hidden-coords');
    // Optional: Change button color when hidden
    toggleBtn.style.background = coordsBox.classList.contains('hidden-coords') ? '#ccc' : 'white';
});

// Add geocoder control
L.Control.geocoder().addTo(map);

//Browser print function
L.control.browserPrint({position:'topright'}).addTo(map);
  
//Leaflet measure
L.control.measure({
    primaryLengthUnit: 'meters', 
    secondaryLengthUnit: 'kilometers',
    primaryAreaUnit: 'sqmeters', 
    secondaryAreaUnit: 'hectares'  
}).addTo(map);

//adding OSM tile layer

var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
     attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

var esri_worldtopomap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
attribution: 'Tiles &copy; Esri &mdash; and the GIS User Community'
}).addTo(map);

var Google_Satellite = L.tileLayer('http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
  maxZoom: 20,subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
}).addTo(map);
var googleStreets = L.tileLayer('http://{s}.google.com/vt?lyrs=m&x={x}&y={y}&z={z}',{
    maxZoom: 20,
    subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

//Leaflet layer control
var baseMaps ={
    'OSM': osm,
    'Esri_WorldTopoMap': esri_worldtopomap,
    'googleStreets' :googleStreets,
    'Google_Satellite': Google_Satellite
};
//define an empty overlay control
var overlayMaps = {};

// Initialize the layer control
var layerControl = L.control.layers(baseMaps,overlayMaps,{
    collapsed : true,
    position : "topleft"
}).addTo(map);
// communes 
// Function to load external GeoJSON
fetch('./data/DZcommunes.geojson')
    .then(response => response.json())
    .then(data => {
        // Create the GeoJSON layer
        var communes = L.geoJSON(data, {
              style: function (feature) {
        return {
            color: 'blue',       // Outline color
            weight: 2,           // Outline thickness
            fillColor: 'none',   // Or 'transparent'
            fillOpacity: 0       // Makes it completely invisible inside
        };
     },
            onEachFeature: function (feature, layer) {
                if (feature.properties && feature.properties.name) {
                    layer.bindPopup(feature.properties.name); // Add popups
                }
            }
        });
        // Add the loaded layer to the existing Layer Control
        layerControl.addOverlay(communes, 'communes');
         // Optional: Add to map immediately
        communes.addTo(map); 
    })
    .catch(error => console.error('Error loading GeoJSON:', error));


// wilayas 

// Function to load external GeoJSON
fetch('./data/Allwilayas.geojson')
    .then(response => response.json())
    .then(data => {
        // Create the GeoJSON layer
        var wilayas = L.geoJSON(data, {
    style: function (feature) {
        return {
            color: 'red',       // Outline color
            weight: 2,           // Outline thickness
            fillColor: 'none',   // Or 'transparent'
            fillOpacity: 0       // Makes it completely invisible inside
        };
    },
            onEachFeature: function (feature, layer) {
                if (feature.properties && feature.properties.name) {
                    layer.bindPopup(feature.properties.name); // Add popups
                }
            }
        });
        // Add the loaded layer to the existing Layer Control
        layerControl.addOverlay(wilayas, 'wilayas');
       // Optional: Add to map immediately
        wilayas.addTo(map); 
    })  
.catch(error => console.error('Error loading GeoJSON:', error));


//Zoom to layer
$('.zoom-to-layer').click(function() {
    const cityName = citySelect.value;
    const cityData = cities[cityName];

    if (!cityData) return alert("Please select a city!");

    const { lat, lng, zoom } = cityData;

    map.flyTo([lat, lng], zoom, {
        animate: true,
        duration: 1.5
    });
});

//Get Lat/Lng from click event
// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
let pickMode    = false;   // is pick mode active?
let pickedPoints = [];     // saved points array
let pickMarkers  = [];     // leaflet markers array

// ─────────────────────────────────────────────────────────────────────────────
// BUTTON (injected into page — or paste the HTML version below instead)
// ─────────────────────────────────────────────────────────────────────────────
const pickBtn = document.createElement('button');
pickBtn.id        = 'pickBtn';
pickBtn.innerHTML = '📍 Pick Location';
pickBtn.style.cssText = `
    position: absolute; top: 270px; left: 10px; z-index: 1000;
    padding: 8px 14px; background: #3498db; color: white;
    border: none; border-radius: 6px; font-size: 13px;
    font-weight: 600; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    transition: background 0.2s;
`;
document.getElementById('map').appendChild(pickBtn);

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE PICK MODE
// ─────────────────────────────────────────────────────────────────────────────
pickBtn.addEventListener('click', () => {
    pickMode = !pickMode;

    if (pickMode) {
        pickBtn.innerHTML        = '🛑 Stop Picking';
        pickBtn.style.background = '#e74c3c';
        map.getContainer().style.cursor = 'crosshair';
    } else {
        pickBtn.innerHTML        = '📍 Pick Location';
        pickBtn.style.background = '#3498db';
        map.getContainer().style.cursor = '';
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// MAP CLICK → CAPTURE POINT
// ─────────────────────────────────────────────────────────────────────────────
map.on('click', function(e) {
    if (!pickMode) return;   // only fires when pick mode is ON

    const { lat, lng } = e.latlng;
    const id = pickedPoints.length + 1;

    // 1. Copy to clipboard
    const coordText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    navigator.clipboard.writeText(coordText)
        .then(() => showToast(`📋 Copied: ${coordText}`))
        .catch(() => showToast(`📍 Point #${id} saved`));

    // 2. Add marker to map
    const marker = L.marker([lat, lng], { draggable: true })
        .addTo(map)
        .bindPopup(buildPopup(id, lat, lng))
        .openPopup();

    // Update if dragged
    marker.on('dragend', function() {
        const pos = marker.getLatLng();
        const point = pickedPoints.find(p => p.id === id);
        if (point) { point.lat = pos.lat; point.lng = pos.lng; }
        marker.setPopupContent(buildPopup(id, pos.lat, pos.lng)).openPopup();
    });

    pickMarkers.push(marker);

    // 3. Save to array
    pickedPoints.push({ id, lat, lng });

    console.log('Picked points so far:', pickedPoints);
});

// ─────────────────────────────────────────────────────────────────────────────
// POPUP CONTENT
// ─────────────────────────────────────────────────────────────────────────────
function buildPopup(id, lat, lng) {
    return `
        <div style="font-family:sans-serif; font-size:13px; min-width:170px">
            <b>📍 Point #${id}</b><br><br>
            <b>Lat:</b> ${lat.toFixed(6)}<br>
            <b>Lng:</b> ${lng.toFixed(6)}<br><br>
            <button onclick="copyCoord(${lat}, ${lng})"
                style="width:48%; padding:5px; background:#3498db; color:white;
                       border:none; border-radius:4px; cursor:pointer; font-size:12px">
                📋 Copy
            </button>
            <button onclick="removePickedPoint(${id})"
                style="width:48%; padding:5px; background:#e74c3c; color:white;
                       border:none; border-radius:4px; cursor:pointer; font-size:12px">
                🗑 Remove
            </button>
            <button onclick="savePickedPoints()"
                style="width:100%; padding:5px; margin-top:5px; background:#2ecc71;
                       color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px">
                💾 Save All
            </button>
        </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COPY A SINGLE COORDINATE
// ─────────────────────────────────────────────────────────────────────────────
function copyCoord(lat, lng) {
    const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    navigator.clipboard.writeText(text)
        .then(() => showToast(`📋 Copied: ${text}`));
}

// ─────────────────────────────────────────────────────────────────────────────
// REMOVE ONE POINT
// ─────────────────────────────────────────────────────────────────────────────
function removePickedPoint(id) {
    const idx = pickedPoints.findIndex(p => p.id === id);
    if (idx === -1) return;

    map.removeLayer(pickMarkers[idx]);
    pickMarkers.splice(idx, 1);
    pickedPoints.splice(idx, 1);
    showToast(`🗑 Point #${id} removed`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE ALL POINTS TO FILE (CSV / JSON / GeoJSON)
// ─────────────────────────────────────────────────────────────────────────────
function savePickedPoints(format = 'csv') {
    if (pickedPoints.length === 0)
        return showToast('⚠️ No points to save!');

    let content, filename, mime;

    if (format === 'json') {
        content  = JSON.stringify(pickedPoints.map(
                     ({ id, lat, lng }) => ({ id, lat, lng })), null, 2);
        filename = 'picked_points.json';
        mime     = 'application/json';

    } else if (format === 'geojson') {
        content  = JSON.stringify({
            type: "FeatureCollection",
            features: pickedPoints.map(p => ({
                type: "Feature",
                properties: { id: p.id },
                geometry: { type: "Point", coordinates: [p.lng, p.lat] }
            }))
        }, null, 2);
        filename = 'picked_points.geojson';
        mime     = 'application/geo+json';

    } else {
        // default: CSV
        content  = 'id,latitude,longitude\n' +
                   pickedPoints.map(p =>
                     `${p.id},${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('\n');
        filename = 'picked_points.csv';
        mime     = 'text/csv';
    }

    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    showToast(`💾 Saved as ${filename}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEAR ALL PICKED MARKERS
// ─────────────────────────────────────────────────────────────────────────────
function clearPickedMarkers() {
    pickMarkers.forEach(m => map.removeLayer(m));
    pickMarkers  = [];
    pickedPoints = [];
    showToast('🗑 All picked markers cleared');
}

// ─────────────────────────────────────────────────────────────────────────────
// TOAST NOTIFICATION
// ─────────────────────────────────────────────────────────────────────────────
function showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.style.cssText = `
            position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
            background:#2ecc71; color:#fff; padding:10px 20px;
            border-radius:20px; font-size:13px; font-weight:600;
            opacity:0; pointer-events:none; transition:opacity .3s; z-index:9999;
        `;
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = 1;
    setTimeout(() => toast.style.opacity = 0, 2500);
}
//full screen map view

const mapElement = document.getElementById('map');

function fullScreenView() {
    if (!document.fullscreenElement &&    // Standard
        !document.mozFullScreenElement && !document.webkitFullscreenElement) {  
        // Entrer en plein écran
        if (mapElement.requestFullscreen) {
            mapElement.requestFullscreen();
        } else if (mapElement.mozRequestFullScreen) { // Firefox
            mapElement.mozRequestFullScreen();
        } else if (mapElement.webkitRequestFullscreen) { // Chrome, Safari, Opera
            mapElement.webkitRequestFullscreen();
        }
    } else {
        // Sortir du plein écran
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }}
    }
