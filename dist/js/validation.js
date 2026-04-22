/**
 * Coordinate Input Validation
 * Implements constraints to prevent out-of-range values
 */

// Configuration of constraints for each field type
const fieldConstraints = {
    // Decimal coordinates
    "decimalLatitude": { min: -90, max: 90, message: "Latitude must be between -90Â° and 90Â°" },
    "decimalLongitude": { min: -180, max: 180, message: "Longitude must be between -180Â° and 180Â°" },

    // DMS fields (Degrees, Minutes, Seconds)
    "latDegrees": { min: 0, max: 90, message: "Latitude degrees must be between 0 and 90" },
    "lonDegrees": { min: 0, max: 180, message: "Longitude degrees must be between 0 and 180" },
    "latMinutes": { min: 0, max: 59, message: "Minutes must be between 0 and 59" },
    "lonMinutes": { min: 0, max: 59, message: "Minutes must be between 0 and 59" },
    "latSeconds": { min: 0, max: 59.999, message: "Seconds must be between 0 and 59.999" },
    "lonSeconds": { min: 0, max: 59.999, message: "Seconds must be between 0 and 59.999" },

    // UTM fields
    "utmZone": { min: 1, max: 60, message: "UTM zone must be between 1 and 60" },
    "utmEasting": { min: 100000, max: 999999, message: "Easting (X) must be between 100,000 and 999,999 meters" },
    "utmNorthing": { min: 0, max: 10000000, message: "Northing (Y) must be between 0 and 10,000,000 meters" },

    // NATO fields
    "natoLonZone": { min: 1, max: 60, message: "Longitude zone must be between 1 and 60" },
    "natoEasting": { min: 0, max: 99999, message: "NATO easting must be between 0 and 99,999 meters" },
    "natoNorthing": { min: 0, max: 99999, message: "NATO northing must be between 0 and 99,999 meters" }
};

// Function to validate a specific field
function validateField(fieldId, value) {
    const constraints = fieldConstraints[fieldId];
    if (!constraints) return true; // If no constraints defined, it's valid

    const numValue = parseFloat(value);
    if (isNaN(numValue)) return false; // Not a valid number

    return (numValue >= constraints.min && numValue <= constraints.max);
}

// Function to display error message and restore previous value
function showFieldError(field, message) {
    // Save original cursor position
    const selectionStart = field.selectionStart;
    const selectionEnd = field.selectionEnd;

    // Show alert
    alert(message);

    // Restore previous value if exists
    if (field.dataset.lastValidValue) {
        field.value = field.dataset.lastValidValue;
    } else {
        field.value = ""; // If no previous value, clear it
    }

    // Restore cursor position (only for text inputs)
    if (field.type === 'text' || field.type === 'search' || field.type === 'password' || field.type === 'tel' || field.type === 'url') {
        try {
            field.setSelectionRange(selectionStart, selectionEnd);
        } catch (e) {
            console.warn("Could not set selection range", e);
        }
    }

    // Focus the field for correction
    field.focus();
}

// Set up validation for all numeric fields
function setupFieldValidation() {
    // Iterate over each defined constraint
    Object.keys(fieldConstraints).forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field) return; // Skip if field doesn't exist

        // Store initial valid value
        if (field.value && validateField(fieldId, field.value)) {
            field.dataset.lastValidValue = field.value;
        }

        // Validate on blur
        field.addEventListener('blur', function () {
            const value = this.value.trim();
            if (value === "") return; // Allow empty values

            if (!validateField(fieldId, value)) {
                showFieldError(this, fieldConstraints[fieldId].message);
            } else {
                // Update last valid value
                this.dataset.lastValidValue = value;
            }
        });

        // Also check when Enter is pressed
        field.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                const value = this.value.trim();
                if (value === "") return; // Allow empty values

                if (!validateField(fieldId, value)) {
                    e.preventDefault();
                    showFieldError(this, fieldConstraints[fieldId].message);
                }
            }
        });
    });

    // Special validation for NATO text fields
    const natoLatZone = document.getElementById('natoLatZone');
    if (natoLatZone) {
        natoLatZone.addEventListener('blur', function () {
            const value = this.value.trim().toUpperCase();
            if (value === "") return;

            // Valid latitude zones are C-X
            const validZones = 'CDEFGHJKLMNPQRSTUVWX';
            if (value.length !== 1 || validZones.indexOf(value) === -1) {
                alert("Latitude zone must be a letter between C and X (excluding I and O)");
                this.value = this.dataset.lastValidValue || "";
                this.focus();
            } else {
                this.value = value; // Ensure it's uppercase
                this.dataset.lastValidValue = value;
            }
        });
    }

    const natoDigraph = document.getElementById('natoDigraph');
    if (natoDigraph) {
        natoDigraph.addEventListener('blur', function () {
            const value = this.value.trim().toUpperCase();
            if (value === "") return;

            // Digraph must be exactly 2 letters, without I, O, excluding some combinations
            const validChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
            if (value.length !== 2 ||
                validChars.indexOf(value[0]) === -1 ||
                validChars.indexOf(value[1]) === -1) {
                alert("Digraph must be exactly 2 letters (A-Z excluding I and O)");
                this.value = this.dataset.lastValidValue || "";
                this.focus();
            } else {
                this.value = value; // Ensure it's uppercase
                this.dataset.lastValidValue = value;
            }
        });
    }
}

