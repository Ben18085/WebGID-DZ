/**
 * Bulk Coordinate Converter Logic
 * ─────────────────────────────────────────────────────────────────────────────
 * Supported input  : Decimal DD · UTM WGS84 · DMS
 * Computed outputs : DD · DMS · UTM WGS84 · UTM Nord Sahara 1959 · Lambert Voirol Ancien (Algeria)
 *
 * Depends on       : PapaParse · SheetJS (XLSX) · Leaflet (for map)
 * No external geo  : All math is self-contained — no webgis_utm_lat_lon.js needed.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CONVERSION FORMULAS USED
 * ════════════════════════
 *
 * 1.  DMS → Decimal Degrees (DD)
 *     DD = Degrees + Minutes/60 + Seconds/3600
 *     Negate result for S (latitude) or W (longitude).
 *
 * 2.  DD → DMS
 *     Degrees = trunc(|DD|)
 *     Minutes = trunc((|DD| − Degrees) × 60)
 *     Seconds = ((|DD| − Degrees) × 60 − Minutes) × 60
 *     Append N/S or E/W based on sign.
 *
 * 3.  DD → UTM WGS84
 *     Ellipsoid : WGS84  a = 6 378 137 m  f = 1/298.257 223 563
 *     Projection: Transverse Mercator (Bowring/Snyder series)
 *       k₀ = 0.9996  FE = 500 000 m  FN = 0 (N) or 10 000 000 (S)
 *       Zone = floor((lon + 180)/6) + 1   λ₀ = (Zone−1)×6 − 180 + 3
 *     Formulas (Snyder p.61):
 *       e² = 2f − f²    N = a/√(1−e²sin²φ)    T = tan²φ
 *       C = e'²cos²φ    A = cosφ·(λ−λ₀)
 *       M = meridional arc (series in φ)
 *       E = FE + k₀·N·[A + (1−T+C)A³/6 + (5−18T+T²+72C−58e'²)A⁵/120]
 *       N = FN + k₀·{M + N·tanφ·[A²/2 + (5−T+9C+4C²)A⁴/24
 *                                       + (61−58T+T²+600C−330e'²)A⁶/720]}
 *
 * 4.  DD → UTM Nord Sahara 1959  (Clarke 1880 IGN)
 *     Step A – 3-parameter Helmert shift  WGS84 → Nord Sahara 1959
 *       WGS84 geographic → WGS84 Cartesian (X,Y,Z)
 *       Apply shift: ΔX=+209 m  ΔY=−87 m  ΔZ=−210 m  (WGS84→NS59, IGN)
 *       Cartesian → Clarke 1880 IGN geographic (iterative Bowring)
 *     Step B – Transverse Mercator on Clarke 1880 IGN
 *       a = 6 378 249.145 m  f = 1/293.465
 *       Same k₀, FE, FN, zone logic as WGS84 UTM.
 *
 * 5.  DD → Lambert Voirol Ancien — Algeria Nord
 *     Ellipsoid : Clarke 1880 IGN  a = 6 378 249.145 m  f = 1/293.465
 *     Projection: Lambert Conformal Conic 2SP (Snyder p.107)
 *       Standard parallels : φ₁ = 36°    φ₂ = 38°
 *       Origin latitude    : φ₀ = 36°
 *       Central meridian   : λ₀ = 2°42'E  (Voirol meridian)
 *       False Easting      : FE = 500 135.17 m
 *       False Northing     : FN = 300 090.03 m
 *     Formulas:
 *       m(φ)  = cosφ / √(1−e²sin²φ)
 *       t(φ)  = tan(π/4 − φ/2) / [(1−e·sinφ)/(1+e·sinφ)]^(e/2)
 *       n     = (ln m₁ − ln m₂) / (ln t₁ − ln t₂)
 *       F     = m₁ / (n · t₁ⁿ)
 *       ρ(φ)  = a · F · tⁿ         ρ₀ = a · F · t₀ⁿ
 *       θ     = n · (λ − λ₀)
 *       E     = FE + ρ·sin θ
 *       N     = FN + ρ₀ − ρ·cos θ
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════
   ELLIPSOID CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */

const ELLIPSOIDS = {
    WGS84: { a: 6378137.0,     f: 1 / 298.257223563 },
    CLARKE_1880_IGN: { a: 6378249.145, f: 1 / 293.465 }
};

/* ═══════════════════════════════════════════════════════════════════
   FORMULA 1 & 2 — DMS ↔ DECIMAL DEGREES
   ═══════════════════════════════════════════════════════════════════ */

/**
 * DMS → Decimal Degrees
 * @param {number} deg  Degrees (always positive)
 * @param {number} min  Minutes
 * @param {number} sec  Seconds
 * @param {string} dir  'N'|'S'|'E'|'W'
 * @returns {number}
 */
