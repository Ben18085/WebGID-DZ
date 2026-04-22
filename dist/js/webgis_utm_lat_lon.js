/**
 * Coordinate Converter — Algeria Edition
 * Converts between Decimal Degrees, DMS, UTM WGS84,
 * UTM Nord Sahara 1959 (Clarke 1880) and Lambert Voirol Ancien (Zones I & II)
 *
 * NS59 ↔ WGS84 Helmert shift: IGN values  ΔX=−209 m  ΔY=+87 m  ΔZ=−210 m
 * Lambert Voirol Ancien central meridian: 2°42′E (Greenwich) = 0° Paris
 */

// ---------------------------------------------------------------------------
//  CONSTANTS
// ---------------------------------------------------------------------------
const PI      = Math.PI;
const deg2rad = PI / 180;
const rad2deg = 180.0 / PI;

let map;
let marker;
let updatingFromMap = false;

// ---------------------------------------------------------------------------
//  ELLIPSOID DEFINITIONS
// ---------------------------------------------------------------------------
const datums = {
    "WGS84":   { a: 6378137.000, f: 1 / 298.257223563 },
    "GRS80":   { a: 6378137.000, f: 1 / 298.257222101 },
    "WGS72":   { a: 6378135.000, f: 1 / 298.26         },
    "aust_SA": { a: 6378160.000, f: 1 / 298.25         },
    "krass":   { a: 6378245.000, f: 1 / 298.3          },
    "clrk66":  { a: 6378206.400, f: 1 / 294.9786982138 },
    "intl":    { a: 6378388.000, f: 1 / 297.0          },
    "clrk80":  { a: 6378249.145, f: 1 / 293.465        },  // Clarke 1880 (RGS) — NS59 & Lambert
    "bessel":  { a: 6377397.155, f: 1 / 299.1528128    },
    "airy":    { a: 6377563.396, f: 1 / 299.3249646    },
    "evrst30": { a: 6377276.345, f: 1 / 300.8017       }
};

// Convenience references
const ELLIPSOID_WGS84  = datums["WGS84"];
const ELLIPSOID_CLRK80 = datums["clrk80"];

// ---------------------------------------------------------------------------
//  HELMERT 3-PARAMETER SHIFTS  (translation only, ±5 m accuracy — IGN)
//  WGS84 XYZ  →  Nord Sahara 1959 (Clarke 1880) XYZ
// ---------------------------------------------------------------------------
const WGS84_TO_NS59 = { dx: -209, dy:  87, dz: -210 };
const NS59_TO_WGS84 = { dx:  209, dy: -87, dz:  210 };

// ---------------------------------------------------------------------------
//  LAMBERT VOIROL ANCIEN ZONE PARAMETERS  (Clarke 1880 ellipsoid)
//  Central meridian: 2.596898° E (Greenwich) = 2°42′E = 0° Paris
// ---------------------------------------------------------------------------
const LAMBERT_ZONES = {
    1: {   // Nord Algérie
        lat0:  36.0    * deg2rad,
        lon0:  2.596898 * deg2rad,
        k0:    0.999625544,
        FE:    500000,
        FN:    300000
    },
    2: {   // Sud Algérie
        lat0:  33.3    * deg2rad,   // 33°18′N
        lon0:  2.596898 * deg2rad,
        k0:    0.999625769,
        FE:    500000,
        FN:    200000
    }
};

// ===========================================================================
//  HELMERT DATUM SHIFT UTILITIES
// ===========================================================================

/** Geographic (deg) + ellipsoid  →  geocentric ECEF XYZ */
function geog2ecef(latDeg, lonDeg, ell) {
    const lat = latDeg * deg2rad;
    const lon = lonDeg * deg2rad;
    const e2  = 2 * ell.f - ell.f * ell.f;
    const N   = ell.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    return {
        x: N * Math.cos(lat) * Math.cos(lon),
        y: N * Math.cos(lat) * Math.sin(lon),
        z: N * (1 - e2) * Math.sin(lat)
    };
}

/** Geocentric ECEF XYZ + ellipsoid  →  geographic (deg) */
function ecef2geog(xyz, ell) {
    const { x, y, z } = xyz;
    const e2  = 2 * ell.f - ell.f * ell.f;
    const lon = Math.atan2(y, x);
    const p   = Math.sqrt(x * x + y * y);
    let lat   = Math.atan2(z, p * (1 - e2));   // initial estimate
    for (let i = 0; i < 10; i++) {
        const N   = ell.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
        lat       = Math.atan2(z + e2 * N * Math.sin(lat), p);
    }
    return { latDeg: lat * rad2deg, lonDeg: lon * rad2deg };
}

