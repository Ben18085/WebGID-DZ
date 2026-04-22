/**
 * محول الإحداثيات — طبعة الجزائر
 * تحويل بين الدرجات العشرية، DMS، UTM WGS84،
 * UTM Nord Sahara 1959 (Clarke 1880) و Lambert voirol ancien (المناطق الأولى والثانية)
 *
 * NS59 ↔ WGS84 تحويل Helmert: قيم IGN  ΔX=−209 م  ΔY=+87 م  ΔZ=−210 م
 * خط الزوال المركزي لـ Lambert voirol ancien: 2°42′E (غرينتش) = 0° باريس
 */

// ---------------------------------------------------------------------------
//  الثوابت
// ---------------------------------------------------------------------------
const PI      = Math.PI;
const deg2rad = PI / 180;
const rad2deg = 180.0 / PI;

let map;
let marker;
let updatingFromMap = false;

// ---------------------------------------------------------------------------
//  تعريفات الإهليليج
// ---------------------------------------------------------------------------
const datums = {
    "WGS84":   { a: 6378137.000, f: 1 / 298.257223563 },
    "GRS80":   { a: 6378137.000, f: 1 / 298.257222101 },
    "WGS72":   { a: 6378135.000, f: 1 / 298.26         },
    "aust_SA": { a: 6378160.000, f: 1 / 298.25         },
    "krass":   { a: 6378245.000, f: 1 / 298.3          },
    "clrk66":  { a: 6378206.400, f: 1 / 294.9786982138 },
    "intl":    { a: 6378388.000, f: 1 / 297.0          },
    "clrk80":  { a: 6378249.145, f: 1 / 293.465        },  // Clarke 1880 (RGS) — NS59 و Lambert
    "bessel":  { a: 6377397.155, f: 1 / 299.1528128    },
    "airy":    { a: 6377563.396, f: 1 / 299.3249646    },
    "evrst30": { a: 6377276.345, f: 1 / 300.8017       }
};

// مراجع مريحة
const ELLIPSOID_WGS84  = datums["WGS84"];
const ELLIPSOID_CLRK80 = datums["clrk80"];

// ---------------------------------------------------------------------------
//  تحويلات HELMERT بـ 3 معاملات  (الترجمة فقط، دقة ±5 م — IGN)
//  WGS84 XYZ  →  Nord Sahara 1959 (Clarke 1880) XYZ
// ---------------------------------------------------------------------------
const WGS84_TO_NS59 = { dx: -209, dy:  87, dz: -210 };
const NS59_TO_WGS84 = { dx:  209, dy: -87, dz:  210 };

// ---------------------------------------------------------------------------
//  معاملات منطقة Lambert voirol ancien  (الإهليليج Clarke 1880)
//  خط الزوال المركزي: 2.596898° E (غرينتش) = 2°42′E = 0° باريس
// ---------------------------------------------------------------------------
const LAMBERT_ZONES = {
    1: {   // شمال الجزائر
        lat0:  36.0    * deg2rad,
        lon0:  2.596898 * deg2rad,
        k0:    0.999625544,
        FE:    500000,
        FN:    300000
    },
    2: {   // جنوب الجزائر
        lat0:  33.3    * deg2rad,   // 33°18′N
        lon0:  2.596898 * deg2rad,
        k0:    0.999625769,
        FE:    500000,
        FN:    200000
    }
};

// ===========================================================================
//  أدوات تحويل نظام Helmert
// ===========================================================================

/** جغرافي (درجة) + الإهليليج  →  إحداثيات ECEF جيوحمركية XYZ */
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

/** إحداثيات ECEF جيوحمركية XYZ + الإهليليج  →  جغرافي (درجة) */
function ecef2geog(xyz, ell) {
    const { x, y, z } = xyz;
    const e2  = 2 * ell.f - ell.f * ell.f;
    const lon = Math.atan2(y, x);
    const p   = Math.sqrt(x * x + y * y);
    let lat   = Math.atan2(z, p * (1 - e2));   // التقدير الأولي
    for (let i = 0; i < 10; i++) {
        const N   = ell.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
        lat       = Math.atan2(z + e2 * N * Math.sin(lat), p);
    }
    return { latDeg: lat * rad2deg, lonDeg: lon * rad2deg };
}