function DMSToDecimal(deg, min, sec, dir) {
    let dd = Math.abs(deg) + min / 60.0 + sec / 3600.0;
    if (dir === 'S' || dir === 'W') dd = -dd;
    return dd;
}

/**
 * Decimal Degrees → DMS object
 * @param {number} dd
 * @returns {{ degrees:number, minutes:number, seconds:number }}
 */
function decimalToDMS(dd) {
    const abs = Math.abs(dd);
    const degrees = Math.floor(abs);
    const minutesFull = (abs - degrees) * 60;
    const minutes = Math.floor(minutesFull);
    const seconds = (minutesFull - minutes) * 60;
    return { degrees, minutes, seconds };
}

/* ═══════════════════════════════════════════════════════════════════
   FORMULA 3 — DD → UTM (generic ellipsoid)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Convert decimal lat/lon to UTM on any ellipsoid.
 * @param {number} latDD   Decimal degrees latitude  (−90 … +90)
 * @param {number} lonDD   Decimal degrees longitude (−180 … +180)
 * @param {object} ell     Ellipsoid { a, f }
 * @returns {{ zone:number, hemisphere:string, easting:number, northing:number }}
 */
function latLonToUTM_ellipsoid(latDD, lonDD, ell) {
    const { a, f } = ell;
    const toRad = Math.PI / 180;
    const φ = latDD * toRad;
    const λ = lonDD * toRad;

    const b   = a * (1 - f);
    const e2  = (a * a - b * b) / (a * a);   // first eccentricity²
    const ep2 = e2 / (1 - e2);               // second eccentricity²

    // UTM zone
    const zone = Math.floor((lonDD + 180) / 6) + 1;
    const λ0   = ((zone - 1) * 6 - 180 + 3) * toRad;   // central meridian
    const k0   = 0.9996;
    const FE   = 500000;
    const FN   = latDD < 0 ? 10000000 : 0;

    const N   = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
    const T   = Math.tan(φ) ** 2;
    const C   = ep2 * Math.cos(φ) ** 2;
    const A   = Math.cos(φ) * (λ - λ0);

    // Meridional arc M (Snyder eq. 3-21)
    const M = a * (
          (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * φ
        - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * φ)
        + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * φ)
        - (35 * e2 ** 3 / 3072) * Math.sin(6 * φ)
    );

    const easting = FE + k0 * N * (
          A
        + (1 - T + C) * A ** 3 / 6
        + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120
    );

    const northing = FN + k0 * (
        M + N * Math.tan(φ) * (
              A ** 2 / 2
            + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
            + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720
        )
    );

    return {
        zone,
        hemisphere: latDD >= 0 ? 'N' : 'S',
        easting,
        northing
    };
}

/**
 * UTM → Lat/Lon on a given ellipsoid (inverse TM, Snyder)
 */
function UTMToLatLon_ellipsoid(zone, hemisphere, easting, northing, ell) {
    const { a, f } = ell;
    const toRad = Math.PI / 180;
    const b   = a * (1 - f);
    const e2  = (a * a - b * b) / (a * a);
    const ep2 = e2 / (1 - e2);
    const k0  = 0.9996;
    const FE  = 500000;
    const FN  = hemisphere === 'S' ? 10000000 : 0;
    const λ0  = ((zone - 1) * 6 - 180 + 3) * toRad;

    const x = easting - FE;
    const y = northing - FN;

    const e1  = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const M   = y / k0;
    const mu  = M / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
    const φ1  = mu
        + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
        + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
        + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
        + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);

    const N1 = a / Math.sqrt(1 - e2 * Math.sin(φ1) ** 2);
    const T1 = Math.tan(φ1) ** 2;
    const C1 = ep2 * Math.cos(φ1) ** 2;
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(φ1) ** 2, 1.5);
    const D  = x / (N1 * k0);

    const lat = φ1 - (N1 * Math.tan(φ1) / R1) * (
          D ** 2 / 2
        - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720
    );

    const lon = λ0 + (
          D
        - (1 + 2 * T1 + C1) * D ** 3 / 6
        + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120
    ) / Math.cos(φ1);

    return { latitude: lat / toRad, longitude: lon / toRad };
}

/* ─── WGS84 convenience wrappers (for existing call-sites) ─── */

function latLonToUTM(latDD, lonDD) {
    return latLonToUTM_ellipsoid(latDD, lonDD, ELLIPSOIDS.WGS84);
}

function UTMToLatLon(zone, hemisphere, easting, northing) {
    return UTMToLatLon_ellipsoid(zone, hemisphere, easting, northing, ELLIPSOIDS.WGS84);
}

/* ═══════════════════════════════════════════════════════════════════
   FORMULA 4 — DD → UTM NORD SAHARA 1959  (Clarke 1880 IGN)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * WGS84 geographic → WGS84 Cartesian ECEF
 */
