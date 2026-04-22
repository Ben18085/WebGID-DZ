const translations = {
  en: { title: "English" },
  Ar: { title: "عربي" }
};

function changeLanguage(lang) {
  document.getElementById('title').textContent = translations[lang].title;
  // Optional: Save preference to [LocalStorage](https://medium.com/@idrakmirzoyev/building-a-language-switcher-module-a-comprehensive-guide-662d17b5170b)
  localStorage.setItem('preferredLang', lang);
}

//add FileInput button
document.getElementById('FileInput').addEventListener('change', function(e) {
    var file = e.target.files[0];
if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        var geojson = JSON.parse(e.target.result);
        var layer = L.geoJSON(geojson,{
    onEachFeature: function (feature, layer) {
        if (feature.properties) {
            layer.bindPopup(Object.keys(feature.properties).map(k => `${k}: ${feature.properties[k]}`).join('<br />'));
        }
    }}).addTo(map);
   map.fitBounds(geojson.getBounds());
            };
            reader.readAsText(file);
        });

//dropdown list cities
// 1. Keep your data clean
const cities = { 
    "Jijel": { lat: 36.7047, lng: 5.9175, zoom: 10 },
    "Tamanrasset": { lat: 23.4852, lng: 5.1963,zoom:10 }, 
    "Souk Ahras": { lat: 36.1497, lng: 7.8832, zoom: 10 }, 
    "El Bayadh": { lat: 33.2413, lng: 1.3159,zoom:8 }, 
    "Guelma": { lat: 36.3959, lng: 7.3945,zoom:10 }, 
    "Sidi Bel Abbès": { lat: 34.7071, lng: -0.5039,zoom:10 },
    "Mila":  { lat: 36.2934, lng: 6.1450,zoom:10 },
    "Béchar": {  lat: 31.3676, lng: -1.9181,zoom:10 },
    "Aïn Defla":  {  lat: 36.1843, lng: 2.0652,zoom:10 },
    "Bouira":  {  lat: 36.2526, lng: 3.8429,zoom:10 },
    "Biskra": { lat: 34.694203, lng: 5.943604,zoom:10 },
    "Aïn Témouchent":{ lat: 35.3361, lng: -1.2676,zoom:10 },
    "Tébessa":{ lat: 35.5102, lng: 8.0231,zoom:9 },
    "El Menia":{ lat: 30.7190, lng: 3.0037,zoom:10 },
    "Tipaza":{ lat: 36.5873, lng: 2.1776, zoom: 10 },
    "In Salah":{ lat: 27.3356, lng: 3.4223,zoom:10 },
    "Chlef":{ lat: 36.2187, lng: 1.2360, zoom: 10 },
    "Tissemsilt":{lat: 35.7576, lng: 1.8106,zoom:10 },
    "Saïda" :{lat: 34.7376, lng: 0.2802,zoom:10 },
    "Tizi Ouzou":{ lat: 36.6749, lng: 4.2030,zoom:10 },
    "Tiaret":{ lat: 34.969250, lng:1.389771,zoom:10 },
    "Touggourt":{ lat: 32.9331, lng: 6.3411,zoom:10 },
    "Annaba":{ lat: 36.9486, lng: 7.7344,zoom:10 },
    "Béni Abbès":{lat: 29.4753, lng: -2.7191,zoom:10 },
    "Oran": { lat: 35.7357, lng: -0.9290,zoom:10 },
    "Blida":{ lat: 36.4915, lng: 2.9173,zoom:10 },
    "Boumerdès" :{lat: 36.7283, lng: 3.6368,zoom:10 },
    "Mascara": { lat: 35.3918, lng: 0.1580,zoom:10 },
    "El MGhair" :{ lat: 33.9158, lng: 5.6598,zoom:10 },
    "Naâma" : { lat: 33.3049, lng: -0.7686,zoom:10 },
    "Laghouat" : { lat: 33.463525, lng: 2.861938,zoom:10 },
    "Ouargla" : {lat: 31.0023, lng: 6.0991,zoom:10 },
    "Ghardaia" : {lat: 32.5352, lng: 3.6835,zoom:10 },
    "El Oued" : { lat: 33.1336, lng: 7.3017,zoom:10 },
    "MSila" :{  lat: 35.706377, lng: 4.331360, zoom: 10 },
    "Khenchela" :{ lat: 34.9829, lng: 6.9955,zoom:10 },
    "Illizi" : { lat: 27.8641, lng: 7.9019,zoom:10 },
    "Batna":{ lat:35.503164, lng: 6.124878, zoom: 10 },
    "Constantine" :{ lat: 36.3486, lng: 6.6871,zoom:10 },
    "Bordj Bou Arreridj":{lat: 36.0812, lng: 4.7142,zoom:10 },
    "Bordj Badji Mokhtar":{lat: 23.2509, lng: -0.6186,zoom:10 },
    "Relizane":{ lat: 35.8010, lng: 0.8002,zoom:10 },
    "Béjaïa":{ lat: 36.8179, lng: 4.9912, zoom: 10 },
    "Sétif":{ lat: 36.1374, lng: 5.4375,zoom:10 },
    "Tindouf":{lat: 27.6934, lng: -6.0614,zoom:10 },
    "Médéa":{  lat: 36.182225, lng: 3.065186,zoom:10 },
    "In Guezzam":{lat: 20.4382, lng: 4.5079,zoom:10 },
    "Mostaganem":{lat: 36.0685, lng: 0.3168,zoom:10 },
    "Oum El Bouaghi":{ lat: 35.8365, lng: 7.0639,zoom:10 },
    "Skikda":{lat: 36.8954, lng: 6.8297,zoom:10 },
    "Alger":{ lat: 36.7374, lng: 3.0632,zoom:10 },
    "Adrar":{lat: 26.4939, lng: -1.0650,zoom:10 },
    "Timimoun":{lat: 29.7228, lng: 0.8655,zoom:10 },
    "Ouled Djellal":{lat: 34.2142, lng: 4.8134,zoom:10 },
    "El Tarf" :{lat: 36.7132, lng: 8.1445,zoom:10 },
    "Djanet" :{ lat: 24.1672, lng: 9.3272,zoom:10 },
    "Tlemcen":{ lat: 34.7271, lng: -1.4053,zoom:10 },
    "Djelfa" :{ lat: 34.734841, lng: 3.037720,zoom:10 },
    "Aflou":{ lat: 34.143635, lng: 1.977539,zoom:10 },
    "Barika":{ lat: 35.308401, lng: 5.226746,zoom:10 },
    "El Kantara":{ lat: 35.059229, lng: 5.718384,zoom:10 },
    "Bir El Ater":{lat: 34.6430, lng:7.9452,zoom:9 },
    "El Aricha":{ lat: 34.402377, lng: -1.343079,zoom:10 },
    "Ksar Chellala":{ lat: 35.206355, lng: 2.259064,zoom:10 },
    "Aïn Ouessara":{ lat: 35.389050, lng: 3.120117,zoom:10 },
    "Messâad":{ lat:33.840764, lng: 4.015503,zoom:10 },
    "Ksar El Boukhari":{ lat: 35.773258, lng: 3.029480,zoom:10 },
    "Boussâada":{ lat: 35.038992, lng: 4.240723,zoom:10 },
    "Labiodh Sidi cheikh":{lat: 32.0630, lng: 0.6089,zoom:8 }
};
const citySelect = document.getElementById('citySelect'); 

