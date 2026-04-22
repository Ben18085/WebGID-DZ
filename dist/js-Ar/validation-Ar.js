/**
 * التحقق من صحة إدخال الإحداثيات
 * يُطبّق قيوداً لمنع القيم الخارجة عن النطاق المقبول
 *
 * الأنظمة المدعومة:
 *   • الدرجات العشرية (DD) — WGS84
 *   • الدرجات والدقائق والثواني (DMS)
 *   • UTM WGS84
 *   • UTM نورد صحراء 1959 (Clarke 1880 IGN — الجزائر)
 *   • لامبرت فوارول القديم — منطقة الجزائر الشمالية
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   إعداد القيود لكل نوع حقل
   ═══════════════════════════════════════════════════════════════ */

const fieldConstraints = {

    // ── الإحداثيات العشرية ──────────────────────────────────────
    "decimalLatitude":  {
        min: -90,  max: 90,
        message: "يجب أن يكون خط العرض بين −90° و +90°"
    },
    "decimalLongitude": {
        min: -180, max: 180,
        message: "يجب أن يكون خط الطول بين −180° و +180°"
    },

    // ── حقول الدرجات والدقائق والثواني (DMS) ───────────────────
    "latDegrees": {
        min: 0, max: 90,
        message: "درجات خط العرض يجب أن تكون بين 0 و 90"
    },
    "lonDegrees": {
        min: 0, max: 180,
        message: "درجات خط الطول يجب أن تكون بين 0 و 180"
    },
    "latMinutes": {
        min: 0, max: 59,
        message: "الدقائق يجب أن تكون بين 0 و 59"
    },
    "lonMinutes": {
        min: 0, max: 59,
        message: "الدقائق يجب أن تكون بين 0 و 59"
    },
    "latSeconds": {
        min: 0, max: 59.999,
        message: "الثواني يجب أن تكون بين 0 و 59.999"
    },
    "lonSeconds": {
        min: 0, max: 59.999,
        message: "الثواني يجب أن تكون بين 0 و 59.999"
    },

    // ── حقول UTM WGS84 ──────────────────────────────────────────
    "utmZone":     {
        min: 1,      max: 60,
        message: "منطقة UTM يجب أن تكون بين 1 و 60"
    },
    "utmEasting":  {
        min: 100000, max: 999999,
        message: "الاتجاه الشرقي (X) يجب أن يكون بين 100,000 و 999,999 متر"
    },
    "utmNorthing": {
        min: 0,      max: 10000000,
        message: "الاتجاه الشمالي (Y) يجب أن يكون بين 0 و 10,000,000 متر"
    },

    // ── حقول UTM نورد صحراء 1959 ────────────────────────────────
    "ns59Zone":     {
        min: 1,      max: 60,
        message: "منطقة UTM (نورد صحراء 1959) يجب أن تكون بين 1 و 60"
    },
    "ns59Easting":  {
        min: 100000, max: 999999,
        message: "الاتجاه الشرقي NS59 (X) يجب أن يكون بين 100,000 و 999,999 متر"
    },
    "ns59Northing": {
        min: 0,      max: 10000000,
        message: "الاتجاه الشمالي NS59 (Y) يجب أن يكون بين 0 و 10,000,000 متر"
    },

    // ── حقول لامبرت فوارول القديم ───────────────────────────────
    "lambertEasting":  {
        min: 0, max: 1000000,
        message: "الاتجاه الشرقي (لامبرت) يجب أن يكون بين 0 و 1,000,000 متر"
    },
    "lambertNorthing": {
        min: 0, max: 1200000,
        message: "الاتجاه الشمالي (لامبرت) يجب أن يكون بين 0 و 1,200,000 متر"
    }
};

/* ═══════════════════════════════════════════════════════════════
   التحقق من صحة حقل واحد
   ═══════════════════════════════════════════════════════════════ */

/**
 * التحقق من قيمة حقل محدد وفق القيود المعرّفة.
 * @param {string} fieldId
 * @param {string|number} value
 * @returns {boolean}
 */
