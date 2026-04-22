/**
 * utils_universal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * مكتبة أدوات لتحويل الإحداثيات الجغرافية ومساعدات الحافظة.
 *
 * أنظمة الإحداثيات المدعومة:
 *   • الدرجات العشرية (DD)
 *   • الدرجات والدقائق والثواني (DMS)
 *   • UTM WGS84
 *   • UTM Nord Sahara 1959  (كلارك 1880 IGN — الجزائر)
 *   • Lambert Voirol Ancien (كلارك 1880 IGN — منطقة شمال الجزائر)
 *
 * لا توجد تبعيات خارجية — جميع العمليات الحسابية مدمجة.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * صيغ التحويل
 * ════════════════════
 *
 * [1] DMS → الدرجات العشرية
 *     DD = |الدرجات| + الدقائق/60 + الثواني/3600
 *     تُنفى القيمة للجنوب أو الغرب.
 *
 * [2] الدرجات العشرية → DMS
 *     D = trunc(|DD|)
 *     M = trunc((|DD|−D) × 60)
 *     S = ((|DD|−D) × 60 − M) × 60
 *
 * [3] DD → UTM WGS84  (إسقاط ميركاتور المستعرض، سنايدر 1987 ص.61)
 *     الإهليلجي: a = 6 378 137 م   f = 1/298.257 223 563
 *     k₀ = 0.9996   FE = 500 000 م   FN = 0 (شمال) / 10 000 000 (جنوب)
 *     المنطقة = floor((lon+180)/6)+1   λ₀ = (المنطقة−1)×6 − 180 + 3
 *     e² = 2f−f²   e'² = e²/(1−e²)
 *     N(φ) = a/√(1−e²sin²φ)         T = tan²φ    C = e'²cos²φ
 *     A = cosφ·(λ−λ₀)               M = متسلسلة القوس الزوالي
 *     E = FE + k₀N[A+(1−T+C)A³/6+(5−18T+T²+72C−58e'²)A⁵/120]
 *     N = FN + k₀{M+Ntanφ[A²/2+(5−T+9C+4C²)A⁴/24
 *                         +(61−58T+T²+600C−330e'²)A⁶/720]}
 *
 * [4] DD → UTM Nord Sahara 1959  (IGN — كلارك 1880)
 *     الخطوة أ: الإحداثيات الجغرافية WGS84 → إحداثيات كارتيزية ECEF
 *     الخطوة ب: إزاحة هيلمرت بثلاثة معاملات  WGS84 → NS59
 *             ΔX = +209 م   ΔY = −87 م   ΔZ = −210 م
 *     الخطوة ج: ECEF → إحداثيات جغرافية كلارك 1880 IGN  (بولينج التكراري)
 *     الخطوة د: إسقاط ميركاتور المستعرض على كلارك 1880 IGN
 *             a = 6 378 249.145 م   f = 1/293.465
 *             نفس منطق k₀ / FE / FN / المنطقة كـ WGS84 UTM
 *
 * [5] DD → Lambert Voirol Ancien — شمال الجزائر
 *     الإهليلجي: كلارك 1880 IGN  (بعد إزاحة هيلمرت NS59)
 *     الإسقاط: مخروط لامبير المطابق ثنائي المعيار 2SP  (سنايدر ص.107)
 *       φ₁ = 36°   φ₂ = 38°   (الخطوط المعيارية)
 *       φ₀ = 36°               (خط العرض الأصلي)
 *       λ₀ = 2°42′ شرقاً = 2.7° شرقاً   (خط فوارو)
 *       FE = 500 135.17 م    FN = 300 090.03 م
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
   ثوابت الإهليلج
   ═══════════════════════════════════════════════════════════════════ */

const GEO_ELLIPSOIDS = {
    WGS84:          { a: 6378137.0,     f: 1 / 298.257223563 },
    CLARKE_1880_IGN: { a: 6378249.145,  f: 1 / 293.465       }
};

