/**
 * منطق محوّل الإحداثيات الجماعي
 * ─────────────────────────────────────────────────────────────────────────────
 * المدخلات المدعومة  : درجات عشرية DD · UTM WGS84 · DMS
 * المخرجات المحسوبة : DD · DMS · UTM WGS84 · UTM Nord Sahara 1959 · Lambert Voirol Ancien (الجزائر)
 *
 * يعتمد على         : PapaParse · SheetJS (XLSX) · Leaflet (للخريطة)
 * لا يحتاج لمكتبة جغرافية خارجية : جميع الحسابات ذاتية المحتوى — لا حاجة لـ webgis_utm_lat_lon.js
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * صيغ التحويل المستخدمة
 * ════════════════════════
 *
 * 1.  DMS → درجات عشرية (DD)
 *     DD = الدرجات + الدقائق/60 + الثواني/3600
 *     تُعكس الإشارة للجنوب (S) أو الغرب (W).
 *
 * 2.  DD → DMS
 *     الدرجات = trunc(|DD|)
 *     الدقائق = trunc((|DD| − الدرجات) × 60)
 *     الثواني = ((|DD| − الدرجات) × 60 − الدقائق) × 60
 *     يُضاف N/S أو E/W بحسب الإشارة.
 *
 * 3.  DD → UTM WGS84
 *     الإهليلج : WGS84  a = 6 378 137 م  f = 1/298.257 223 563
 *     الإسقاط: Transverse Mercator (سلسلة Bowring/Snyder)
 *       k₀ = 0.9996  FE = 500 000 م  FN = 0 (شمال) أو 10 000 000 (جنوب)
 *       المنطقة = floor((lon + 180)/6) + 1   λ₀ = (المنطقة−1)×6 − 180 + 3
 *     معادلات (Snyder ص.61):
 *       e² = 2f − f²    N = a/√(1−e²sin²φ)    T = tan²φ
 *       C = e'²cos²φ    A = cosφ·(λ−λ₀)
 *       M = القوس الزوالي (سلسلة في φ)
 *       E = FE + k₀·N·[A + (1−T+C)A³/6 + (5−18T+T²+72C−58e'²)A⁵/120]
 *       N = FN + k₀·{M + N·tanφ·[A²/2 + (5−T+9C+4C²)A⁴/24
 *                                       + (61−58T+T²+600C−330e'²)A⁶/720]}
 *
 * 4.  DD → UTM Nord Sahara 1959  (Clarke 1880 IGN)
 *     الخطوة أ – إزاحة هيلمرت ثلاثية المعاملات  WGS84 → Nord Sahara 1959
 *       WGS84 جغرافي → WGS84 ديكارتي (X,Y,Z)
 *       تطبيق الإزاحة: ΔX=+209 م  ΔY=−87 م  ΔZ=−210 م  (WGS84→NS59، IGN)
 *       ديكارتي → Clarke 1880 IGN جغرافي (Bowring التكراري)
 *     الخطوة ب – Transverse Mercator على Clarke 1880 IGN
 *       a = 6 378 249.145 م  f = 1/293.465
 *       نفس منطق k₀، FE، FN، والمنطقة كما في WGS84 UTM.
 *
 * 5.  DD → Lambert Voirol Ancien — الجزائر الشمالية
 *     الإهليلج : Clarke 1880 IGN  a = 6 378 249.145 م  f = 1/293.465
 *     الإسقاط: Lambert Conformal Conic 2SP (Snyder ص.107)
 *       خطا الاستواء القياسيان : φ₁ = 36°    φ₂ = 38°
 *       خط العرض المرجعي       : φ₀ = 36°
 *       الزوال المركزي         : λ₀ = 2°42'E  (زوال Voirol)
 *       الإزاحة الشرقية الزائفة : FE = 500 135.17 م
 *       الإزاحة الشمالية الزائفة: FN = 300 090.03 م
 *     المعادلات:
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
   ثوابت الإهليلج
   ═══════════════════════════════════════════════════════════════════ */

const ELLIPSOIDS = {
    WGS84: { a: 6378137.0,     f: 1 / 298.257223563 },
    CLARKE_1880_IGN: { a: 6378249.145, f: 1 / 293.465 }
};