/** تطبيق ترجمة Helmert بـ 3 معاملات على إحداثيات ECEF */
function helmert3(xyz, shift) {
    return { x: xyz.x + shift.dx, y: xyz.y + shift.dy, z: xyz.z + shift.dz };
}

/** WGS84 جغرافي (درجة)  →  Nord Sahara 1959 جغرافي (درجة) */
function wgs84ToNS59(latDeg, lonDeg) {
    const ecef_wgs = geog2ecef(latDeg, lonDeg, ELLIPSOID_WGS84);
    const ecef_ns  = helmert3(ecef_wgs, WGS84_TO_NS59);
    return ecef2geog(ecef_ns, ELLIPSOID_CLRK80);
}

/** Nord Sahara 1959 جغرافي (درجة)  →  WGS84 جغرافي (درجة) */
function ns59ToWgs84(latDeg, lonDeg) {
    const ecef_ns  = geog2ecef(latDeg, lonDeg, ELLIPSOID_CLRK80);
    const ecef_wgs = helmert3(ecef_ns, NS59_TO_WGS84);
    return ecef2geog(ecef_wgs, ELLIPSOID_WGS84);
}

// ===========================================================================
//  UTM الأمامي  (يعمل مع أي إهليليج)
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
//  UTM العكسي  (يعمل مع أي إهليليج)
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

/** لـ WGS84: جلاف UTM إلى Lat/Lon */
function utmToLatLon(zone, hemisphere, easting, northing) {
    return utmToLatLon_ell(zone, hemisphere, easting, northing, ELLIPSOID_WGS84);
}

/** لـ Nord Sahara 1959: جلاف UTM إلى Lat/Lon */
function utmToLatLonNS59(zone, hemisphere, easting, northing) {
    return utmToLatLon_ell(zone, hemisphere, easting, northing, ELLIPSOID_CLRK80);
}

// ===========================================================================
//  LAMBERT CONFORMAL CONIC — إسقاط ومعاكسة (Clarke 1880)
// ===========================================================================

function wgs84ToLambert(latDeg, lonDeg, zoneNumber) {
    // 1. WGS84 → Nord Sahara 1959
    const ns59 = wgs84ToNS59(latDeg, lonDeg);
    
    // 2. NS59 → Lambert
    return ns59ToLambert(ns59.latDeg, ns59.lonDeg, zoneNumber);
}

function ns59ToLambert(latDeg, lonDeg, zoneNumber) {
    const zone = LAMBERT_ZONES[zoneNumber] || LAMBERT_ZONES[1];
    
    const lat = latDeg * deg2rad;
    const lon = lonDeg * deg2rad;
    
    const lat0 = zone.lat0;
    const lon0 = zone.lon0;
    const k0   = zone.k0;
    
    // Clarke 1880
    const a = ELLIPSOID_CLRK80.a;
    const f = ELLIPSOID_CLRK80.f;
    const e2 = 2 * f - f * f;
    const e = Math.sqrt(e2);
    
    // Parameters
    const n  = f / (2 - f);
    const C  = a * (1 + n) * (1 + n * n) / (1 + 3 * n) * (1 - n);
    
    const t   = conformalLatitude(lat, e);
    const t0  = conformalLatitude(lat0, e);
    
    const theta = n * (lon - lon0);  // LCC: cone constant × meridian difference
    
    const rho = C * Math.pow(t0 / t, n) / Math.pow(Math.tan(Math.PI / 4 + lat0 / 2), n);
    const rho0 = C * Math.pow(t0 / t0, n) / Math.pow(Math.tan(Math.PI / 4 + lat0 / 2), n);
    
    const X = zone.FE + k0 * rho * Math.sin(n * theta);
    const Y = zone.FN + k0 * (rho0 - rho * Math.cos(n * theta));
    
    return { X, Y };
}

