'use strict';

var File = require('dw/io/File');
var FileWriter = require('dw/io/FileWriter');
var CSVStreamWriter = require('dw/io/CSVStreamWriter');
var ProductMgr = require('dw/catalog/ProductMgr');
var CatalogMgr = require('dw/catalog/CatalogMgr');
var ProductInventoryMgr = require('dw/catalog/ProductInventoryMgr'); 
var Status = require('dw/system/Status');
var StringUtils = require('dw/util/StringUtils');
var Calendar = require('dw/util/Calendar');
var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');

// Import your service framework files
var ServiceMgr = require('*/cartridge/services/ServiceMgr'); 

var LIST_PRICE_BOOK_ID = 'list-prices'; 
var FOLDER_PATH = File.IMPEX + '/src/marketingcloud';

function execute(args) {
    var fileWriter = null;
    var csvWriter = null;
    var productIterator = null;

    var serviceID = 'sfmc.sftp.service';
    var targetFolder = args.TargetFolder || 'Import/Production/India/Product Catalog Data'; 
    var currentSite = Site.getCurrent();
    var currentSiteID = currentSite.getID();
    var baseProductUrl = args.BaseProductUrl || 'https://sotbella.com/product/';

    try {
        // 1. Context Verification: Log Site and Inventory List
        var inventoryList = ProductInventoryMgr.getInventoryList(); 
        Logger.info('SFMC Feed: Running for Site: {0}. Inventory List: {1}', currentSiteID, inventoryList ? inventoryList.ID : 'NONE');

        // 2. Resolve the Site's Catalog
        var siteCatalog = CatalogMgr.getSiteCatalog();
        if (!siteCatalog) {
            return new Status(Status.ERROR, 'ERROR', 'No catalog assigned to site: ' + currentSiteID);
        }

        // 3. Setup CSV File
        var now = new Calendar();
        var fileName = 'product-' + StringUtils.formatCalendar(now, 'yyyy-MM-dd') + '_00-00-00.csv';
        var folder = new File(FOLDER_PATH);
        if (!folder.exists()) folder.mkdirs();

        var file = new File(folder, fileName);
        fileWriter = new FileWriter(file);
        csvWriter = new CSVStreamWriter(fileWriter);

        csvWriter.writeNext(['id', 'attribute:name','attribute:archived', 'attribute:url', 'attribute:imageUrl', 'attribute:price', 'attribute:listPrice', 'attribute:inventoryCount', 'attribute:currency', 'categories']);

        // 4. Site-Specific Catalog Query
        productIterator = ProductMgr.queryProductsInCatalog(siteCatalog);

        var productsProcessed = 0;
        while (productIterator.hasNext()) {
            var product = productIterator.next();

            // Filter: Only Master/Standalone that are Online for this site
            if (product.isVariant() || !product.online) continue;

            // VALIDATION: getProductRowData returns null if no online variants or no valid price found
            var rowData = getProductRowData(product, baseProductUrl);
            
            if (rowData) {
                csvWriter.writeNext(rowData);
                productsProcessed++;
            }
        }
        
        // Ensure data is flushed to file before upload
        csvWriter.close();
        csvWriter = null;
        fileWriter = null;

        // 5. SFTP Upload
        Logger.info('SFMC Feed: Attempting upload of {0} products via {1}', productsProcessed, serviceID);
        var serviceClient = ServiceMgr.getFTPService(serviceID);
        serviceClient.uploadFile(targetFolder, file);

        // Once uploadFile finishes without throwing an error, delete the local file
        if (file.exists()) {
            var isDeleted = file.remove();
            if (isDeleted) {
                Logger.info('SFMC Feed: Local file {0} successfully removed from IMPEX.', fileName);
            } else {
                Logger.warn('SFMC Feed: Local file {0} could not be removed.', fileName);
            }
        }

        return new Status(Status.OK, 'OK', 'Feed uploaded for ' + currentSiteID);

    } catch (e) {
        Logger.error('SFMC Feed Error ({0}): {1} at line {2}', currentSiteID, e.message, e.lineNumber);
        return new Status(Status.ERROR, 'ERROR', e.message);
    } finally {
        if (productIterator) productIterator.close();
        if (csvWriter) csvWriter.close();
        else if (fileWriter) fileWriter.close();
    }
}

/**
 * Aggregates site-specific data and performs Master/Variant/Price validation
 */
function getProductRowData(product, baseProductUrl) {
    var totalInventory = 0;
    var firstVariant = null;
    
    // VALIDATION: Ensure at least one variant is online for master products
    if (product.isMaster()) {
        var variants = product.getVariants().iterator();
        while (variants.hasNext()) {
            var v = variants.next();
            // Site-specific: Skip variants not online for this site
            if (!v.online) continue; 

            if (firstVariant === null) firstVariant = v;
            
            // Site-specific Inventory: pulls from current site's assigned list
            if (v.availabilityModel && v.availabilityModel.inventoryRecord) {
                totalInventory += v.availabilityModel.inventoryRecord.ATS.value;
            }
        }
    } else {
        firstVariant = product; // Standalone product
        totalInventory = (product.availabilityModel && product.availabilityModel.inventoryRecord) ? product.availabilityModel.inventoryRecord.ATS.value : 0;
    }

    // Skip Master product if no online variants were found
    if (!firstVariant) {
        return null;
    }

    // Site-specific Price Source (uses site-assigned Price Books)
    var priceModel = firstVariant.getPriceModel();
    var priceInfo = priceModel.getPrice();

    // VALIDATION: Skip if price is unavailable or currency is N/A
    if (!priceInfo.available || priceInfo.currencyCode === 'N/A') {
        return null;
    }

    var salesPrice = priceInfo.value;
    var listPriceObj = priceModel.getPriceBookPrice(LIST_PRICE_BOOK_ID); 
    var listPrice = listPriceObj.available ? listPriceObj.value : salesPrice;

    // Resolve Category within the function
    var category = product.primaryCategory || (product.categories.length > 0 ? product.categories[0] : null);
    if (!category) {
        return null; 
    }

    return [
        product.ID,
        product.name,
        false, // attribute:archived
        baseProductUrl + product.ID,
        product.getImage('large', 0) ? product.getImage('large', 0).getAbsURL().toString() : '',
        salesPrice.toFixed(2),
        listPrice.toFixed(2),
        totalInventory.toFixed(0),
        // product.shortDescription ? product.shortDescription.markup.replace(/<[^>]*>?/gm, '').trim() : '',
        priceInfo.currencyCode || 'INR',
        getCategoryPath(category)
    ];
}

/**
 * Builds pipe-separated category path
 */
function getCategoryPath(category) {
    if (!category || category.root) return '';
    var parentPath = getCategoryPath(category.parent);
    return (parentPath ? parentPath + '|' : '') + category.displayName;
}

module.exports = { execute: execute };