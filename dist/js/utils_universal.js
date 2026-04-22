/**
 * utils_universal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Utility library for geographic coordinate conversion and clipboard helpers.
 *
 * Supported coordinate systems:
 *   • Decimal Degrees (DD)
 *   • Degrees Minutes Seconds (DMS)
 *   • UTM WGS84
 *   • UTM Nord Sahara 1959  (Clarke 1880 IGN — Algeria)
 *   • Lambert Voirol Ancien (Clarke 1880 IGN — Algeria Nord zone)
 *
 * No external dependencies — all math is self-contained.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CONVERSION FORMULAS
 * ════════════════════
 *
 * [1] DMS → Decimal Degrees
 *     DD = |Degrees| + Minutes/60 + Seconds/3600
 *     Negate for S or W.
 *
 * [2] Decimal Degrees → DMS
 *     D = trunc(|DD|)
 *     M = trunc((|DD|−D) × 60)
 *     S = ((|DD|−D) × 60 − M) × 60
 *
 * [3] DD → UTM WGS84  (Transverse Mercator, Snyder 1987 p.61)
 *     Ellipsoid: a = 6 378 137 m   f = 1/298.257 223 563
 *     k₀ = 0.9996   FE = 500 000 m   FN = 0 (N) / 10 000 000 (S)
 *     Zone = floor((lon+180)/6)+1   λ₀ = (Zone−1)×6 − 180 + 3
 *     e² = 2f−f²   e'² = e²/(1−e²)
 *     N(φ) = a/√(1−e²sin²φ)         T = tan²φ    C = e'²cos²φ
 *     A = cosφ·(λ−λ₀)               M = meridional arc series
 *     E = FE + k₀N[A+(1−T+C)A³/6+(5−18T+T²+72C−58e'²)A⁵/120]
 *     N = FN + k₀{M+Ntanφ[A²/2+(5−T+9C+4C²)A⁴/24
 *                         +(61−58T+T²+600C−330e'²)A⁶/720]}
 *
 * [4] DD → UTM Nord Sahara 1959  (IGN — Clarke 1880)
 *     Step A: WGS84 geographic → ECEF Cartesian
 *     Step B: 3-parameter Helmert shift  WGS84 → NS59
 *             ΔX = +209 m   ΔY = −87 m   ΔZ = −210 m
 *     Step C: ECEF → Clarke 1880 IGN geographic  (iterative Bowring)
 *     Step D: Transverse Mercator on Clarke 1880 IGN
 *             a = 6 378 249.145 m   f = 1/293.465
 *             same k₀ / FE / FN / zone logic as WGS84 UTM
 *
 * [5] DD → Lambert Voirol Ancien — Algeria Nord
 *     Ellipsoid: Clarke 1880 IGN  (after NS59 Helmert shift)
 *     Projection: Lambert Conformal Conic 2SP  (Snyder p.107)
 *       φ₁ = 36°   φ₂ = 38°   (standard parallels)
 *       φ₀ = 36°               (origin latitude)
 *       λ₀ = 2°42′E = 2.7°E   (Voirol meridian)
 *       FE = 500 135.17 m    FN = 300 090.03 m
 *     m(φ)  = cosφ / √(1−e²sin²φ)
 *     t(φ)  = tan(π/4−φ/2) / [(1−e sinφ)/(1+e sinφ)]^(e/2)
 *     n     = (ln m₁−ln m₂)/(ln t₁−ln t₂)
 *     F     = m₁/(n·t₁ⁿ)
 *     ρ(φ)  = a·F·tⁿ     ρ₀ = a·F·t₀ⁿ
 *     θ     = n·(λ−λ₀)
 *     E     = FE + ρ sinθ        N = FN + ρ₀ − ρ cosθ
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════
   ELLIPSOID CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */

const GEO_ELLIPSOIDS = {
    WGS84:          { a: 6378137.0,     f: 1 / 298.257223563 },
    CLARKE_1880_IGN: { a: 6378249.145,  f: 1 / 293.465       }
};

/* ═══════════════════════════════════════════════════════════════════
   FORMULA [1] & [2] — DMS ↔ DECIMAL DEGREES
   ═══════════════════════════════════════════════════════════════════ */