function validateField(fieldId, value) {
    const constraints = fieldConstraints[fieldId];
    if (!constraints) return true;   // لا توجد قيود → صالح

    const numValue = parseFloat(value);
    if (isNaN(numValue)) return false;

    return numValue >= constraints.min && numValue <= constraints.max;
}

/* ═══════════════════════════════════════════════════════════════
   عرض رسالة الخطأ واستعادة القيمة السابقة
   ═══════════════════════════════════════════════════════════════ */

/**
 * يعرض تنبيهاً ويستعيد آخر قيمة صالحة للحقل.
 * @param {HTMLElement} field
 * @param {string}      message
 */
function showFieldError(field, message) {
    const selStart = field.selectionStart;
    const selEnd   = field.selectionEnd;

    alert(message);

    // استعادة القيمة السابقة الصالحة
    field.value = field.dataset.lastValidValue || "";

    // استعادة موضع المؤشر للحقول النصية
    const textTypes = ['text', 'search', 'password', 'tel', 'url'];
    if (textTypes.includes(field.type)) {
        try { field.setSelectionRange(selStart, selEnd); } catch (e) { /* تجاهل */ }
    }

    field.focus();
}

/* ═══════════════════════════════════════════════════════════════
   إعداد التحقق على جميع الحقول الرقمية
   ═══════════════════════════════════════════════════════════════ */

function setupFieldValidation() {

    // التحقق على كل حقل مُعرَّف في fieldConstraints
    Object.keys(fieldConstraints).forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field) return;

        // حفظ القيمة الأولية إن كانت صالحة
        if (field.value && validateField(fieldId, field.value)) {
            field.dataset.lastValidValue = field.value;
        }

        // التحقق عند مغادرة الحقل (blur)
        field.addEventListener('blur', function () {
            const value = this.value.trim();
            if (value === "") return;   // السماح بالحقول الفارغة

            if (!validateField(fieldId, value)) {
                showFieldError(this, fieldConstraints[fieldId].message);
            } else {
                this.dataset.lastValidValue = value;
            }
        });

        // التحقق عند الضغط على Enter
        field.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            const value = this.value.trim();
            if (value === "") return;

            if (!validateField(fieldId, value)) {
                e.preventDefault();
                showFieldError(this, fieldConstraints[fieldId].message);
            }
        });
    });
}

/* ═══════════════════════════════════════════════════════════════
   التحقق الشامل قبل التحويل
   ═══════════════════════════════════════════════════════════════ */

/**
 * يتحقق من جميع حقول النموذج المحدد قبل إجراء التحويل.
 * @param {'decimal'|'dms'|'utm'|'utm_ns59'|'lambert'} formType
 * @returns {boolean}  true إذا كانت جميع القيم صالحة
 */