function lambertToNS59(X, Y, zoneNumber) {
    const zone = LAMBERT_ZONES[zoneNumber] || LAMBERT_ZONES[1];
    
    const lat0 = zone.lat0;
    const lon0 = zone.lon0;
    const k0   = zone.k0;
    
    // Clarke 1880
    const a = ELLIPSOID_CLRK80.a;
    const f = ELLIPSOID_CLRK80.f;
    const e2 = 2 * f - f * f;
    const e = Math.sqrt(e2);
    
    // Parameters
    const n  = f / (2 - f);
    const C  = a * (1 + n) * (1 + n * n) / (1 + 3 * n) * (1 - n);
    const t0 = conformalLatitude(lat0, e);
    
    const x = (X - zone.FE) / (k0 * C);
    const y = (Y - zone.FN) / (k0 * C);
    
    const rho0 = C / Math.pow(Math.tan(Math.PI / 4 + lat0 / 2), n);
    const rho = Math.sqrt(x * x + (rho0 - y) * (rho0 - y));
    
    const theta = Math.atan2(x, rho0 - y);
    
    const lon = lon0 + theta / Math.cos(lat0);
    
    // Iterate to find latitude
    let lat = 2 * Math.atan(Math.pow(C / rho, 1 / n)) - Math.PI / 2;
    for (let i = 0; i < 10; i++) {
        const t = conformalLatitude(lat, e);
        const latNew = 2 * Math.atan(Math.pow(t0 / t, 1 / n) * Math.pow(Math.tan(Math.PI / 4 + lat / 2), 1)) - Math.PI / 2;
        if (Math.abs(latNew - lat) < 1e-10) break;
        lat = latNew;
    }
    
    return { latDeg: lat * rad2deg, lonDeg: lon * rad2deg };
}

function wgs84ToNS59UTM(latDeg, lonDeg) {
    const ns59 = wgs84ToNS59(latDeg, lonDeg);
    return latLonToUTM_ell(ns59.latDeg, ns59.lonDeg, ELLIPSOID_CLRK80);
}

// ---------------------------------------------------------------------------
//  Uppercase aliases — used by bulk_converter-Ar.js
// ---------------------------------------------------------------------------
function UTMToLatLon(zone, hemisphere, easting, northing) {
    return utmToLatLon(zone, hemisphere, easting, northing);
}
function latLonToUTM(lat, lon) {
    return latLonToUTM_ell(lat, lon, ELLIPSOID_WGS84);
}


function conformalLatitude(lat, e) {
    const eSin = e * Math.sin(lat);
    return Math.tan(PI / 4 - lat / 2) / ((1 - eSin) / (1 + eSin)) ** (e / 2);
}

// ===========================================================================
//  مساعدي DMS ↔ DECIMAL
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
//  تهيئة الخريطة
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

    // العرض الافتراضي: مركز الجزائر
    const initialLat = 28.0;
    const initialLon =  3.0;

    try {
        map = L.map('map').setView([initialLat, initialLon], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© مساهمو OpenStreetMap'
        }).addTo(map);

        marker = L.marker([initialLat, initialLon], {
            draggable: true,
            title: "اسحب لتحديث الإحداثيات"
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
        console.error("خطأ في تهيئة الخريطة:", e);
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
        alert("يرجى إدخال قيم خطوط الطول والعرض.");
    }
}

// ===========================================================================
//  المساعدات
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

/** ملء جميع حقول NS59 من كائن النتيجة UTM */
function _fillNS59(result, precision) {
    if (!result) return;
    document.getElementById("ns59Zone").value     = result.zone;
    document.getElementById("ns59Hemi").value     = result.hemisphere;
    document.getElementById("ns59Easting").value  = result.easting.toFixed(precision);
    document.getElementById("ns59Northing").value = result.northing.toFixed(precision);
}

/** ملء جميع حقول Lambert من {X,Y} النتيجة */
function _fillLambert(result, precision) {
    if (!result) return;
    document.getElementById("lambertX").value = result.X.toFixed(precision);
    document.getElementById("lambertY").value = result.Y.toFixed(precision);
}

/** ملء حقول WGS84 UTM */
function _fillUTM(result, precision) {
    if (!result) return;
    document.getElementById("utmZone").value     = result.zone;
    document.getElementById("utmHemi").value     = result.hemisphere;
    document.getElementById("utmEasting").value  = result.easting.toFixed(precision);
    document.getElementById("utmNorthing").value = result.northing.toFixed(precision);
}