/**
 * DMS → Decimal Degrees
 * @param {number} deg  Absolute degrees
 * @param {number} min  Minutes (0–59)
 * @param {number} sec  Seconds (0–59.9…)
 * @param {string} dir  'N' | 'S' | 'E' | 'W'
 * @returns {number}
 */
function DMSToDecimal(deg, min, sec, dir) {
    const dd = Math.abs(deg) + min / 60.0 + sec / 3600.0;
    return (dir === 'S' || dir === 'W') ? -dd : dd;
}

/**
 * Decimal Degrees → DMS components
 * @param {number} dd
 * @returns {{ degrees:number, minutes:number, seconds:number }}
 */
function decimalToDMS(dd) {
    const abs     = Math.abs(dd);
    const degrees = Math.floor(abs);
    const minFull = (abs - degrees) * 60;
    const minutes = Math.floor(minFull);
    const seconds = (minFull - minutes) * 60;
    return { degrees, minutes, seconds };
}

/* ═══════════════════════════════════════════════════════════════════
   ECEF HELPERS  (shared by formulas [4] and [5])
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Geographic (radians) → ECEF Cartesian
 * @param {number} latRad
 * @param {number} lonRad
 * @param {{ a:number, f:number }} ell
 * @returns {{ X:number, Y:number, Z:number }}
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
 * ECEF Cartesian → Geographic (radians) — iterative Bowring
 * @param {number} X
 * @param {number} Y
 * @param {number} Z
 * @param {{ a:number, f:number }} ell
 * @returns {{ latRad:number, lonRad:number }}
 */
function cartesianToGeographic(X, Y, Z, ell) {
    const { a, f } = ell;
    const e2 = 2 * f - f * f;
    const p  = Math.sqrt(X * X + Y * Y);
    let   φ  = Math.atan2(Z, p * (1 - e2));    // seed
    for (let i = 0; i < 10; i++) {
        const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
        φ = Math.atan2(Z + e2 * N * Math.sin(φ), p);
    }
    return { latRad: φ, lonRad: Math.atan2(Y, X) };
}

/* ═══════════════════════════════════════════════════════════════════
   FORMULA [3] — DD → UTM  (generic ellipsoid, Snyder TM series)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Convert decimal lat/lon to UTM on any ellipsoid.
 * @param {number} latDD
 * @param {number} lonDD
 * @param {{ a:number, f:number }} ell
 * @returns {{ zone:number, hemisphere:string, easting:number, northing:number }}
 */
function latLonToUTM_ellipsoid(latDD, lonDD, ell) {
    const { a, f } = ell;
    const toRad = Math.PI / 180;
    const φ = latDD * toRad;
    const λ = lonDD * toRad;

    const b   = a * (1 - f);
    const e2  = (a * a - b * b) / (a * a);
    const ep2 = e2 / (1 - e2);                     // e'²

    const zone = Math.floor((lonDD + 180) / 6) + 1;
    const λ0   = ((zone - 1) * 6 - 180 + 3) * toRad;
    const k0   = 0.9996;
    const FE   = 500000;
    const FN   = latDD < 0 ? 10000000 : 0;

    const N_  = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
    const T   = Math.tan(φ) ** 2;
    const C   = ep2 * Math.cos(φ) ** 2;
    const A   = Math.cos(φ) * (λ - λ0);

    const M = a * (
          (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256)   * φ
        - (3*e2/8  + 3*e2**2/32  + 45*e2**3/1024)  * Math.sin(2*φ)
        + (15*e2**2/256 + 45*e2**3/1024)            * Math.sin(4*φ)
        - (35*e2**3/3072)                            * Math.sin(6*φ)
    );

    const easting = FE + k0 * N_ * (
          A
        + (1 - T + C)                             * A**3 / 6
        + (5 - 18*T + T**2 + 72*C - 58*ep2)       * A**5 / 120
    );
    const northing = FN + k0 * (
        M + N_ * Math.tan(φ) * (
              A**2 / 2
            + (5 - T + 9*C + 4*C**2)               * A**4 / 24
            + (61 - 58*T + T**2 + 600*C - 330*ep2) * A**6 / 720
        )
    );

    return { zone, hemisphere: latDD >= 0 ? 'N' : 'S', easting, northing };
}