/* ═══════════════════════════════════════════════════════════════════
   الصيغة [1] و [2] — DMS ↔ الدرجات العشرية
   ═══════════════════════════════════════════════════════════════════ */

/**
 * DMS → الدرجات العشرية
 * @param {number} deg  الدرجات المطلقة
 * @param {number} min  الدقائق (0–59)
 * @param {number} sec  الثواني (0–59.9…)
 * @param {string} dir  'N' | 'S' | 'E' | 'W'
 * @returns {number}
 */
function DMSToDecimal(deg, min, sec, dir) {
    const dd = Math.abs(deg) + min / 60.0 + sec / 3600.0;
    return (dir === 'S' || dir === 'W') ? -dd : dd;
}

/**
 * الدرجات العشرية → مكونات DMS
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
   مساعدات ECEF  (مشتركة بين الصيغتين [4] و [5])
   ═══════════════════════════════════════════════════════════════════ */

/**
 * إحداثيات جغرافية (راديان) → إحداثيات كارتيزية ECEF
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
 * إحداثيات كارتيزية ECEF → إحداثيات جغرافية (راديان) — بولينج التكراري
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
    let   φ  = Math.atan2(Z, p * (1 - e2));    // قيمة ابتدائية
    for (let i = 0; i < 10; i++) {
        const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
        φ = Math.atan2(Z + e2 * N * Math.sin(φ), p);
    }
    return { latRad: φ, lonRad: Math.atan2(Y, X) };
}

/* ═══════════════════════════════════════════════════════════════════
   الصيغة [3] — DD → UTM  (إهليلج عام، متسلسلة سنايدر TM)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * تحويل خط العرض/الطول العشري إلى UTM على أي إهليلج.
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

/** غلاف WGS84 للاستخدام المباشر */
function latLonToUTM(latDD, lonDD) {
    return latLonToUTM_ellipsoid(latDD, lonDD, GEO_ELLIPSOIDS.WGS84);
}

/* ═══════════════════════════════════════════════════════════════════
   الصيغة [4] — DD → UTM Nord Sahara 1959
   ═══════════════════════════════════════════════════════════════════ */

/**
 * تحويل الدرجات العشرية WGS84 → UTM Nord Sahara 1959.
 *
 * إزاحة هيلمرت بثلاثة معاملات  WGS84 → NS59 (قيم IGN):
 *   ΔX = +209 م   ΔY = −87 م   ΔZ = −210 م
 *
 * @param {number} latDD  خط العرض WGS84
 * @param {number} lonDD  خط الطول WGS84
 * @returns {{ zone:number, hemisphere:string, easting:number, northing:number,
 *             latNS:number, lonNS:number }}
 */
function latLonToUTM_NordSahara1959(latDD, lonDD) {
    const toRad = Math.PI / 180;

    // [أ] الإحداثيات الجغرافية WGS84 → ECEF كارتيزي WGS84
    const ecef = geographicToCartesian(latDD * toRad, lonDD * toRad, GEO_ELLIPSOIDS.WGS84);

    // [ب] إزاحة هيلمرت  WGS84 → NS59
    const X2 = ecef.X + 209;
    const Y2 = ecef.Y - 87;
    const Z2 = ecef.Z - 210;

    // [ج] ECEF → إحداثيات جغرافية كلارك 1880 IGN
    const { latRad, lonRad } = cartesianToGeographic(X2, Y2, Z2, GEO_ELLIPSOIDS.CLARKE_1880_IGN);
    const latNS = latRad / toRad;
    const lonNS = lonRad / toRad;

    // [د] إسقاط TM على كلارك 1880 IGN
    const utm = latLonToUTM_ellipsoid(latNS, lonNS, GEO_ELLIPSOIDS.CLARKE_1880_IGN);
    return { ...utm, latNS, lonNS };
}