function validateBeforeConvert(formType) {
    let isValid = true;
    let firstInvalidField = null;

    /**
     * دالة مساعدة: تتحقق من قائمة حقول وتُوقف عند أول خطأ.
     */
    function checkFields(fieldIds, emptyMessage) {
        fieldIds.forEach(fieldId => {
            if (!isValid) return;   // توقف عند أول خطأ
            const field = document.getElementById(fieldId);
            if (!field) return;

            const value = field.value.trim();
            if (value === "") {
                alert(emptyMessage);
                field.focus();
                isValid = false;
                firstInvalidField = firstInvalidField || field;
                return;
            }
            if (!validateField(fieldId, value)) {
                showFieldError(field, fieldConstraints[fieldId].message);
                isValid = false;
                firstInvalidField = firstInvalidField || field;
            }
        });
    }

    // ── الدرجات العشرية ─────────────────────────────────────────
    if (formType === 'decimal') {
        checkFields(
            ['decimalLatitude', 'decimalLongitude'],
            "حقل الإحداثيات العشرية لا يمكن أن يكون فارغاً"
        );
    }

    // ── الدرجات والدقائق والثواني ────────────────────────────────
    else if (formType === 'dms') {
        checkFields(
            ['latDegrees', 'latMinutes', 'latSeconds',
             'lonDegrees', 'lonMinutes', 'lonSeconds'],
            "جميع حقول الدرجات والدقائق والثواني مطلوبة"
        );
    }

    // ── UTM WGS84 ────────────────────────────────────────────────
    else if (formType === 'utm') {
        checkFields(
            ['utmZone', 'utmEasting', 'utmNorthing'],
            "جميع حقول UTM مطلوبة"
        );
    }

    // ── UTM نورد صحراء 1959 ──────────────────────────────────────
    else if (formType === 'utm_ns59') {
        checkFields(
            ['ns59Zone', 'ns59Easting', 'ns59Northing'],
            "جميع حقول UTM نورد صحراء 1959 مطلوبة"
        );

        // التحقق من نصف الكرة (N/S)
        if (isValid) {
            const hemiField = document.getElementById('ns59Hemi');
            if (hemiField) {
                const val = hemiField.value.trim().toUpperCase();
                if (!val || (val !== 'N' && val !== 'S')) {
                    alert("نصف الكرة يجب أن يكون شمال (N) أو جنوب (S)");
                    hemiField.focus();
                    isValid = false;
                    firstInvalidField = firstInvalidField || hemiField;
                }
            }
        }
    }

    // ── لامبرت فوارول القديم ────────────────────────────────────
    else if (formType === 'lambert') {
        checkFields(
            ['lambertEasting', 'lambertNorthing'],
            "جميع حقول لامبرت مطلوبة"
        );

        // التحقق من المنطقة
        if (isValid) {
            const zoneField = document.getElementById('lambertZone');
            if (zoneField) {
                const val = zoneField.value.trim();
                if (!val) {
                    alert("يرجى تحديد منطقة لامبرت (الجزائر الشمالية أو الجنوبية)");
                    zoneField.focus();
                    isValid = false;
                    firstInvalidField = firstInvalidField || zoneField;
                }
            }
        }
    }

    // تركيز أول حقل غير صالح
    if (firstInvalidField) firstInvalidField.focus();

    return isValid;
}

/* ═══════════════════════════════════════════════════════════════
   ربط التحقق بأزرار التحويل عند تحميل الصفحة
   ═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {

    // إعداد التحقق على جميع الحقول المُعرَّفة
    setupFieldValidation();

    /**
     * دالة مساعدة: تستبدل حدث onclick بنسخة مُحقَّقة.
     * @param {string} selector  محدد CSS للزر
     * @param {string} formType  نوع النموذج للتحقق
     * @param {Function} action  الدالة الأصلية للتحويل
     */
    function bindValidatedButton(selector, formType, action) {
        const btn = document.querySelector(selector);
        if (!btn) return;
        btn.onclick = function (e) {
            if (validateBeforeConvert(formType)) {
                action();
            } else {
                e.preventDefault();
            }
        };
    }

    // زر تحويل الدرجات العشرية
    bindValidatedButton(
        'button[onclick*="convertDecimal"]',
        'decimal',
        () => { convertDecimal(); updateMap(); }
    );

    // زر تحويل DMS
    bindValidatedButton(
        'button[onclick*="convertDMS"]',
        'dms',
        () => { convertDMS(); updateMap(); }
    );

    // زر تحويل UTM WGS84
    bindValidatedButton(
        'button[onclick*="convertUTM"]',
        'utm',
        () => { convertUTM(); updateMap(); }
    );

    // زر تحويل UTM نورد صحراء 1959  (يحل محل زر NATO القديم)
    bindValidatedButton(
        'button[onclick*="convertNS59"]',
        'utm_ns59',
        () => { convertNS59(); updateMap(); }
    );

    // زر تحويل لامبرت فوارول
    bindValidatedButton(
        'button[onclick*="convertLambert"]',
        'lambert',
        () => { convertLambert(); updateMap(); }
    );
});