function geographicToCartesian(latRad, lonRad, ell) {
    const { a, f } = ell;
    const e2 = 2 * f - f * f;
    const N  = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
    return {
        X: N * Math.cos(latRad) * Math.cos(lonRad),
        Y: N * Math.cos(latRad) * Math.sin(lonRad),
        Z: N * (1 - e2) * Math.sin(latRad)
    };
}

/**
 * Cartesian ECEF → geographic (iterative Bowring, ~5 iterations)
 */
function cartesianToGeographic(X, Y, Z, ell) {
    const { a, f } = ell;
    const e2 = 2 * f - f * f;
    const p  = Math.sqrt(X * X + Y * Y);
    let   φ  = Math.atan2(Z, p * (1 - e2));          // first estimate
    for (let i = 0; i < 10; i++) {
        const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
        φ = Math.atan2(Z + e2 * N * Math.sin(φ), p);
    }
    const λ = Math.atan2(Y, X);
    return { latRad: φ, lonRad: λ };
}

/**
 * Convert WGS84 DD → UTM Nord Sahara 1959
 *
 * Helmert 3-parameter shift  WGS84 → Nord Sahara 1959:
 *   ΔX = +209 m   ΔY = −87 m   ΔZ = −210 m
 * (IGN published values, sign convention: add to WGS84 ECEF to obtain NS59 ECEF)
 *
 * @param {number} latDD  WGS84 decimal degrees latitude
 * @param {number} lonDD  WGS84 decimal degrees longitude
 * @returns {{ zone:number, hemisphere:string, easting:number, northing:number,
 *             latNS:number, lonNS:number }}
 */
function latLonToUTM_NordSahara1959(latDD, lonDD) {
    const toRad = Math.PI / 180;

    // Step 1 – WGS84 geographic → WGS84 Cartesian
    const wgs = geographicToCartesian(latDD * toRad, lonDD * toRad, ELLIPSOIDS.WGS84);

    // Step 2 – 3-parameter Helmert shift  (WGS84 → Nord Sahara 1959)
    const ΔX = 209, ΔY = -87, ΔZ = -210;
    const X2 = wgs.X + ΔX;
    const Y2 = wgs.Y + ΔY;
    const Z2 = wgs.Z + ΔZ;

    // Step 3 – Cartesian → Clarke 1880 IGN geographic
    const { latRad, lonRad } = cartesianToGeographic(X2, Y2, Z2, ELLIPSOIDS.CLARKE_1880_IGN);
    const latNS = latRad / toRad;
    const lonNS = lonRad / toRad;

    // Step 4 – Transverse Mercator on Clarke 1880 IGN
    const utm = latLonToUTM_ellipsoid(latNS, lonNS, ELLIPSOIDS.CLARKE_1880_IGN);
    return { ...utm, latNS, lonNS };
}

/* ═══════════════════════════════════════════════════════════════════
   FORMULA 5 — DD → LAMBERT VOIROL ANCIEN  (Algeria Nord)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Convert WGS84 DD → Lambert Voirol Ancien (Algeria Nord zone)
 *
 * This function first shifts WGS84 → Nord Sahara 1959 (Clarke 1880 IGN)
 * via the same Helmert shift, then applies Lambert Conformal Conic 2SP.
 *
 * LCC parameters — Algeria Nord:
 *   φ₁ = 36°       φ₂ = 38°       (standard parallels)
 *   φ₀ = 36°                       (origin latitude)
 *   λ₀ = 2°42'00"E = 2.7°E         (Voirol meridian)
 *   FE = 500 135.17 m
 *   FN = 300 090.03 m
 *
 * @param {number} latDD  WGS84 decimal degrees latitude
 * @param {number} lonDD  WGS84 decimal degrees longitude
 * @returns {{ easting:number, northing:number, zone:string }}
 */