/* ═══════════════════════════════════════════════════════════════════
   الصيغة 1 و 2 — DMS ↔ درجات عشرية
   ═══════════════════════════════════════════════════════════════════ */

/**
 * DMS → درجات عشرية
 * @param {number} deg  الدرجات (موجبة دائمًا)
 * @param {number} min  الدقائق
 * @param {number} sec  الثواني
 * @param {string} dir  'N'|'S'|'E'|'W'
 * @returns {number}
 */
function DMSToDecimal(deg, min, sec, dir) {
    let dd = Math.abs(deg) + min / 60.0 + sec / 3600.0;
    if (dir === 'S' || dir === 'W') dd = -dd;
    return dd;
}

/**
 * درجات عشرية → كائن DMS
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
   الصيغة 3 — DD → UTM (إهليلج عام)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * تحويل خط العرض/الطول العشري إلى UTM على أي إهليلج.
 * @param {number} latDD   درجات عشرية لخط العرض  (−90 … +90)
 * @param {number} lonDD   درجات عشرية لخط الطول (−180 … +180)
 * @param {object} ell     الإهليلج { a, f }
 * @returns {{ zone:number, hemisphere:string, easting:number, northing:number }}
 */
function latLonToUTM_ellipsoid(latDD, lonDD, ell) {
    const { a, f } = ell;
    const toRad = Math.PI / 180;
    const φ = latDD * toRad;
    const λ = lonDD * toRad;

    const b   = a * (1 - f);
    const e2  = (a * a - b * b) / (a * a);   // الانحراف المركزي الأول²
    const ep2 = e2 / (1 - e2);               // الانحراف المركزي الثاني²

    // منطقة UTM
    const zone = Math.floor((lonDD + 180) / 6) + 1;
    const λ0   = ((zone - 1) * 6 - 180 + 3) * toRad;   // الزوال المركزي
    const k0   = 0.9996;
    const FE   = 500000;
    const FN   = latDD < 0 ? 10000000 : 0;

    const N   = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
    const T   = Math.tan(φ) ** 2;
    const C   = ep2 * Math.cos(φ) ** 2;
    const A   = Math.cos(φ) * (λ - λ0);

    // القوس الزوالي M (معادلة Snyder 3-21)
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
 * UTM → خط العرض/الطول على إهليلج معيّن (TM عكسي، Snyder)
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

/* ─── أغلفة WGS84 للاستدعاءات الموجودة ─── */

function latLonToUTM(latDD, lonDD) {
    return latLonToUTM_ellipsoid(latDD, lonDD, ELLIPSOIDS.WGS84);
}

function UTMToLatLon(zone, hemisphere, easting, northing) {
    return UTMToLatLon_ellipsoid(zone, hemisphere, easting, northing, ELLIPSOIDS.WGS84);
}

/* ═══════════════════════════════════════════════════════════════════
   الصيغة 4 — DD → UTM Nord Sahara 1959  (Clarke 1880 IGN)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * WGS84 جغرافي → WGS84 ديكارتي ECEF
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
 * ديكارتي ECEF → جغرافي (Bowring التكراري، ~5 تكرارات)
 */
function cartesianToGeographic(X, Y, Z, ell) {
    const { a, f } = ell;
    const e2 = 2 * f - f * f;
    const p  = Math.sqrt(X * X + Y * Y);
    let   φ  = Math.atan2(Z, p * (1 - e2));          // التقدير الأولي
    for (let i = 0; i < 10; i++) {
        const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
        φ = Math.atan2(Z + e2 * N * Math.sin(φ), p);
    }
    const λ = Math.atan2(Y, X);
    return { latRad: φ, lonRad: λ };
}

/**
 * تحويل WGS84 DD → UTM Nord Sahara 1959
 *
 * إزاحة هيلمرت ثلاثية المعاملات  WGS84 → Nord Sahara 1959:
 *   ΔX = +209 م   ΔY = −87 م   ΔZ = −210 م
 * (قيم IGN المنشورة، اتفاقية الإشارة: تُضاف إلى WGS84 ECEF للحصول على NS59 ECEF)
 *
 * @param {number} latDD  خط عرض WGS84 بالدرجات العشرية
 * @param {number} lonDD  خط طول WGS84 بالدرجات العشرية
 * @returns {{ zone:number, hemisphere:string, easting:number, northing:number,
 *             latNS:number, lonNS:number }}
 */
function latLonToUTM_NordSahara1959(latDD, lonDD) {
    const toRad = Math.PI / 180;

    // الخطوة 1 – WGS84 جغرافي → WGS84 ديكارتي
    const wgs = geographicToCartesian(latDD * toRad, lonDD * toRad, ELLIPSOIDS.WGS84);

    // الخطوة 2 – إزاحة هيلمرت ثلاثية المعاملات  (WGS84 → Nord Sahara 1959)
    const ΔX = 209, ΔY = -87, ΔZ = -210;
    const X2 = wgs.X + ΔX;
    const Y2 = wgs.Y + ΔY;
    const Z2 = wgs.Z + ΔZ;

    // الخطوة 3 – ديكارتي → Clarke 1880 IGN جغرافي
    const { latRad, lonRad } = cartesianToGeographic(X2, Y2, Z2, ELLIPSOIDS.CLARKE_1880_IGN);
    const latNS = latRad / toRad;
    const lonNS = lonRad / toRad;

    // الخطوة 4 – Transverse Mercator على Clarke 1880 IGN
    const utm = latLonToUTM_ellipsoid(latNS, lonNS, ELLIPSOIDS.CLARKE_1880_IGN);
    return { ...utm, latNS, lonNS };
}

/* ═══════════════════════════════════════════════════════════════════
   الصيغة 5 — DD → Lambert Voirol Ancien  (الجزائر الشمالية)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * تحويل WGS84 DD → Lambert Voirol Ancien (المنطقة الشمالية للجزائر)
 *
 * تُحوّل هذه الدالة أولًا WGS84 → Nord Sahara 1959 (Clarke 1880 IGN)
 * عبر نفس إزاحة هيلمرت، ثم تُطبّق Lambert Conformal Conic 2SP.
 *
 * معاملات LCC — الجزائر الشمالية:
 *   φ₁ = 36°       φ₂ = 38°       (خطا الاستواء القياسيان)
 *   φ₀ = 36°                       (خط العرض المرجعي)
 *   λ₀ = 2°42'00"E = 2.7°E         (زوال Voirol)
 *   FE = 500 135.17 م
 *   FN = 300 090.03 م
 *
 * @param {number} latDD  خط عرض WGS84 بالدرجات العشرية
 * @param {number} lonDD  خط طول WGS84 بالدرجات العشرية
 * @returns {{ easting:number, northing:number, zone:string }}
 */
function latLonToLambert_VoirolAncien(latDD, lonDD) {
    const toRad = Math.PI / 180;
    const ell   = ELLIPSOIDS.CLARKE_1880_IGN;
    const { a, f } = ell;
    const e2 = 2 * f - f * f;
    const e  = Math.sqrt(e2);

    // ── إزاحة WGS84 → Nord Sahara 1959 جغرافي ──────────────────
    const wgs = geographicToCartesian(latDD * toRad, lonDD * toRad, ELLIPSOIDS.WGS84);
    const ΔX = 209, ΔY = -87, ΔZ = -210;
    const { latRad: φ, lonRad: λ } = cartesianToGeographic(
        wgs.X + ΔX, wgs.Y + ΔY, wgs.Z + ΔZ, ell
    );

    // ── معاملات LCC 2SP ──────────────────────────────────────────
    const φ1 = 36 * toRad;                // خط الاستواء القياسي 1
    const φ2 = 38 * toRad;                // خط الاستواء القياسي 2
    const φ0 = 36 * toRad;                // خط العرض المرجعي للشبكة
    const λ0 = (2 + 42 / 60) * toRad;    // زوال Voirol = 2°42'E
    const FE = 500135.17;
    const FN = 300090.03;

    // دوال مساعدة (معادلات Snyder 15-9 و 15-7)
    const m = (φ_) => Math.cos(φ_) / Math.sqrt(1 - e2 * Math.sin(φ_) ** 2);
    const t = (φ_) => Math.tan(Math.PI / 4 - φ_ / 2)
        / Math.pow((1 - e * Math.sin(φ_)) / (1 + e * Math.sin(φ_)), e / 2);

    const m1 = m(φ1), m2 = m(φ2);
    const t1 = t(φ1), t2 = t(φ2);
    const t0 = t(φ0), ti = t(φ);

    // ثابت المخروط ومعامل المقياس
    const n  = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
    const F  = m1 / (n * Math.pow(t1, n));

    // نصف أقطار الانحناء على امتداد الزوال
    const ρ0 = a * F * Math.pow(t0, n);
    const ρ  = a * F * Math.pow(ti, n);

    // زاوية التقارب
    const θ = n * (λ - λ0);

    const easting  = FE + ρ * Math.sin(θ);
    const northing = FN + ρ0 - ρ * Math.cos(θ);

    return { easting, northing, zone: 'Algeria Nord' };
}

/* ═══════════════════════════════════════════════════════════════════
   منشئ المخرجات الأساسي  — appendComputedColumns
   ═══════════════════════════════════════════════════════════════════ */

/**
 * بناءً على صف مصدر وخط عرض/طول WGS84 محسوب، يُضيف جميع الأعمدة المحسوبة.
 * يستبدل عمود NATO القديم بـ UTM Nord Sahara 1959 + Lambert Voirol.
 */
function appendComputedColumns(row, lat, lon, precision) {
    let result = { ...row };

    // ── تهيئة جميع أعمدة المخرجات (سلاسل فارغة = قيمة احتياطية آمنة) ──
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

        // 1 ── درجات عشرية ─────────────────────────────────────────
        result['Computed_Lat'] = lat.toFixed(precision);
        result['Computed_Lon'] = lon.toFixed(precision);

        // 2 ── DMS ─────────────────────────────────────────────────
        const latDMS = decimalToDMS(lat);
        const lonDMS = decimalToDMS(lon);
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';
        // ملاحظة: استخدام ° العادية (U+00B0) — بدون تشويه ترميز
        result['Computed_Lat_DMS'] = `${Math.abs(latDMS.degrees)}° ${latDMS.minutes}' ${latDMS.seconds.toFixed(precision)}" ${latDir}`;
        result['Computed_Lon_DMS'] = `${Math.abs(lonDMS.degrees)}° ${lonDMS.minutes}' ${lonDMS.seconds.toFixed(precision)}" ${lonDir}`;

        // 3 ── UTM WGS84 ───────────────────────────────────────────
        try {
            const utm = latLonToUTM(lat, lon);
            if (utm) {
                result['Computed_UTM_Zone']    = utm.zone;
                result['Computed_UTM_Hemi']    = utm.hemisphere;
                result['Computed_UTM_Easting'] = utm.easting.toFixed(precision);
                result['Computed_UTM_Northing']= utm.northing.toFixed(precision);
                result['Computed_UTM_String']  = `${utm.zone}${utm.hemisphere} E:${utm.easting.toFixed(precision)} N:${utm.northing.toFixed(precision)}`;
            }
        } catch (e) { console.warn('خطأ UTM WGS84', e); }

        // 4 ── UTM Nord Sahara 1959 ────────────────────────────────
        try {
            const ns = latLonToUTM_NordSahara1959(lat, lon);
            result['Computed_NS59_Zone']    = ns.zone;
            result['Computed_NS59_Hemi']    = ns.hemisphere;
            result['Computed_NS59_Easting'] = ns.easting.toFixed(precision);
            result['Computed_NS59_Northing']= ns.northing.toFixed(precision);
            result['Computed_NS59_String']  = `${ns.zone}${ns.hemisphere} E:${ns.easting.toFixed(precision)} N:${ns.northing.toFixed(precision)}`;
        } catch (e) { console.warn('خطأ Nord Sahara 1959', e); }

        // 5 ── Lambert Voirol Ancien ───────────────────────────────
        try {
            const lv = latLonToLambert_VoirolAncien(lat, lon);
            result['Computed_Lambert_Voirol_Zone']  = lv.zone;
            result['Computed_Lambert_Voirol_E']     = lv.easting.toFixed(precision);
            result['Computed_Lambert_Voirol_N']     = lv.northing.toFixed(precision);
            result['Computed_Lambert_Voirol_String']= `${lv.zone} E:${lv.easting.toFixed(precision)} N:${lv.northing.toFixed(precision)}`;
        } catch (e) { console.warn('خطأ Lambert Voirol', e); }
    }

    return result;
}