/** Apply a 3-parameter Helmert translation to ECEF coordinates */
function helmert3(xyz, shift) {
    return { x: xyz.x + shift.dx, y: xyz.y + shift.dy, z: xyz.z + shift.dz };
}

/** WGS84 geographic (deg)  →  Nord Sahara 1959 geographic (deg) */
function wgs84ToNS59(latDeg, lonDeg) {
    const ecef_wgs = geog2ecef(latDeg, lonDeg, ELLIPSOID_WGS84);
    const ecef_ns  = helmert3(ecef_wgs, WGS84_TO_NS59);
    return ecef2geog(ecef_ns, ELLIPSOID_CLRK80);
}

/** Nord Sahara 1959 geographic (deg)  →  WGS84 geographic (deg) */
function ns59ToWgs84(latDeg, lonDeg) {
    const ecef_ns  = geog2ecef(latDeg, lonDeg, ELLIPSOID_CLRK80);
    const ecef_wgs = helmert3(ecef_ns, NS59_TO_WGS84);
    return ecef2geog(ecef_wgs, ELLIPSOID_WGS84);
}

// ===========================================================================
//  UTM FORWARD  (works for any ellipsoid)
// ===========================================================================
function latLonToUTM_ell(latDeg, lonDeg, ell) {
    if (isNaN(latDeg) || isNaN(lonDeg) ||
        latDeg < -90 || latDeg > 90 || lonDeg < -180 || lonDeg > 180) return null;

    const a          = ell.a;
    const eccSq      = 2 * ell.f - ell.f * ell.f;
    const eccPrimeSq = eccSq / (1 - eccSq);
    const k0         = 0.9996;

    const latRad = latDeg * deg2rad;
    const lonRad = lonDeg * deg2rad;
    const zone   = Math.floor((lonDeg + 180) / 6) + 1;
    const lonOriginRad = ((zone - 1) * 6 - 180 + 3) * deg2rad;

    const N = a / Math.sqrt(1 - eccSq * Math.sin(latRad) ** 2);
    const T = Math.tan(latRad) ** 2;
    const C = eccPrimeSq * Math.cos(latRad) ** 2;
    const A = Math.cos(latRad) * (lonRad - lonOriginRad);

    const M = a * (
        (1 - eccSq / 4 - 3 * eccSq ** 2 / 64 - 5 * eccSq ** 3 / 256) * latRad
        - (3 * eccSq / 8 + 3 * eccSq ** 2 / 32 + 45 * eccSq ** 3 / 1024) * Math.sin(2 * latRad)
        + (15 * eccSq ** 2 / 256 + 45 * eccSq ** 3 / 1024) * Math.sin(4 * latRad)
        - (35 * eccSq ** 3 / 3072) * Math.sin(6 * latRad)
    );

    const easting = k0 * N * (
        A + (1 - T + C) * A ** 3 / 6
        + (5 - 18 * T + T ** 2 + 72 * C - 58 * eccPrimeSq) * A ** 5 / 120
    ) + 500000;

    const northing = k0 * (
        M + N * Math.tan(latRad) * (
            A ** 2 / 2
            + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
            + (61 - 58 * T + T ** 2 + 600 * C - 330 * eccPrimeSq) * A ** 6 / 720
        )
    ) + (latDeg < 0 ? 10000000 : 0);

    return { zone, hemisphere: latDeg >= 0 ? "N" : "S", easting, northing };
}