function latLonToLambert_VoirolAncien(latDD, lonDD) {
    const toRad = Math.PI / 180;
    const ell   = ELLIPSOIDS.CLARKE_1880_IGN;
    const { a, f } = ell;
    const e2 = 2 * f - f * f;
    const e  = Math.sqrt(e2);

    // ── Shift WGS84 → Nord Sahara 1959 geographic ──────────────────
    const wgs = geographicToCartesian(latDD * toRad, lonDD * toRad, ELLIPSOIDS.WGS84);
    const ΔX = 209, ΔY = -87, ΔZ = -210;
    const { latRad: φ, lonRad: λ } = cartesianToGeographic(
        wgs.X + ΔX, wgs.Y + ΔY, wgs.Z + ΔZ, ell
    );

    // ── LCC 2SP parameters ──────────────────────────────────────────
    const φ1 = 36 * toRad;                // standard parallel 1
    const φ2 = 38 * toRad;                // standard parallel 2
    const φ0 = 36 * toRad;                // grid origin latitude
    const λ0 = (2 + 42 / 60) * toRad;    // Voirol meridian = 2°42'E
    const FE = 500135.17;
    const FN = 300090.03;

    // helper functions (Snyder eq. 15-9 and 15-7)
    const m = (φ_) => Math.cos(φ_) / Math.sqrt(1 - e2 * Math.sin(φ_) ** 2);
    const t = (φ_) => Math.tan(Math.PI / 4 - φ_ / 2)
        / Math.pow((1 - e * Math.sin(φ_)) / (1 + e * Math.sin(φ_)), e / 2);

    const m1 = m(φ1), m2 = m(φ2);
    const t1 = t(φ1), t2 = t(φ2);
    const t0 = t(φ0), ti = t(φ);

    // cone constant & scale factor
    const n  = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
    const F  = m1 / (n * Math.pow(t1, n));

    // radii of curvature along the meridian
    const ρ0 = a * F * Math.pow(t0, n);
    const ρ  = a * F * Math.pow(ti, n);

    // convergence angle
    const θ = n * (λ - λ0);

    const easting  = FE + ρ * Math.sin(θ);
    const northing = FN + ρ0 - ρ * Math.cos(θ);

    return { easting, northing, zone: 'Algeria Nord' };
}

/* ═══════════════════════════════════════════════════════════════════
   CORE OUTPUT BUILDER  — appendComputedColumns
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Given a source row and resolved WGS84 lat/lon, append all computed columns.
 * Replaces the old NATO column with UTM Nord Sahara 1959 + Lambert Voirol.
 */
function appendComputedColumns(row, lat, lon, precision) {
    let result = { ...row };

    // ── Initialise all output columns (empty strings = safe fallback) ──
    result['Computed_Lat']                  = '';
    result['Computed_Lon']                  = '';
    result['Computed_Lat_DMS']              = '';
    result['Computed_Lon_DMS']              = '';
    // UTM WGS84
    result['Computed_UTM_Zone']             = '';
    result['Computed_UTM_Hemi']             = '';
    result['Computed_UTM_Easting']          = '';
    result['Computed_UTM_Northing']         = '';
    result['Computed_UTM_String']           = '';
    // UTM Nord Sahara 1959
    result['Computed_NS59_Zone']            = '';
    result['Computed_NS59_Hemi']            = '';
    result['Computed_NS59_Easting']         = '';
    result['Computed_NS59_Northing']        = '';
    result['Computed_NS59_String']          = '';
    // Lambert Voirol Ancien
    result['Computed_Lambert_Voirol_Zone']  = '';
    result['Computed_Lambert_Voirol_E']     = '';
    result['Computed_Lambert_Voirol_N']     = '';
    result['Computed_Lambert_Voirol_String']= '';

    if (!isNaN(lat) && !isNaN(lon)) {

        // 1 ── Decimal Degrees ─────────────────────────────────────────
        result['Computed_Lat'] = lat.toFixed(precision);
        result['Computed_Lon'] = lon.toFixed(precision);

        // 2 ── DMS ─────────────────────────────────────────────────────
        const latDMS = decimalToDMS(lat);
        const lonDMS = decimalToDMS(lon);
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';
        // Note: using plain ° (U+00B0) — no encoding artefacts
        result['Computed_Lat_DMS'] = `${Math.abs(latDMS.degrees)}° ${latDMS.minutes}' ${latDMS.seconds.toFixed(precision)}" ${latDir}`;
        result['Computed_Lon_DMS'] = `${Math.abs(lonDMS.degrees)}° ${lonDMS.minutes}' ${lonDMS.seconds.toFixed(precision)}" ${lonDir}`;

        // 3 ── UTM WGS84 ───────────────────────────────────────────────
        try {
            const utm = latLonToUTM(lat, lon);
            if (utm) {
                result['Computed_UTM_Zone']    = utm.zone;
                result['Computed_UTM_Hemi']    = utm.hemisphere;
                result['Computed_UTM_Easting'] = utm.easting.toFixed(precision);
                result['Computed_UTM_Northing']= utm.northing.toFixed(precision);
                result['Computed_UTM_String']  = `${utm.zone}${utm.hemisphere} E:${utm.easting.toFixed(precision)} N:${utm.northing.toFixed(precision)}`;
            }
        } catch (e) { console.warn('UTM WGS84 error', e); }

        // 4 ── UTM Nord Sahara 1959 ────────────────────────────────────
        try {
            const ns = latLonToUTM_NordSahara1959(lat, lon);
            result['Computed_NS59_Zone']    = ns.zone;
            result['Computed_NS59_Hemi']    = ns.hemisphere;
            result['Computed_NS59_Easting'] = ns.easting.toFixed(precision);
            result['Computed_NS59_Northing']= ns.northing.toFixed(precision);
            result['Computed_NS59_String']  = `${ns.zone}${ns.hemisphere} E:${ns.easting.toFixed(precision)} N:${ns.northing.toFixed(precision)}`;
        } catch (e) { console.warn('Nord Sahara 1959 error', e); }

        // 5 ── Lambert Voirol Ancien ───────────────────────────────────
        try {
            const lv = latLonToLambert_VoirolAncien(lat, lon);
            result['Computed_Lambert_Voirol_Zone']  = lv.zone;
            result['Computed_Lambert_Voirol_E']     = lv.easting.toFixed(precision);
            result['Computed_Lambert_Voirol_N']     = lv.northing.toFixed(precision);
            result['Computed_Lambert_Voirol_String']= `${lv.zone} E:${lv.easting.toFixed(precision)} N:${lv.northing.toFixed(precision)}`;
        } catch (e) { console.warn('Lambert Voirol error', e); }
    }

    return result;
}