const flyButton = document.getElementById('btnRun'); 

// Variable to store the current marker
let activeMarker = null;

flyButton.addEventListener('click', () => { 
    const cityName = citySelect.value; 
    const cityData = cities[cityName];

    if (!cityData) return alert("Please select a city!"); 

    const { lat, lng, zoom } = cityData;

    // 1. Start the fly animation
    map.flyTo([lat, lng], zoom, { duration: 2 });

    // 2. Listen for the end of the animation ONCE
    map.once('moveend', () => {
        // Remove the old marker if it exists
        if (activeMarker) {
            map.removeLayer(activeMarker);
        };

        // Add a new marker at the destination
        activeMarker = L.marker([lat, lng])
            .addTo(map)
            .bindPopup(`<b>Welcome to ${cityName.replace(/_/g, ' ')}!</b>`)
            .openPopup(); // Automatically opens the label
    })
});

//Add Watermark
L.Control.Watermark = L.Control.extend({
        onAdd: function(map) {
            var img = L.DomUtil.create('img');          
            img.src = './data/logo_webmap.jpg';
            img.style.width = '50px';          
            return img;
        },      
        onRemove: function(map) {
        // Nothing to do here
        }
    });
    L.control.watermark = function(opts) {
        return new L.Control.Watermark(opts);
    }
    L.control.watermark({ position: 'bottomleft'})
.addTo(map);
 
//locate Me
// Create custom locate button
const LocateButton = L.Control.extend({
  onAdd: function() {
    const btn = L.DomUtil.create('button', 'locate-btn');
    btn.innerHTML = '🔘';
    btn.title = 'Find my location';
    btn.onclick = locateUser;
    return btn;
  }
});

new LocateButton({position:'bottomright',
  width: '44px',
  height: '44px'}
  ).addTo(map);

function locateUser() {
  if (!navigator.geolocation) {
    alert('Geolocation not supported');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      map.setView([coords.latitude, coords.longitude], 21);
      L.marker([coords.latitude, coords.longitude])
        .addTo(map)
        .bindPopup('You are here!')
        .openPopup();
    },
    (err) => alert('Location error: ' + err.message),
    { enableHighAccuracy: true }  // Uses GPS on mobile
  );
}