/* ═══════════════════════════════════════════════════════════════════
   الصيغة [5] — DD → Lambert Voirol Ancien  (شمال الجزائر)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * تحويل الدرجات العشرية WGS84 → Lambert Voirol Ancien (شمال الجزائر).
 *
 * يطبّق إزاحة هيلمرت NS59 أولاً، ثم LCC 2SP على كلارك 1880 IGN.
 *
 * معاملات LCC — شمال الجزائر:
 *   φ₁ = 36°   φ₂ = 38°   φ₀ = 36°   λ₀ = 2°42′ شرقاً
 *   FE = 500 135.17 م   FN = 300 090.03 م
 *
 * @param {number} latDD  خط العرض WGS84
 * @param {number} lonDD  خط الطول WGS84
 * @returns {{ easting:number, northing:number, zone:string }}
 */
function latLonToLambert_VoirolAncien(latDD, lonDD) {
    const toRad = Math.PI / 180;
    const ell   = GEO_ELLIPSOIDS.CLARKE_1880_IGN;
    const { a, f } = ell;
    const e2 = 2 * f - f * f;
    const e  = Math.sqrt(e2);

    // إزاحة WGS84 → NS59 جغرافياً (إعادة استخدام مساعدات ECEF)
    const ecef = geographicToCartesian(latDD * toRad, lonDD * toRad, GEO_ELLIPSOIDS.WGS84);
    const { latRad: φ, lonRad: λ } = cartesianToGeographic(
        ecef.X + 209, ecef.Y - 87, ecef.Z - 210, ell
    );

    // معاملات LCC 2SP
    const φ1 = 36 * toRad,  φ2 = 38 * toRad;
    const φ0 = 36 * toRad,  λ0 = (2 + 42 / 60) * toRad;   // 2°42′ شرقاً
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
   مساعد الحافظة
   ═══════════════════════════════════════════════════════════════════ */

/**
 * نسخ نص إلى الحافظة مع تغذية راجعة بصرية للزر.
 * @param {string}      text        النص المراد نسخه
 * @param {HTMLElement} btnElement  الزر الذي أطلق الإجراء
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
        console.error('خطأ في Clipboard API:', err);
        // بديل للمتصفحات القديمة
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            flash(btnElement);
        } catch (e) {
            alert('تعذّر النسخ إلى الحافظة.');
        }
    });
}

/* ═══════════════════════════════════════════════════════════════════
   مساعدات النسخ  — واحدة لكل نظام إحداثيات
   ═══════════════════════════════════════════════════════════════════ */

/**
 * نسخ إحداثيات الدرجات العشرية (DD).
 * يقرأ: #decimalLatitude · #decimalLongitude
 */
function copyDecimal(btn) {
    const lat = document.getElementById('decimalLatitude').value;
    const lon = document.getElementById('decimalLongitude').value;
    if (!lat || !lon) { alert('لا توجد إحداثيات عشرية للنسخ.'); return; }
    copyToClipboard(`خط العرض: ${lat}\nخط الطول: ${lon}`, btn);
}

/**
 * نسخ إحداثيات DMS.
 * يقرأ: #latDegrees #latMinutes #latSeconds #northOrSouth
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

    if (!latDeg || !lonDeg) { alert('لا توجد إحداثيات DMS للنسخ.'); return; }

    // ° هو رمز الدرجة الصحيح (U+00B0)
    const text =
        `خط العرض:  ${latDeg}° ${latMin}' ${latSec}" ${latDir}\n` +
        `خط الطول: ${lonDeg}° ${lonMin}' ${lonSec}" ${lonDir}`;
    copyToClipboard(text, btn);
}

/**
 * نسخ إحداثيات UTM WGS84.
 * يقرأ: #utmZone · #utmHemi · #utmEasting · #utmNorthing
 */
function copyUTM(btn) {
    const zone  = document.getElementById('utmZone').value;
    const hemi  = document.getElementById('utmHemi').value;
    const east  = document.getElementById('utmEasting').value;
    const north = document.getElementById('utmNorthing').value;

    if (!zone || !east || !north) { alert('لا توجد إحداثيات UTM للنسخ.'); return; }

    copyToClipboard(
        `المنطقة: ${zone} ${hemi}\nالشرق: ${east}\nالشمال: ${north}`,
        btn
    );
}

/**
 * نسخ إحداثيات UTM Nord Sahara 1959.
 * يقرأ: #ns59Zone · #ns59Hemi · #ns59Easting · #ns59Northing
 *
 * يجب أن تُملأ هذه الحقول بواسطة المحوّل عبر استدعاء
 * latLonToUTM_NordSahara1959(lat, lon) وكتابة النتائج.
 */
function copyNordSahara1959(btn) {
    const zone  = document.getElementById('ns59Zone').value;
    const hemi  = document.getElementById('ns59Hemi').value;
    const east  = document.getElementById('ns59Easting').value;
    const north = document.getElementById('ns59Northing').value;

    if (!zone || !east || !north) { alert('لا توجد إحداثيات Nord Sahara 1959 للنسخ.'); return; }

    copyToClipboard(
        `[UTM Nord Sahara 1959]\nالمنطقة: ${zone} ${hemi}\nالشرق: ${east}\nالشمال: ${north}`,
        btn
    );
}

/**
 * نسخ إحداثيات Lambert Voirol Ancien.
 * يقرأ: #lambertZone · #lambertEasting · #lambertNorthing
 *
 * يجب أن تُملأ هذه الحقول بواسطة المحوّل عبر استدعاء
 * latLonToLambert_VoirolAncien(lat, lon) وكتابة النتائج.
 */
function copyLambertVoirol(btn) {
    const zone  = document.getElementById('lambertZone').value;
    const east  = document.getElementById('lambertEasting').value;
    const north = document.getElementById('lambertNorthing').value;

    if (!east || !north) { alert('لا توجد إحداثيات Lambert Voirol للنسخ.'); return; }

    copyToClipboard(
        `[Lambert Voirol Ancien — ${zone}]\nالشرق: ${east}\nالشمال: ${north}`,
        btn
    );
}

/* ═══════════════════════════════════════════════════════════════════
   أداة مساعدة — حساب وملء جميع الحقول من إدخال DD
   ═══════════════════════════════════════════════════════════════════
   استدعِ هذه الدالة كلما أدخل المستخدم قيم DD أو غيّرها.
   معرّفات HTML المتوقعة: decimalLatitude · decimalLongitude
   معرّفات الإخراج (UTM WGS84)  : utmZone · utmHemi · utmEasting · utmNorthing
   معرّفات الإخراج (NS59 UTM)   : ns59Zone · ns59Hemi · ns59Easting · ns59Northing
   معرّفات الإخراج (Lambert)    : lambertZone · lambertEasting · lambertNorthing
   معرّفات الإخراج (DMS)        : latDegrees · latMinutes · latSeconds · northOrSouth
                                   lonDegrees · lonMinutes · lonSeconds · westOrEast
   ═══════════════════════════════════════════════════════════════════ */

/**
 * ملء جميع حقول الإخراج من الدرجات العشرية WGS84.
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
    } catch (e) { console.warn('خطأ UTM WGS84:', e); }

    // ── UTM Nord Sahara 1959 ─────────────────────────────────────────
    try {
        const ns = latLonToUTM_NordSahara1959(latDD, lonDD);
        set('ns59Zone',     ns.zone);
        set('ns59Hemi',     ns.hemisphere);
        set('ns59Easting',  ns.easting.toFixed(precision));
        set('ns59Northing', ns.northing.toFixed(precision));
    } catch (e) { console.warn('خطأ NS59:', e); }

    // ── Lambert Voirol Ancien ────────────────────────────────────────
    try {
        const lv = latLonToLambert_VoirolAncien(latDD, lonDD);
        set('lambertZone',     lv.zone);
        set('lambertEasting',  lv.easting.toFixed(precision));
        set('lambertNorthing', lv.northing.toFixed(precision));
    } catch (e) { console.warn('خطأ Lambert Voirol:', e); }
}