/** ملء حقول الدرجة العشرية */
function _fillDecimal(lat, lon, precision) {
    document.getElementById("decimalLatitude").value  = lat.toFixed(precision);
    document.getElementById("decimalLongitude").value = lon.toFixed(precision);
}

/** ملء حقول DMS */
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
//  الملء الرئيسي — ملء كل لوحة من WGS84 lat/lon
// ===========================================================================
function populateAll(lat, lon) {
    const p = getPrecision();

    _fillDecimal(lat, lon, p);
    _fillDMS(lat, lon, p);

    // WGS84 UTM
    _fillUTM(latLonToUTM(lat, lon), p);

    // Nord Sahara 1959 UTM
    _fillNS59(wgs84ToNS59UTM(lat, lon), p);

    // Lambert voirol ancien
    try {
        _fillLambert(wgs84ToLambert(lat, lon, getLambertZone()), p);
    } catch (e) {
        console.warn(":Lambert خارج النطاق  ",e.message);
        document.getElementById("lambertX").value = "—";
        document.getElementById("lambertY").value = "—";
    }

    updateMap();
}

// ===========================================================================
//  نقاط دخول المحول
// ===========================================================================

/** تحويل من الدرجات العشرية */
function convertDecimal() {
    const lat = parseFloat(document.getElementById("decimalLatitude").value);
    const lon = parseFloat(document.getElementById("decimalLongitude").value);
    if (isNaN(lat) || isNaN(lon)) {
        alert("يرجى إدخال قيم رقمية صحيحة لخطوط الطول والعرض.");
        return;
    }
    populateAll(lat, lon);
}

/** تحويل من DMS */
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
        alert("يرجى إدخال قيم رقمية صحيحة لجميع حقول DMS.");
        return;
    }

    populateAll(
        DMSToDecimal(latDeg, latMin, latSec, latDir),
        DMSToDecimal(lonDeg, lonMin, lonSec, lonDir)
    );
}

/** تحويل من WGS84 UTM */
function convertUTM() {
    const zone     = parseInt(document.getElementById("utmZone").value);
    const hemi     = document.getElementById("utmHemi").value;
    const easting  = parseFloat(document.getElementById("utmEasting").value);
    const northing = parseFloat(document.getElementById("utmNorthing").value);

    if (isNaN(zone) || isNaN(easting) || isNaN(northing)) {
        alert("يرجى إدخال قيم رقمية صحيحة لجميع حقول UTM.");
        return;
    }

    const ll = UTMToLatLon(zone, hemi, easting, northing);
    if (!ll) { alert("تعذر تحويل UTM إلى خطوط الطول والعرض."); return; }
    populateAll(ll.latitude, ll.longitude);
}

/** تحويل من Nord Sahara 1959 UTM */
function convertNS59() {
    const zone     = parseInt(document.getElementById("ns59Zone").value);
    const hemi     = document.getElementById("ns59Hemi").value;
    const easting  = parseFloat(document.getElementById("ns59Easting").value);
    const northing = parseFloat(document.getElementById("ns59Northing").value);

    if (isNaN(zone) || isNaN(easting) || isNaN(northing)) {
        alert("يرجى إدخال قيم رقمية صحيحة لجميع حقول Nord Sahara 1959.");
        return;
    }

    const ll = ns59UTMToWgs84(zone, hemi, easting, northing);
    if (!ll) { alert("تعذر تحويل Nord Sahara 1959 إلى خطوط الطول والعرض."); return; }
    populateAll(ll.latitude, ll.longitude);
}

/** تحويل من Lambert voirol ancien */
function convertLambert() {
    const X      = parseFloat(document.getElementById("lambertX").value);
    const Y      = parseFloat(document.getElementById("lambertY").value);
    const zone   = getLambertZone();

    if (isNaN(X) || isNaN(Y)) {
        alert("يرجى إدخال قيم رقمية صحيحة لـ X و Y في Lambert voirol ancien.");
        return;
    }

    try {
        const ll = lambertToWgs84(X, Y, zone);
        populateAll(ll.latitude, ll.longitude);
    } catch (e) {
        alert("خطأ في تحويل Lambert voirol ancien: " + e.message);
    }
}