/* ═══════════════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════════════ */

let globalData    = [];
let globalHeaders = [];

/* ═══════════════════════════════════════════════════════════════════
   DOM INIT & FILE DROP
   ═══════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {
    const dropZone  = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt =>
        dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }, false)
    );
    ['dragenter', 'dragover'].forEach(evt =>
        dropZone.addEventListener(evt, () => dropZone.classList.add('highlight'), false)
    );
    ['dragleave', 'drop'].forEach(evt =>
        dropZone.addEventListener(evt, () => dropZone.classList.remove('highlight'), false)
    );

    dropZone.addEventListener('drop',       e => handleFiles(e.dataTransfer.files), false);
    fileInput.addEventListener('change',    e => handleFiles(e.target.files),        false);
});

/* ═══════════════════════════════════════════════════════════════════
   FILE HANDLING
   ═══════════════════════════════════════════════════════════════════ */

function handleFiles(files) {
    if (!files.length) return;
    const file = files[0];
    document.getElementById('loadingIndicator').style.display = 'block';
    ['configSection', 'mappingSection', 'resultsSection'].forEach(id =>
        document.getElementById(id).style.display = 'none'
    );

    if (/\.(csv|txt)$/i.test(file.name)) {
        parseCSV(file);
    } else if (/\.(xls|xlsx|xlsm)$/i.test(file.name)) {
        parseExcel(file);
    } else {
        alert('Unsupported file type. Please use CSV, TXT, or Excel.');
        document.getElementById('loadingIndicator').style.display = 'none';
    }
}

function parseCSV(file) {
    Papa.parse(file, {
        complete : results => processParsedData(results.data, file.name),
        header         : true,
        skipEmptyLines : true,
        dynamicTyping  : true
    });
}

function parseExcel(file) {
    const reader = new FileReader();
    reader.onload = e => {
        const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        processParsedData(json, file.name);
    };
    reader.readAsArrayBuffer(file);
}

function processParsedData(data, filename) {
    document.getElementById('loadingIndicator').style.display = 'none';

    // Remove fully-empty rows
    data = data.filter(row =>
        Object.values(row).some(v => v !== null && String(v).trim() !== '')
    );

    if (!data || data.length === 0) {
        alert('No valid data was found in the file.');
        return;
    }

    globalData    = data;
    globalHeaders = Object.keys(data[0]);

    document.getElementById('configSection').style.display  = 'block';
    document.getElementById('mappingSection').style.display = 'block';

    populateColumnSelectors();

    const fileInfo = document.getElementById('fileInfo');
    if (fileInfo) fileInfo.style.display = 'block';
    document.getElementById('fileName').textContent = filename;
    document.getElementById('rowCount').textContent  = data.length;

    renderPreviewTable(data.slice(0, 5));
}

/* ═══════════════════════════════════════════════════════════════════
   COLUMN SELECTORS & MAPPING UI
   ═══════════════════════════════════════════════════════════════════ */

function populateColumnSelectors() {
    document.querySelectorAll('.column-select').forEach(select => {
        select.innerHTML = '';

        const def = document.createElement('option');
        def.value = '';
        def.textContent = '-- Select a Column --';
        select.appendChild(def);

        if (select.dataset.allowConstant === 'true') {
            const c = document.createElement('option');
            c.value       = 'CONSTANT_VALUE';
            c.textContent = '[ Use constant value ]';
            c.style.fontWeight = 'bold';
            select.appendChild(c);
        }

        globalHeaders.forEach(header => {
            const opt = document.createElement('option');
            opt.value = opt.textContent = header;
            select.appendChild(opt);
        });
    });
}

