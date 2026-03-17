'use strict';

/**
 * Generic function to generate CSV with strict formatting to prevent column misalignment
 * @param {Array} data - Array of objects
 * @param {dw.io.Writer} writer - Response writer
 */
function generateGenericCSV(data, writer) {
    if (!data || data.length === 0) return;

    // 1. Define fields to exclude from the spreadsheet
    var excludeFields = ['productImage', 'mediaLinks', 'exchangeItemDetails', 'currencySymbol'];
    
    // 2. Extract and filter headers
    var allKeys = Object.keys(data[0]);
    var headers = allKeys.filter(function(key) {
        return excludeFields.indexOf(key) === -1;
    });

    // Write Header Row
    writer.write(headers.join(",") + "\n");

    // 3. Process each data row
    data.forEach(function (item) {
        var row = headers.map(function (header) {
            var value = (item[header] !== null && item[header] !== undefined) ? item[header] : "";
            
            // CLEANING LOGIC:
            // A. Convert to string and remove line breaks/carriage returns
            // B. REMOVE COMMAS: Replace all commas with a space to prevent column bleeding
            var cleanString = value.toString()
                .replace(/[\n\r]+/g, " ")
                .replace(/,/g, " ") 
                .trim();

            // C. NUMERIC PROTECTION: Prevent Scientific Notation (9.19E+11)
            // Forces Excel to treat long IDs as literal text strings
            var isNumericId = header.toLowerCase().indexOf('order') > -1 || 
                             header.toLowerCase().indexOf('sku') > -1 || 
                             header.toLowerCase().indexOf('phone') > -1 ||
                             header.toLowerCase().indexOf('account') > -1 ||
                             header.toLowerCase().indexOf('mobile') > -1;

            if (isNumericId) {
                return '="' + cleanString + '"';
            }

            // D. STRING PROTECTION: Wrap in double quotes and escape internal quotes
            return '"' + cleanString.replace(/"/g, '""') + '"';
        });
        
        writer.write(row.join(",") + "\n");
    });
}

module.exports = {
    generateGenericCSV: generateGenericCSV
};