// ===========================================================================
//  UTM INVERSE  (works for any ellipsoid)
// ===========================================================================
function utmToLatLon_ell(zone, hemisphere, easting, northing, ell) {
    if (isNaN(zone) || zone < 1 || zone > 60 || isNaN(easting) || isNaN(northing)) return null;

    const a      = ell.a;
    const eccSq  = 2 * ell.f - ell.f * ell.f;
    const k0     = 0.9996;
    const e1     = (1 - Math.sqrt(1 - eccSq)) / (1 + Math.sqrt(1 - eccSq));
    const x      = easting - 500000;
    const y      = hemisphere === "N" ? northing : northing - 10000000;
    const lonOrigin = (zone - 1) * 6 - 180 + 3;
    const eccPrimeSq = eccSq / (1 - eccSq);

    const M   = y / k0;
    const mu  = M / (a * (1 - eccSq / 4 - 3 * eccSq ** 2 / 64 - 5 * eccSq ** 3 / 256));

    const phi1 = mu
        + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
        + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
        + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
        + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);

    const N1  = a / Math.sqrt(1 - eccSq * Math.sin(phi1) ** 2);
    const T1  = Math.tan(phi1) ** 2;
    const C1  = eccPrimeSq * Math.cos(phi1) ** 2;
    const R1  = a * (1 - eccSq) / (1 - eccSq * Math.sin(phi1) ** 2) ** 1.5;
    const D   = x / (N1 * k0);

    const latRad = phi1 - (N1 * Math.tan(phi1) / R1) * (
        D ** 2 / 2
        - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * eccPrimeSq) * D ** 4 / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * eccPrimeSq - 3 * C1 ** 2) * D ** 6 / 720
    );

    const lonRad = (
        D - (1 + 2 * T1 + C1) * D ** 3 / 6
        + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * eccPrimeSq + 24 * T1 ** 2) * D ** 5 / 120
    ) / Math.cos(phi1);

    return { latitude: latRad * rad2deg, longitude: lonOrigin + lonRad * rad2deg };
}

// ===========================================================================
//  WGS84 UTM  (uses selected datum from UI for the WGS84 side)
// ===========================================================================
function latLonToUTM(latDeg, lonDeg) {
    return latLonToUTM_ell(latDeg, lonDeg, getSelectedDatum());
}

function UTMToLatLon(zone, hemisphere, easting, northing) {
    return utmToLatLon_ell(zone, hemisphere, easting, northing, getSelectedDatum());
}

// ===========================================================================
//  NORD SAHARA 1959  UTM  (always uses Clarke 1880)
// ===========================================================================

/**
 * WGS84 lat/lon  →  NS59 UTM
 * Returns { zone, hemisphere, easting, northing }
 */
function wgs84ToNS59UTM(latDeg, lonDeg) {
    const ns59 = wgs84ToNS59(latDeg, lonDeg);
    return latLonToUTM_ell(ns59.latDeg, ns59.lonDeg, ELLIPSOID_CLRK80);
}

/**
 * NS59 UTM  →  WGS84 lat/lon
 * Returns { latitude, longitude }
 */
function ns59UTMToWgs84(zone, hemisphere, easting, northing) {
    const ns59geog = utmToLatLon_ell(zone, hemisphere, easting, northing, ELLIPSOID_CLRK80);
    if (!ns59geog) return null;
    const wgs = ns59ToWgs84(ns59geog.latitude, ns59geog.longitude);
    return { latitude: wgs.latDeg, longitude: wgs.lonDeg };
}

// ===========================================================================
//  LAMBERT VOIROL ANCIEN  (Clarke 1880 — tangent conical conformal)
// ===========================================================================

/**
 * WGS84 lat/lon (deg)  →  Lambert Voirol Ancien X/Y (m)
 * zoneNum: 1 = Nord Algérie, 2 = Sud Algérie
 */
function wgs84ToLambert(latDeg, lonDeg, zoneNum) {
    const p = LAMBERT_ZONES[zoneNum];
    if (!p) throw new Error("Invalid Lambert zone (use 1 or 2).");

    // Convert WGS84 → Clarke 1880 geographic
    const clrk = wgs84ToNS59(latDeg, lonDeg);
    const lat  = clrk.latDeg * deg2rad;
    const lon  = clrk.lonDeg * deg2rad;

    const ell = ELLIPSOID_CLRK80;
    const a   = ell.a;
    const e2  = 2 * ell.f - ell.f * ell.f;
    const e   = Math.sqrt(e2);

    // Cone constant (tangent cone: standard parallel = lat0)
    const sinLat0 = Math.sin(p.lat0);
    const m0 = Math.cos(p.lat0) / Math.sqrt(1 - e2 * sinLat0 ** 2);
    const t0 = _tFunc(p.lat0, e);
    const n  = sinLat0;
    const F  = m0 / (n * t0 ** n);
    const rho0 = a * F * t0 ** n * p.k0;

    const t   = _tFunc(lat, e);
    const rho = a * F * t ** n * p.k0;
    const theta = n * (lon - p.lon0);

    return {
        X: p.FE + rho * Math.sin(theta),
        Y: p.FN + rho0 - rho * Math.cos(theta)
    };
}

