
const fs = require('fs');

// Mock for Google Apps Script PropertiesService
const props = {};

// Load the gas_api_final.js code
let code = fs.readFileSync('gas_api_final.js', 'utf8');
// Remove GAS specific stuff that breaks Node
code = code.replace(/PropertiesService\.getScriptProperties\(\)/g, '{}');
code = code.replace(/ContentService/g, '{}');
code = code.replace(/UrlFetchApp\.fetch/g, 'mockFetch');

eval(code);

// Mock fetch CSV
function mockFetch(url) {
    return {
        getContentText: () => {
            // We just need to load a real CSV. Let's read from the local Python downloaded CSVs if any.
            return ''; 
        }
    }
}

// Read sample CSV
let optCsv = fs.readFileSync('temp_opt.csv', 'utf8');

try {
    let result = processOptions(optCsv);
    console.log(JSON.stringify(result, null, 2));
} catch(e) {
    console.error(e.stack);
}