// Additional validation before converting
function validateBeforeConvert(formType) {
    let isValid = true;
    let firstInvalidField = null;

    // Validate fields based on form type
    if (formType === 'decimal') {
        const fieldsToCheck = ['decimalLatitude', 'decimalLongitude'];
        fieldsToCheck.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (!field) return;

            const value = field.value.trim();
            if (value === "") {
                alert(`The ${fieldId === 'decimalLatitude' ? 'latitude' : 'longitude'} field cannot be empty`);
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
    } else if (formType === 'dms') {
        // Validation for DMS fields
        const fieldsToCheck = ['latDegrees', 'latMinutes', 'latSeconds', 'lonDegrees', 'lonMinutes', 'lonSeconds'];
        fieldsToCheck.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (!field) return;

            const value = field.value.trim();
            if (value === "") {
                alert(`All degrees, minutes, and seconds fields are required`);
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
    } else if (formType === 'utm') {
        // Validation for UTM fields
        const fieldsToCheck = ['utmZone', 'utmEasting', 'utmNorthing'];
        fieldsToCheck.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (!field) return;

            const value = field.value.trim();
            if (value === "") {
                alert(`All UTM fields are required`);
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
    } else if (formType === 'nato') {
        // Validation for NATO fields
        const fieldsToCheck = ['natoLonZone', 'natoEasting', 'natoNorthing'];
        let natoLatZone = document.getElementById('natoLatZone');
        let natoDigraph = document.getElementById('natoDigraph');

        // Check numeric fields
        fieldsToCheck.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (!field) return;

            const value = field.value.trim();
            if (value === "") {
                alert(`All NATO fields are required`);
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

        // Check latitude zone letter
        if (natoLatZone && isValid) {
            const value = natoLatZone.value.trim().toUpperCase();
            if (value === "") {
                alert("Latitude zone is required");
                natoLatZone.focus();
                isValid = false;
                firstInvalidField = firstInvalidField || natoLatZone;
            } else {
                const validZones = 'CDEFGHJKLMNPQRSTUVWX';
                if (value.length !== 1 || validZones.indexOf(value) === -1) {
                    alert("Latitude zone must be a letter between C and X (excluding I and O)");
                    natoLatZone.focus();
                    isValid = false;
                    firstInvalidField = firstInvalidField || natoLatZone;
                }
            }
        }

        // Check digraph
        if (natoDigraph && isValid) {
            const value = natoDigraph.value.trim().toUpperCase();
            if (value === "") {
                alert("Digraph is required");
                natoDigraph.focus();
                isValid = false;
                firstInvalidField = firstInvalidField || natoDigraph;
            } else {
                const validChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
                if (value.length !== 2 ||
                    validChars.indexOf(value[0]) === -1 ||
                    validChars.indexOf(value[1]) === -1) {
                    alert("Digraph must be exactly 2 letters (A-Z excluding I and O)");
                    natoDigraph.focus();
                    isValid = false;
                    firstInvalidField = firstInvalidField || natoDigraph;
                }
            }
        }
    }

    // If there's an invalid field, focus the first one
    if (firstInvalidField) {
        firstInvalidField.focus();
    }

    return isValid;
}

// Modify existing conversion functions to use validation
document.addEventListener('DOMContentLoaded', function () {
    // Set up validation for all fields
    setupFieldValidation();

    // Replace button event handlers with validated versions
    const decimalButton = document.querySelector('button[onclick="convertDecimal(); updateMap();"]');
    if (decimalButton) {
        decimalButton.onclick = function (e) {
            if (validateBeforeConvert('decimal')) {
                convertDecimal();
                updateMap();
            } else {
                e.preventDefault();
            }
        };
    }

    const dmsButton = document.querySelector('button[onclick="convertDMS(); updateMap();"]');
    if (dmsButton) {
        dmsButton.onclick = function (e) {
            if (validateBeforeConvert('dms')) {
                convertDMS();
                updateMap();
            } else {
                e.preventDefault();
            }
        };
    }

    const utmButton = document.querySelector('button[onclick="convertUTM(); updateMap();"]');
    if (utmButton) {
        utmButton.onclick = function (e) {
            if (validateBeforeConvert('utm')) {
                convertUTM();
                updateMap();
            } else {
                e.preventDefault();
            }
        };
    }

    const natoButton = document.querySelector('button[onclick="convertNATO(); updateMap();"]');
    if (natoButton) {
        natoButton.onclick = function (e) {
            if (validateBeforeConvert('nato')) {
                convertNATO();
                updateMap();
            } else {
                e.preventDefault();
            }
        };
    }
});