/** WGS84 convenience wrapper */
function latLonToUTM(latDD, lonDD) {
    return latLonToUTM_ellipsoid(latDD, lonDD, GEO_ELLIPSOIDS.WGS84);
}

/* ═══════════════════════════════════════════════════════════════════
   FORMULA [4] — DD → UTM NORD SAHARA 1959
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Convert WGS84 decimal degrees → UTM Nord Sahara 1959.
 *
 * Helmert 3-parameter shift  WGS84 → NS59 (IGN values):
 *   ΔX = +209 m   ΔY = −87 m   ΔZ = −210 m
 *
 * @param {number} latDD  WGS84 latitude
 * @param {number} lonDD  WGS84 longitude
 * @returns {{ zone:number, hemisphere:string, easting:number, northing:number,
 *             latNS:number, lonNS:number }}
 */
function latLonToUTM_NordSahara1959(latDD, lonDD) {
    const toRad = Math.PI / 180;

    // [A] WGS84 geographic → WGS84 ECEF
    const ecef = geographicToCartesian(latDD * toRad, lonDD * toRad, GEO_ELLIPSOIDS.WGS84);

    // [B] Helmert shift  WGS84 → NS59
    const X2 = ecef.X + 209;
    const Y2 = ecef.Y - 87;
    const Z2 = ecef.Z - 210;

    // [C] ECEF → Clarke 1880 IGN geographic
    const { latRad, lonRad } = cartesianToGeographic(X2, Y2, Z2, GEO_ELLIPSOIDS.CLARKE_1880_IGN);
    const latNS = latRad / toRad;
    const lonNS = lonRad / toRad;

    // [D] TM projection on Clarke 1880 IGN
    const utm = latLonToUTM_ellipsoid(latNS, lonNS, GEO_ELLIPSOIDS.CLARKE_1880_IGN);
    return { ...utm, latNS, lonNS };
}

/* ═══════════════════════════════════════════════════════════════════
   FORMULA [5] — DD → LAMBERT VOIROL ANCIEN  (Algeria Nord)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Convert WGS84 decimal degrees → Lambert Voirol Ancien (Algeria Nord).
 *
 * Applies NS59 Helmert shift first, then LCC 2SP on Clarke 1880 IGN.
 *
 * LCC parameters — Algeria Nord:
 *   φ₁ = 36°   φ₂ = 38°   φ₀ = 36°   λ₀ = 2°42′E
 *   FE = 500 135.17 m   FN = 300 090.03 m
 *
 * @param {number} latDD  WGS84 latitude
 * @param {number} lonDD  WGS84 longitude
 * @returns {{ easting:number, northing:number, zone:string }}
 */
function latLonToLambert_VoirolAncien(latDD, lonDD) {
    const toRad = Math.PI / 180;
    const ell   = GEO_ELLIPSOIDS.CLARKE_1880_IGN;
    const { a, f } = ell;
    const e2 = 2 * f - f * f;
    const e  = Math.sqrt(e2);

    // Shift WGS84 → NS59 geographic (reuse ECEF helpers)
    const ecef = geographicToCartesian(latDD * toRad, lonDD * toRad, GEO_ELLIPSOIDS.WGS84);
    const { latRad: φ, lonRad: λ } = cartesianToGeographic(
        ecef.X + 209, ecef.Y - 87, ecef.Z - 210, ell
    );

    // LCC 2SP parameters
    const φ1 = 36 * toRad,  φ2 = 38 * toRad;
    const φ0 = 36 * toRad,  λ0 = (2 + 42 / 60) * toRad;   // 2°42′E
    const FE = 500135.17,   FN = 300090.03;

    const m_ = (p) => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
    const t_ = (p) => Math.tan(Math.PI / 4 - p / 2)
        / Math.pow((1 - e * Math.sin(p)) / (1 + e * Math.sin(p)), e / 2);

    const m1 = m_(φ1), m2 = m_(φ2);
    const t1 = t_(φ1), t2 = t_(φ2), t0 = t_(φ0), ti = t_(φ);

    const n   = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
    const F   = m1 / (n * Math.pow(t1, n));
    const ρ0  = a * F * Math.pow(t0, n);
    const ρ   = a * F * Math.pow(ti, n);
    const θ   = n * (λ - λ0);

    return {
        easting : FE + ρ * Math.sin(θ),
        northing: FN + ρ0 - ρ * Math.cos(θ),
        zone    : 'Algeria Nord'
    };
}