/**
 * Lambert Voirol Ancien X/Y (m)  →  WGS84 lat/lon (deg)
 */
function lambertToWgs84(X, Y, zoneNum) {
    const p = LAMBERT_ZONES[zoneNum];
    if (!p) throw new Error("Invalid Lambert zone (use 1 or 2).");

    const ell = ELLIPSOID_CLRK80;
    const a   = ell.a;
    const e2  = 2 * ell.f - ell.f * ell.f;
    const e   = Math.sqrt(e2);

    const sinLat0 = Math.sin(p.lat0);
    const m0 = Math.cos(p.lat0) / Math.sqrt(1 - e2 * sinLat0 ** 2);
    const t0 = _tFunc(p.lat0, e);
    const n  = sinLat0;
    const F  = m0 / (n * t0 ** n);
    const rho0 = a * F * t0 ** n * p.k0;

    const dx    = X - p.FE;
    const dy    = rho0 - (Y - p.FN);
    const rho   = Math.sqrt(dx * dx + dy * dy) * Math.sign(n);
    const theta = Math.atan2(dx, dy);

    const lon_rad = theta / n + p.lon0;
    const t       = (rho / (a * F * p.k0)) ** (1 / n);

    // Iterative latitude solution
    let lat_rad = PI / 2 - 2 * Math.atan(t);
    for (let i = 0; i < 20; i++) {
        const eSinLat = e * Math.sin(lat_rad);
        lat_rad = PI / 2 - 2 * Math.atan(t * ((1 - eSinLat) / (1 + eSinLat)) ** (e / 2));
    }

    // Result is Clarke 1880 → convert back to WGS84
    const wgs = ns59ToWgs84(lat_rad * rad2deg, lon_rad * rad2deg);
    return { latitude: wgs.latDeg, longitude: wgs.lonDeg };
}

/** Helper: reduced latitude function for Lambert */
function _tFunc(latRad, e) {
    const eSin = e * Math.sin(latRad);
    return Math.tan(PI / 4 - latRad / 2) / ((1 - eSin) / (1 + eSin)) ** (e / 2);
}

// ===========================================================================
//  DMS ↔ DECIMAL HELPERS
// ===========================================================================
function decimalToDMS(decimalDegrees) {
    const deg = Math.floor(Math.abs(decimalDegrees));
    const min = Math.floor((Math.abs(decimalDegrees) - deg) * 60);
    const sec = ((Math.abs(decimalDegrees) - deg) * 60 - min) * 60;
    return { degrees: deg, minutes: min, seconds: sec };
}

function DMSToDecimal(degrees, minutes, seconds, direction) {
    let decimal = Math.abs(degrees) + Math.abs(minutes) / 60 + Math.abs(seconds) / 3600;
    if (direction === "S" || direction === "W" || direction === "-") decimal = -decimal;
    return decimal;
}

// ===========================================================================
//  MAP INIT
// ===========================================================================
document.addEventListener('DOMContentLoaded', function () {
    if (typeof L !== 'undefined') {
        initMap();
    } else {
        const iv = setInterval(function () {
            if (typeof L !== 'undefined') { clearInterval(iv); initMap(); }
        }, 100);
        setTimeout(() => clearInterval(iv), 5000);
    }

    const datumEl = document.getElementById('mapDatum');
    if (datumEl) datumEl.addEventListener('change', () => {
        const lat = parseFloat(document.getElementById("decimalLatitude")?.value);
        const lon = parseFloat(document.getElementById("decimalLongitude")?.value);
        if (!isNaN(lat) && !isNaN(lon)) convertDecimal();
    });

    const precEl = document.getElementById('coordPrecision');
    if (precEl) precEl.addEventListener('input', () => {
        if (document.getElementById("decimalLatitude")?.value) convertDecimal();
    });

    const lzEl = document.getElementById('lambertZone');
    if (lzEl) lzEl.addEventListener('change', () => {
        if (document.getElementById("decimalLatitude")?.value) convertDecimal();
    });
});