/**
 * Show the correct mapping panel for the chosen conversion type.
 * Conversion type 'nato' has been replaced by 'utm_ns59' (Nord Sahara 1959 input).
 * All outputs always include WGS84 UTM + NS59 UTM + Lambert Voirol.
 */
function updateMappingUI() {
    const type = document.getElementById('conversionType').value;
    document.querySelectorAll('.mapping-grid').forEach(el => el.style.display = 'none');

    const map = {
        decimal  : 'mapping-decimal',
        utm      : 'mapping-utm',
        dms      : 'mapping-dms',
        utm_ns59 : 'mapping-utm-ns59'     // ← replaces old 'nato' panel
    };
    if (map[type]) document.getElementById(map[type]).style.display = 'flex';
}

function handleColumnSelectChange(selectElement) {
    const id = selectElement.dataset.constantInput;
    if (!id) return;
    document.getElementById(id).style.display =
        selectElement.value === 'CONSTANT_VALUE' ? 'block' : 'none';
}

/* ═══════════════════════════════════════════════════════════════════
   PREVIEW TABLE
   ═══════════════════════════════════════════════════════════════════ */

function renderPreviewTable(previewData) {
    const thead = document.querySelector('#previewTable thead');
    const tbody = document.querySelector('#previewTable tbody');
    thead.innerHTML = tbody.innerHTML = '';

    const trh = document.createElement('tr');
    globalHeaders.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        trh.appendChild(th);
    });
    thead.appendChild(trh);

    previewData.forEach(row => {
        const tr = document.createElement('tr');
        globalHeaders.forEach(h => {
            const td = document.createElement('td');
            td.textContent = row[h];
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

/* ═══════════════════════════════════════════════════════════════════
   CONVERT DISPATCH
   ═══════════════════════════════════════════════════════════════════ */

function convertData() {
    const type       = document.getElementById('conversionType').value;
    const processBtn = document.getElementById('processBtn');
    processBtn.disabled    = true;
    processBtn.textContent = 'Processing…';

    setTimeout(() => {
        try {
            let results = [];
            if      (type === 'decimal')  results = processDecimalInput();
            else if (type === 'utm')      results = processUTMInput();
            else if (type === 'dms')      results = processDMSInput();
            else if (type === 'utm_ns59') results = processUTM_NS59Input();

            if (results.length > 0) renderResults(results);
        } catch (e) {
            console.error(e);
            alert('Error during conversion. Please check your input and the console.');
        } finally {
            processBtn.disabled    = false;
            processBtn.textContent = 'Convert All';
        }
    }, 100);
}

/* ═══════════════════════════════════════════════════════════════════
   INPUT PROCESSORS
   ═══════════════════════════════════════════════════════════════════ */

function processDecimalInput() {
    const latCol   = document.getElementById('colLat').value;
    const lonCol   = document.getElementById('colLon').value;
    const precision = parseInt(document.getElementById('decimalPrecision').value) || 3;

    if (!latCol || !lonCol) {
        alert('Please select the Latitude and Longitude columns.'); return [];
    }
    return globalData.map(row =>
        appendComputedColumns(row, parseFloat(row[latCol]), parseFloat(row[lonCol]), precision)
    );
}

function processUTMInput() {
    const zoneSelect = document.getElementById('colZone');
    const hemiSelect = document.getElementById('colHemi');
    const eastCol    = document.getElementById('colEast').value;
    const northCol   = document.getElementById('colNorth').value;
    const precision  = parseInt(document.getElementById('decimalPrecision').value) || 3;

    if ((!zoneSelect.value) || (!hemiSelect.value) || !eastCol || !northCol) {
        alert('Please assign all UTM columns or provide constant values.'); return [];
    }

    const constZone = zoneSelect.value === 'CONSTANT_VALUE'
        ? parseInt(document.getElementById('manualZone').value) : null;
    const constHemi = hemiSelect.value === 'CONSTANT_VALUE'
        ? document.getElementById('manualHemi').value : null;

    return globalData.map(row => {
        const zone    = constZone !== null ? constZone : parseInt(row[zoneSelect.value]);
        const hemi    = constHemi !== null ? constHemi : String(row[hemiSelect.value]).trim().toUpperCase();
        const easting = parseFloat(row[eastCol]);
        const northing= parseFloat(row[northCol]);

        if (!isNaN(zone) && !isNaN(easting) && !isNaN(northing)) {
            const ll = UTMToLatLon(zone, hemi, easting, northing);
            if (ll) return appendComputedColumns(row, ll.latitude, ll.longitude, precision);
        }
        return appendComputedColumns(row, NaN, NaN, precision);
    });
}

function processDMSInput() {
    const latDegCol = document.getElementById('colLatDeg').value;
    const latMinCol = document.getElementById('colLatMin').value;
    const latSecCol = document.getElementById('colLatSec').value;
    const lonDegCol = document.getElementById('colLonDeg').value;
    const lonMinCol = document.getElementById('colLonMin').value;
    const lonSecCol = document.getElementById('colLonSec').value;
    const precision = parseInt(document.getElementById('decimalPrecision').value) || 3;

    if (!latDegCol || !latMinCol || !latSecCol || !lonDegCol || !lonMinCol || !lonSecCol) {
        alert('Please assign all DMS columns.'); return [];
    }

    return globalData.map(row => {
        const latDeg = parseFloat(row[latDegCol]);
        const latMin = parseFloat(row[latMinCol]);
        const latSec = parseFloat(row[latSecCol]);
        const lonDeg = parseFloat(row[lonDegCol]);
        const lonMin = parseFloat(row[lonMinCol]);
        const lonSec = parseFloat(row[lonSecCol]);

        let latDir = latDeg < 0 ? 'S' : 'N';
        let lonDir = lonDeg < 0 ? 'W' : 'E';

        const lat = DMSToDecimal(Math.abs(latDeg), latMin, latSec, latDir);
        const lon = DMSToDecimal(Math.abs(lonDeg), lonMin, lonSec, lonDir);
        return appendComputedColumns(row, lat, lon, precision);
    });
}

/**
 * Process input that is already in UTM Nord Sahara 1959 (Clarke 1880 IGN).
 * Converts NS59 UTM → NS59 geographic → WGS84 geographic, then appends all columns.
 */
function processUTM_NS59Input() {
    const zoneSelect = document.getElementById('colNS59Zone');
    const hemiSelect = document.getElementById('colNS59Hemi');
    const eastCol    = document.getElementById('colNS59East').value;
    const northCol   = document.getElementById('colNS59North').value;
    const precision  = parseInt(document.getElementById('decimalPrecision').value) || 3;

    if (!zoneSelect || !zoneSelect.value || !hemiSelect || !hemiSelect.value || !eastCol || !northCol) {
        alert('Please assign all Nord Sahara 1959 UTM columns.'); return [];
    }

    const constZone = zoneSelect.value === 'CONSTANT_VALUE'
        ? parseInt(document.getElementById('manualNS59Zone').value) : null;
    const constHemi = hemiSelect.value === 'CONSTANT_VALUE'
        ? document.getElementById('manualNS59Hemi').value : null;

    const toRad = Math.PI / 180;

    return globalData.map(row => {
        const zone    = constZone !== null ? constZone : parseInt(row[zoneSelect.value]);
        const hemi    = constHemi !== null ? constHemi : String(row[hemiSelect.value]).trim().toUpperCase();
        const easting = parseFloat(row[eastCol]);
        const northing= parseFloat(row[northCol]);

        if (isNaN(zone) || isNaN(easting) || isNaN(northing))
            return appendComputedColumns(row, NaN, NaN, precision);

        // NS59 UTM → Clarke 1880 geographic
        const ll_cl = UTMToLatLon_ellipsoid(zone, hemi, easting, northing, ELLIPSOIDS.CLARKE_1880_IGN);
        if (!ll_cl) return appendComputedColumns(row, NaN, NaN, precision);

        // Clarke 1880 geographic → Cartesian
        const cart = geographicToCartesian(ll_cl.latitude * toRad, ll_cl.longitude * toRad, ELLIPSOIDS.CLARKE_1880_IGN);

        // Helmert inverse shift  NS59 → WGS84  (ΔX,ΔY,ΔZ reversed)
        const X2 = cart.X - 209;
        const Y2 = cart.Y + 87;
        const Z2 = cart.Z + 210;

        // Cartesian → WGS84 geographic
        const ll_wgs = cartesianToGeographic(X2, Y2, Z2, ELLIPSOIDS.WGS84);
        return appendComputedColumns(row, ll_wgs.latRad / toRad, ll_wgs.lonRad / toRad, precision);
    });
}

/* ═══════════════════════════════════════════════════════════════════
   PASTE HANDLER
   ═══════════════════════════════════════════════════════════════════ */

function handlePasteData() {
    const rawText   = document.getElementById('pasteArea').value;
    const hasHeaders= document.getElementById('hasHeaders').checked;

    if (!rawText.trim()) { alert('Please paste some data first.'); return; }

    Papa.parse(rawText, {
        complete: results => {
            let data = results.data;
            if (!hasHeaders && data.length > 0 && Array.isArray(data[0])) {
                const numCols = data[0].length;
                const headers = Array.from({ length: numCols }, (_, i) => `Column ${i + 1}`);
                data = data.map(row => {
                    const obj = {};
                    row.forEach((v, i) => { obj[headers[i]] = v; });
                    return obj;
                });
            }
            processParsedData(data, 'Pasted text');
        },
        header         : hasHeaders,
        skipEmptyLines : true,
        dynamicTyping  : true
    });
}

/* ═══════════════════════════════════════════════════════════════════
   RESULTS TABLE
   ═══════════════════════════════════════════════════════════════════ */

let currentResults = [];

function renderResults(data) {
    currentResults = data;
    const section = document.getElementById('resultsSection');
    section.style.display = 'block';

    const table = document.getElementById('resultsTable');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    thead.innerHTML = tbody.innerHTML = '';

    const displayData = data.slice(0, 100);
    const headers     = Object.keys(data[0]);

    const trh = document.createElement('tr');
    headers.forEach(h => {
        const th = document.createElement('th');
        if (h.startsWith('Computed_')) th.classList.add('bg-success', 'text-white');
        th.textContent = h;
        trh.appendChild(th);
    });
    thead.appendChild(trh);

    displayData.forEach(row => {
        const tr = document.createElement('tr');
        headers.forEach(h => {
            const td = document.createElement('td');
            td.textContent = row[h];
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    section.scrollIntoView({ behavior: 'smooth' });
    updateMap(data);
}

/* ═══════════════════════════════════════════════════════════════════
   LEAFLET MAP
   ═══════════════════════════════════════════════════════════════════ */

let bulkMapInstance = null;
let markersLayer    = null;

function updateMap(data) {
    if (!document.getElementById('bulkMap')) return;

    if (!bulkMapInstance) {
        bulkMapInstance = L.map('bulkMap').setView([28, 3], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(bulkMapInstance);
        markersLayer = L.layerGroup().addTo(bulkMapInstance);
    } else {
        markersLayer.clearLayers();
        setTimeout(() => bulkMapInstance.invalidateSize(), 100);
    }

    const bounds = [];
    let validCount = 0;

    data.forEach(row => {
        const lat = parseFloat(row['Computed_Lat']);
        const lon = parseFloat(row['Computed_Lon']);
        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;

        const popup = `
            <div style="text-align:center;font-family:monospace;font-size:12px;">
                <b>Point ${++validCount}</b><br>
                DD: ${lat.toFixed(6)}, ${lon.toFixed(6)}<br>
                UTM WGS84: ${row['Computed_UTM_String'] || '—'}<br>
                NS59: ${row['Computed_NS59_String']     || '—'}<br>
                Lambert: ${row['Computed_Lambert_Voirol_String'] || '—'}
            </div>`;
        L.marker([lat, lon]).bindPopup(popup).addTo(markersLayer);
        bounds.push([lat, lon]);
    });

    if (bounds.length > 0)
        bulkMapInstance.fitBounds(L.latLngBounds(bounds), { padding: [50, 50] });
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORT
   ═══════════════════════════════════════════════════════════════════ */

function exportResults(format) {
    if (format === 'csv') {
        if (typeof Papa === 'undefined') { alert('PapaParse not loaded.'); return; }
        downloadFile(Papa.unparse(currentResults), 'converted_coordinates.csv', 'text/csv');

    } else if (format === 'excel') {
        if (typeof XLSX === 'undefined') { alert('SheetJS not loaded.'); return; }
        const ws = XLSX.utils.json_to_sheet(currentResults);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Coordinates');
        XLSX.writeFile(wb, 'Converted_Coordinates_ABConsultingDZ.xlsx');

    } else if (format === 'kml') {
        downloadFile(generateKML(currentResults), 'Coordinates_ABConsultingDZ.kml',
            'application/vnd.google-earth.kml+xml');
    }
}

function generateKML(data) {
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Exported Coordinates — ABConsultingDZ</name>
    <Style id="pointStyle">
      <IconStyle><scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon>
      </IconStyle>
    </Style>`;

    data.forEach((row, idx) => {
        const lat = parseFloat(row['Computed_Lat']);
        const lon = parseFloat(row['Computed_Lon']);
        if (isNaN(lat) || isNaN(lon)) return;

        const nameCol = Object.keys(row)[0];
        const name    = row[nameCol] || `Point ${idx + 1}`;

        let desc = '<table border="1" cellpadding="2" cellspacing="0">';
        for (const [k, v] of Object.entries(row))
            desc += `<tr><td><b>${k}</b></td><td>${v}</td></tr>`;
        desc += '</table>';

        kml += `
    <Placemark>
      <name>${name}</name>
      <description><![CDATA[${desc}]]></description>
      <styleUrl>#pointStyle</styleUrl>
      <Point><coordinates>${lon},${lat},0</coordinates></Point>
    </Placemark>`;
    });

    return kml + '\n  </Document>\n</kml>';
}

function downloadFile(content, fileName, mimeType) {
    try {
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(new Blob([content], { type: mimeType }));
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (e) {
        console.error('Download failed:', e);
        alert('Error downloading the file. Check the console for details.');
    }
}