/* ═══════════════════════════════════════════════════════════════════
   CLIPBOARD HELPER
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Copy text to clipboard with visual button feedback.
 * @param {string}      text        Text to copy
 * @param {HTMLElement} btnElement  Button that triggered the action
 */
function copyToClipboard(text, btnElement) {
    if (!text) return;

    const flash = (btn) => {
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i>';
        btn.classList.add('btn-success');
        setTimeout(() => {
            btn.innerHTML = original;
            btn.classList.remove('btn-success');
        }, 1500);
    };

    navigator.clipboard.writeText(text).then(() => {
        flash(btnElement);
    }).catch(err => {
        console.error('Clipboard API error:', err);
        // Fallback for older browsers
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            flash(btnElement);
        } catch (e) {
            alert('Could not copy to clipboard.');
        }
    });
}

/* ═══════════════════════════════════════════════════════════════════
   COPY HELPERS  — one per coordinate system
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Copy Decimal Degrees (DD) coordinates.
 * Reads: #decimalLatitude · #decimalLongitude
 */
function copyDecimal(btn) {
    const lat = document.getElementById('decimalLatitude').value;
    const lon = document.getElementById('decimalLongitude').value;
    if (!lat || !lon) { alert('No decimal coordinates to copy.'); return; }
    copyToClipboard(`Latitude: ${lat}\nLongitude: ${lon}`, btn);
}

/**
 * Copy DMS coordinates.
 * Reads: #latDegrees #latMinutes #latSeconds #northOrSouth
 *        #lonDegrees #lonMinutes #lonSeconds #westOrEast
 */
function copyDMS(btn) {
    const latDeg = document.getElementById('latDegrees').value;
    const latMin = document.getElementById('latMinutes').value;
    const latSec = document.getElementById('latSeconds').value;
    const latDir = document.getElementById('northOrSouth').value;
    const lonDeg = document.getElementById('lonDegrees').value;
    const lonMin = document.getElementById('lonMinutes').value;
    const lonSec = document.getElementById('lonSeconds').value;
    const lonDir = document.getElementById('westOrEast').value;

    if (!latDeg || !lonDeg) { alert('No DMS coordinates to copy.'); return; }

    // ° is the proper degree sign (U+00B0) — no Â° encoding artefact
    const text =
        `Latitude:  ${latDeg}° ${latMin}' ${latSec}" ${latDir}\n` +
        `Longitude: ${lonDeg}° ${lonMin}' ${lonSec}" ${lonDir}`;
    copyToClipboard(text, btn);
}

/**
 * Copy UTM WGS84 coordinates.
 * Reads: #utmZone · #utmHemi · #utmEasting · #utmNorthing
 */
function copyUTM(btn) {
    const zone  = document.getElementById('utmZone').value;
    const hemi  = document.getElementById('utmHemi').value;
    const east  = document.getElementById('utmEasting').value;
    const north = document.getElementById('utmNorthing').value;

    if (!zone || !east || !north) { alert('No UTM coordinates to copy.'); return; }

    copyToClipboard(
        `Zone: ${zone} ${hemi}\nEasting: ${east}\nNorthing: ${north}`,
        btn
    );
}

/**
 * Copy UTM Nord Sahara 1959 coordinates.
 * Reads: #ns59Zone · #ns59Hemi · #ns59Easting · #ns59Northing
 *
 * These fields should be populated by your converter calling
 * latLonToUTM_NordSahara1959(lat, lon) and writing the results.
 */
function copyNordSahara1959(btn) {
    const zone  = document.getElementById('ns59Zone').value;
    const hemi  = document.getElementById('ns59Hemi').value;
    const east  = document.getElementById('ns59Easting').value;
    const north = document.getElementById('ns59Northing').value;

    if (!zone || !east || !north) { alert('No Nord Sahara 1959 coordinates to copy.'); return; }

    copyToClipboard(
        `[UTM Nord Sahara 1959]\nZone: ${zone} ${hemi}\nEasting: ${east}\nNorthing: ${north}`,
        btn
    );
}