/* ═══════════════════════════════════════════════════════════════════
   الحالة
   ═══════════════════════════════════════════════════════════════════ */

let globalData    = [];
let globalHeaders = [];

/* ═══════════════════════════════════════════════════════════════════
   تهيئة DOM وإفلات الملفات
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
   معالجة الملفات
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
        alert('نوع الملف غير مدعوم. يرجى استخدام CSV أو TXT أو Excel.');
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

    // إزالة الصفوف الفارغة كليًا
    data = data.filter(row =>
        Object.values(row).some(v => v !== null && String(v).trim() !== '')
    );

    if (!data || data.length === 0) {
        alert('لم يُعثر على بيانات صالحة في الملف.');
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
   محدِّدات الأعمدة وواجهة التعيين
   ═══════════════════════════════════════════════════════════════════ */

function populateColumnSelectors() {
    document.querySelectorAll('.column-select').forEach(select => {
        select.innerHTML = '';

        const def = document.createElement('option');
        def.value = '';
        def.textContent = '-- اختر عمودًا --';
        select.appendChild(def);

        if (select.dataset.allowConstant === 'true') {
            const c = document.createElement('option');
            c.value       = 'CONSTANT_VALUE';
            c.textContent = '[ استخدام قيمة ثابتة ]';
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
 * عرض لوحة التعيين الصحيحة لنوع التحويل المختار.
 * تم استبدال نوع التحويل 'nato' بـ 'utm_ns59' (إدخال Nord Sahara 1959).
 * تشمل جميع المخرجات دائمًا: UTM WGS84 + UTM NS59 + Lambert Voirol.
 */
function updateMappingUI() {
    const type = document.getElementById('conversionType').value;
    document.querySelectorAll('.mapping-grid').forEach(el => el.style.display = 'none');

    const map = {
        decimal  : 'mapping-decimal',
        utm      : 'mapping-utm',
        dms      : 'mapping-dms',
        utm_ns59 : 'mapping-utm-ns59'     // ← يستبدل لوحة 'nato' القديمة
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
   جدول المعاينة
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
   موزِّع التحويل
   ═══════════════════════════════════════════════════════════════════ */

function convertData() {
    const type       = document.getElementById('conversionType').value;
    const processBtn = document.getElementById('processBtn');
    processBtn.disabled    = true;
    processBtn.textContent = 'جارٍ المعالجة…';

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
            alert('حدث خطأ أثناء التحويل. يرجى التحقق من المدخلات والوحدة الطرفية.');
        } finally {
            processBtn.disabled    = false;
            processBtn.textContent = 'تحويل الكل';
        }
    }, 100);
}

/* ═══════════════════════════════════════════════════════════════════
   معالجات المدخلات
   ═══════════════════════════════════════════════════════════════════ */

function processDecimalInput() {
    const latCol   = document.getElementById('colLat').value;
    const lonCol   = document.getElementById('colLon').value;
    const precision = parseInt(document.getElementById('decimalPrecision').value) || 3;

    if (!latCol || !lonCol) {
        alert('يرجى تحديد عمودَي خط العرض وخط الطول.'); return [];
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
        alert('يرجى تعيين جميع أعمدة UTM أو توفير قيم ثابتة.'); return [];
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
        alert('يرجى تعيين جميع أعمدة DMS.'); return [];
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
 * معالجة المدخلات الموجودة بالفعل في UTM Nord Sahara 1959 (Clarke 1880 IGN).
 * تُحوّل NS59 UTM → NS59 جغرافي → WGS84 جغرافي، ثم تُضيف جميع الأعمدة.
 */
function processUTM_NS59Input() {
    const zoneSelect = document.getElementById('colNS59Zone');
    const hemiSelect = document.getElementById('colNS59Hemi');
    const eastCol    = document.getElementById('colNS59East').value;
    const northCol   = document.getElementById('colNS59North').value;
    const precision  = parseInt(document.getElementById('decimalPrecision').value) || 3;

    if (!zoneSelect || !zoneSelect.value || !hemiSelect || !hemiSelect.value || !eastCol || !northCol) {
        alert('يرجى تعيين جميع أعمدة Nord Sahara 1959 UTM.'); return [];
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

        // NS59 UTM → Clarke 1880 جغرافي
        const ll_cl = UTMToLatLon_ellipsoid(zone, hemi, easting, northing, ELLIPSOIDS.CLARKE_1880_IGN);
        if (!ll_cl) return appendComputedColumns(row, NaN, NaN, precision);

        // Clarke 1880 جغرافي → ديكارتي
        const cart = geographicToCartesian(ll_cl.latitude * toRad, ll_cl.longitude * toRad, ELLIPSOIDS.CLARKE_1880_IGN);

        // إزاحة هيلمرت العكسية  NS59 → WGS84  (ΔX,ΔY,ΔZ معكوسة)
        const X2 = cart.X - 209;
        const Y2 = cart.Y + 87;
        const Z2 = cart.Z + 210;

        // ديكارتي → WGS84 جغرافي
        const ll_wgs = cartesianToGeographic(X2, Y2, Z2, ELLIPSOIDS.WGS84);
        return appendComputedColumns(row, ll_wgs.latRad / toRad, ll_wgs.lonRad / toRad, precision);
    });
}

/* ═══════════════════════════════════════════════════════════════════
   معالج اللصق
   ═══════════════════════════════════════════════════════════════════ */

function handlePasteData() {
    const rawText   = document.getElementById('pasteArea').value;
    const hasHeaders= document.getElementById('hasHeaders').checked;

    if (!rawText.trim()) { alert('يرجى لصق بعض البيانات أولًا.'); return; }

    Papa.parse(rawText, {
        complete: results => {
            let data = results.data;
            if (!hasHeaders && data.length > 0 && Array.isArray(data[0])) {
                const numCols = data[0].length;
                const headers = Array.from({ length: numCols }, (_, i) => `عمود ${i + 1}`);
                data = data.map(row => {
                    const obj = {};
                    row.forEach((v, i) => { obj[headers[i]] = v; });
                    return obj;
                });
            }
            processParsedData(data, 'نص ملصوق');
        },
        header         : hasHeaders,
        skipEmptyLines : true,
        dynamicTyping  : true
    });
}

/* ═══════════════════════════════════════════════════════════════════
   جدول النتائج
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
   خريطة Leaflet
   ═══════════════════════════════════════════════════════════════════ */

let bulkMapInstance = null;
let markersLayer    = null;

function updateMap(data) {
    if (!document.getElementById('bulkMap')) return;

    if (!bulkMapInstance) {
        bulkMapInstance = L.map('bulkMap').setView([28, 3], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© مساهمو OpenStreetMap'
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
                <b>نقطة ${++validCount}</b><br>
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
   التصدير
   ═══════════════════════════════════════════════════════════════════ */

function exportResults(format) {
    if (format === 'csv') {
        if (typeof Papa === 'undefined') { alert('لم يتم تحميل PapaParse.'); return; }
        downloadFile(Papa.unparse(currentResults), 'converted_coordinates.csv', 'text/csv');

    } else if (format === 'excel') {
        if (typeof XLSX === 'undefined') { alert('لم يتم تحميل SheetJS.'); return; }
        const ws = XLSX.utils.json_to_sheet(currentResults);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'الإحداثيات');
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
    <n>إحداثيات مصدَّرة — ABConsultingDZ</n>
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
        const name    = row[nameCol] || `نقطة ${idx + 1}`;

        let desc = '<table border="1" cellpadding="2" cellspacing="0">';
        for (const [k, v] of Object.entries(row))
            desc += `<tr><td><b>${k}</b></td><td>${v}</td></tr>`;
        desc += '</table>';

        kml += `
    <Placemark>
      <n>${name}</n>
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
        console.error('فشل التنزيل:', e);
        alert('خطأ أثناء تنزيل الملف. تحقق من الوحدة الطرفية للاطلاع على التفاصيل.');
    }
}