function initMap() {
    if (map) return;
    if (!document.getElementById('map')) return;

    // Default view: Algeria centre
    const initialLat = 28.0;
    const initialLon =  3.0;

    try {
        map = L.map('map').setView([initialLat, initialLon], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        marker = L.marker([initialLat, initialLon], {
            draggable: true,
            title: "Drag to update coordinates"
        }).addTo(map);

        marker.on('dragend', e => {
            const p = marker.getLatLng();
            updateCoordinatesFromMarker(p.lat, p.lng);
        });

        map.on('click', e => {
            marker.setLatLng(e.latlng);
            updateCoordinatesFromMarker(e.latlng.lat, e.latlng.lng);
        });

        setTimeout(() => map.invalidateSize(), 100);
    } catch (e) {
        console.error("Map init error:", e);
    }
}

function updateCoordinatesFromMarker(lat, lng) {
    updatingFromMap = true;
    const p = getPrecision();
    document.getElementById("decimalLatitude").value  = lat.toFixed(Math.max(p, 7));
    document.getElementById("decimalLongitude").value = lng.toFixed(Math.max(p, 7));
    convertDecimal();
    updatingFromMap = false;
}

function updateMap() {
    if (updatingFromMap) return;
    const lat = parseFloat(document.getElementById("decimalLatitude").value);
    const lon = parseFloat(document.getElementById("decimalLongitude").value);
    if (!isNaN(lat) && !isNaN(lon) && typeof L !== 'undefined') {
        if (!map || !marker) initMap();
        if (map && marker) {
            marker.setLatLng([lat, lon]);
            map.setView([lat, lon], map.getZoom());
        }
    }
}

function viewOnGoogleMaps() {
    const lat = document.getElementById("decimalLatitude").value;
    const lon = document.getElementById("decimalLongitude").value;
    if (lat && lon) {
        window.open(`https://www.google.com/maps?q=${lat},${lon}`, '_blank');
    } else {
        alert("Please enter latitude and longitude values.");
    }
}

// ===========================================================================
//  HELPERS
// ===========================================================================
function getSelectedDatum() {
    const sel = document.getElementById("mapDatum");
    const key = sel ? sel.options[sel.selectedIndex].value : "WGS84";
    return datums[key] || datums["WGS84"];
}

function getPrecision() {
    const el = document.getElementById('coordPrecision');
    return el ? (parseInt(el.value) || 2) : 2;
}

function getLambertZone() {
    const el = document.getElementById('lambertZone');
    return el ? (parseInt(el.value) || 1) : 1;
}

/** Populate all NS59 fields from a UTM result object */
function _fillNS59(result, precision) {
    if (!result) return;
    document.getElementById("ns59Zone").value     = result.zone;
    document.getElementById("ns59Hemi").value     = result.hemisphere;
    document.getElementById("ns59Easting").value  = result.easting.toFixed(precision);
    document.getElementById("ns59Northing").value = result.northing.toFixed(precision);
}

/** Populate all Lambert fields from an {X,Y} result */
function _fillLambert(result, precision) {
    if (!result) return;
    document.getElementById("lambertX").value = result.X.toFixed(precision);
    document.getElementById("lambertY").value = result.Y.toFixed(precision);
}

/** Populate WGS84 UTM fields */
function _fillUTM(result, precision) {
    if (!result) return;
    document.getElementById("utmZone").value     = result.zone;
    document.getElementById("utmHemi").value     = result.hemisphere;
    document.getElementById("utmEasting").value  = result.easting.toFixed(precision);
    document.getElementById("utmNorthing").value = result.northing.toFixed(precision);
}

/** Populate decimal degree fields */
function _fillDecimal(lat, lon, precision) {
    document.getElementById("decimalLatitude").value  = lat.toFixed(precision);
    document.getElementById("decimalLongitude").value = lon.toFixed(precision);
}

/** Populate DMS fields */
function _fillDMS(lat, lon, precision) {
    const latDMS = decimalToDMS(lat);
    const lonDMS = decimalToDMS(lon);
    document.getElementById("latDegrees").value  = latDMS.degrees;
    document.getElementById("latMinutes").value  = latDMS.minutes;
    document.getElementById("latSeconds").value  = latDMS.seconds.toFixed(precision);
    document.getElementById("northOrSouth").value = lat >= 0 ? "N" : "S";
    document.getElementById("lonDegrees").value  = lonDMS.degrees;
    document.getElementById("lonMinutes").value  = lonDMS.minutes;
    document.getElementById("lonSeconds").value  = lonDMS.seconds.toFixed(precision);
    document.getElementById("westOrEast").value  = lon >= 0 ? "E" : "W";
}

// ===========================================================================
//  MASTER POPULATE — fill every panel from a WGS84 lat/lon
// ===========================================================================
function populateAll(lat, lon) {
    const p = getPrecision();

    _fillDecimal(lat, lon, p);
    _fillDMS(lat, lon, p);

    // WGS84 UTM
    _fillUTM(latLonToUTM(lat, lon), p);

    // Nord Sahara 1959 UTM
    _fillNS59(wgs84ToNS59UTM(lat, lon), p);

    // Lambert Voirol Ancien
    try {
        _fillLambert(wgs84ToLambert(lat, lon, getLambertZone()), p);
    } catch (e) {
        console.warn("Lambert out of range:", e.message);
        document.getElementById("lambertX").value = "—";
        document.getElementById("lambertY").value = "—";
    }

    updateMap();
}

// ===========================================================================
//  CONVERTER ENTRY POINTS
// ===========================================================================

/** Convert from Decimal Degrees */
function convertDecimal() {
    const lat = parseFloat(document.getElementById("decimalLatitude").value);
    const lon = parseFloat(document.getElementById("decimalLongitude").value);
    if (isNaN(lat) || isNaN(lon)) {
        alert("Please enter valid numeric values for latitude and longitude.");
        return;
    }
    populateAll(lat, lon);
}

/** Convert from DMS */
function convertDMS() {
    const latDeg = parseInt(document.getElementById("latDegrees").value);
    const latMin = parseInt(document.getElementById("latMinutes").value);
    const latSec = parseFloat(document.getElementById("latSeconds").value);
    const latDir = document.getElementById("northOrSouth").value;
    const lonDeg = parseInt(document.getElementById("lonDegrees").value);
    const lonMin = parseInt(document.getElementById("lonMinutes").value);
    const lonSec = parseFloat(document.getElementById("lonSeconds").value);
    const lonDir = document.getElementById("westOrEast").value;

    if ([latDeg, latMin, latSec, lonDeg, lonMin, lonSec].some(isNaN)) {
        alert("Please enter valid numeric values for all DMS fields.");
        return;
    }

    populateAll(
        DMSToDecimal(latDeg, latMin, latSec, latDir),
        DMSToDecimal(lonDeg, lonMin, lonSec, lonDir)
    );
}

/** Convert from WGS84 UTM */
function convertUTM() {
    const zone     = parseInt(document.getElementById("utmZone").value);
    const hemi     = document.getElementById("utmHemi").value;
    const easting  = parseFloat(document.getElementById("utmEasting").value);
    const northing = parseFloat(document.getElementById("utmNorthing").value);

    if (isNaN(zone) || isNaN(easting) || isNaN(northing)) {
        alert("Please enter valid numeric values for all UTM fields.");
        return;
    }

    const ll = UTMToLatLon(zone, hemi, easting, northing);
    if (!ll) { alert("Could not convert UTM to latitude/longitude."); return; }
    populateAll(ll.latitude, ll.longitude);
}

/** Convert from Nord Sahara 1959 UTM */
function convertNS59() {
    const zone     = parseInt(document.getElementById("ns59Zone").value);
    const hemi     = document.getElementById("ns59Hemi").value;
    const easting  = parseFloat(document.getElementById("ns59Easting").value);
    const northing = parseFloat(document.getElementById("ns59Northing").value);

    if (isNaN(zone) || isNaN(easting) || isNaN(northing)) {
        alert("Please enter valid numeric values for all NS59 fields.");
        return;
    }

    const ll = ns59UTMToWgs84(zone, hemi, easting, northing);
    if (!ll) { alert("Could not convert NS59 to latitude/longitude."); return; }
    populateAll(ll.latitude, ll.longitude);
}

/** Convert from Lambert Voirol Ancien */
function convertLambert() {
    const X      = parseFloat(document.getElementById("lambertX").value);
    const Y      = parseFloat(document.getElementById("lambertY").value);
    const zone   = getLambertZone();

    if (isNaN(X) || isNaN(Y)) {
        alert("Please enter valid numeric values for Lambert X and Y.");
        return;
    }

    try {
        const ll = lambertToWgs84(X, Y, zone);
        populateAll(ll.latitude, ll.longitude);
    } catch (e) {
        alert("Lambert conversion error: " + e.message);
    }
}