/**
 * Copy Lambert Voirol Ancien coordinates.
 * Reads: #lambertZone · #lambertEasting · #lambertNorthing
 *
 * These fields should be populated by your converter calling
 * latLonToLambert_VoirolAncien(lat, lon) and writing the results.
 */
function copyLambertVoirol(btn) {
    const zone  = document.getElementById('lambertZone').value;
    const east  = document.getElementById('lambertEasting').value;
    const north = document.getElementById('lambertNorthing').value;

    if (!east || !north) { alert('No Lambert Voirol coordinates to copy.'); return; }

    copyToClipboard(
        `[Lambert Voirol Ancien — ${zone}]\nEasting: ${east}\nNorthing: ${north}`,
        btn
    );
}

/* ═══════════════════════════════════════════════════════════════════
   CONVENIENCE — compute & populate all fields from DD input
   ═══════════════════════════════════════════════════════════════════
   Call this whenever the user enters or changes DD values.
   Expected HTML ids: decimalLatitude · decimalLongitude
   Output ids (UTM WGS84) : utmZone · utmHemi · utmEasting · utmNorthing
   Output ids (NS59 UTM)  : ns59Zone · ns59Hemi · ns59Easting · ns59Northing
   Output ids (Lambert)   : lambertZone · lambertEasting · lambertNorthing
   Output ids (DMS)       : latDegrees · latMinutes · latSeconds · northOrSouth
                            lonDegrees · lonMinutes · lonSeconds · westOrEast
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Populate all coordinate output fields from WGS84 decimal degrees.
 * @param {number} latDD
 * @param {number} lonDD
 * @param {number} [precision=3]
 */
function populateAllFromDD(latDD, lonDD, precision = 3) {
    if (isNaN(latDD) || isNaN(lonDD)) return;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };

    // ── DD ──────────────────────────────────────────────────────────
    set('decimalLatitude',  latDD.toFixed(precision));
    set('decimalLongitude', lonDD.toFixed(precision));

    // ── DMS ─────────────────────────────────────────────────────────
    const dmsLat = decimalToDMS(latDD);
    const dmsLon = decimalToDMS(lonDD);
    set('latDegrees',  dmsLat.degrees);
    set('latMinutes',  dmsLat.minutes);
    set('latSeconds',  dmsLat.seconds.toFixed(precision));
    set('northOrSouth', latDD >= 0 ? 'N' : 'S');
    set('lonDegrees',  dmsLon.degrees);
    set('lonMinutes',  dmsLon.minutes);
    set('lonSeconds',  dmsLon.seconds.toFixed(precision));
    set('westOrEast',  lonDD >= 0 ? 'E' : 'W');

    // ── UTM WGS84 ────────────────────────────────────────────────────
    try {
        const utm = latLonToUTM(latDD, lonDD);
        set('utmZone',     utm.zone);
        set('utmHemi',     utm.hemisphere);
        set('utmEasting',  utm.easting.toFixed(precision));
        set('utmNorthing', utm.northing.toFixed(precision));
    } catch (e) { console.warn('UTM WGS84 error:', e); }

    // ── UTM Nord Sahara 1959 ─────────────────────────────────────────
    try {
        const ns = latLonToUTM_NordSahara1959(latDD, lonDD);
        set('ns59Zone',     ns.zone);
        set('ns59Hemi',     ns.hemisphere);
        set('ns59Easting',  ns.easting.toFixed(precision));
        set('ns59Northing', ns.northing.toFixed(precision));
    } catch (e) { console.warn('NS59 error:', e); }

    // ── Lambert Voirol Ancien ────────────────────────────────────────
    try {
        const lv = latLonToLambert_VoirolAncien(latDD, lonDD);
        set('lambertZone',     lv.zone);
        set('lambertEasting',  lv.easting.toFixed(precision));
        set('lambertNorthing', lv.northing.toFixed(precision));
    } catch (e) { console.warn('Lambert Voirol error:', e); }
}
