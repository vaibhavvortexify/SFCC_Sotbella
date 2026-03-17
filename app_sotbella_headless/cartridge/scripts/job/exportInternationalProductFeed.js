'use strict';

var File = require('dw/io/File');
var FileWriter = require('dw/io/FileWriter');
var CSVStreamWriter = require('dw/io/CSVStreamWriter');
var ProductMgr = require('dw/catalog/ProductMgr');
var CatalogMgr = require('dw/catalog/CatalogMgr');
var Status = require('dw/system/Status');
var StringUtils = require('dw/util/StringUtils');
var Calendar = require('dw/util/Calendar');
var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');

// Service framework
var ServiceMgr = require('*/cartridge/services/ServiceMgr');

var LIST_PRICE_BOOK_ID = 'list-prices';
var FOLDER_PATH = File.IMPEX + '/src/marketingcloud';

function execute(args) {
    var fileWriter = null;
    var csvWriter = null;
    var productIterator = null;

    var currentSite = Site.getCurrent();
    var siteID = currentSite.getID();
    var isLastSite = args.IsLastSite === 'true' || args.IsLastSite === true;
    var isFirstSite = args.IsFirstSite === 'true' || args.IsFirstSite === true;
    var baseProductUrl = args.BaseProductUrl || 'https://sotbella.ae/product/';

    try {
        var now = new Calendar();
        var fileName = 'product-' + StringUtils.formatCalendar(now, 'yyyy-MM-dd_HH') + '-00-00.csv';
        var folder = new File(FOLDER_PATH);
        if (!folder.exists()) folder.mkdirs();

        var file = new File(folder, fileName);

        // 1. Delete existing file if this is the start of the site sequence
        if (isFirstSite && file.exists()) {
            file.remove();
        }

        var isNewFile = !file.exists();

        // 2. Open in APPEND mode
        fileWriter = new FileWriter(file, true);
        csvWriter = new CSVStreamWriter(fileWriter);

        // 3. Updated Header with new attributes
        if (isNewFile) {
            csvWriter.writeNext([
                'id', 
                'attribute:name', 
                'attribute:archived', 
                'attribute:url', 
                'attribute:imageUrl', 
                'attribute:price', 
                'attribute:listPrice', 
                'attribute:inventoryCount', 
                'attribute:description', 
                'attribute:currency', 
                'categories'
            ]);
        }

        // 4. Site-specific Catalog Processing
        var siteCatalog = CatalogMgr.getSiteCatalog();
        if (siteCatalog) {
            productIterator = ProductMgr.queryProductsInCatalog(siteCatalog);
            while (productIterator.hasNext()) {
                var product = productIterator.next();
                
                // Skip variants and offline master products
                if (product.isVariant() || !product.online) continue;

                // Validation: returns null if no online variants or no valid price found
                var rowData = getProductRowData(product, baseProductUrl);
                if (rowData) {
                    csvWriter.writeNext(rowData);
                }
            }
        }

        // 5. Close streams so the next site can open it
        csvWriter.close();
        csvWriter = null;
        fileWriter = null;

        // 6. Final Upload: Only if IsLastSite is true
        if (isLastSite) {
            Logger.info('International Feed: Last site reached ({0}). Uploading to SFTP...', siteID);
            var serviceID = 'sfmc.sftp.service';
            var targetFolder = args.TargetFolder || 'Import/International/Product Catalog Data';
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
        }

        return new Status(Status.OK, 'OK');

    } catch (e) {
        Logger.error('International Feed Error for {0}: {1}', siteID, e.message);
        return new Status(Status.ERROR, 'ERROR', e.message);
    } finally {
        if (productIterator) productIterator.close();
        if (csvWriter) csvWriter.close();
        else if (fileWriter) fileWriter.close();
    }
}

/**
 * Validates variants and pricing before returning full row data
 */
function getProductRowData(product, baseProductUrl) {
    var totalInventory = 0;
    var firstVariant = null;

    if (product.isMaster()) {
        var variants = product.getVariants().iterator();
        while (variants.hasNext()) {
            var v = variants.next();
            if (!v.online) continue;

            if (firstVariant === null) firstVariant = v;
            
            if (v.availabilityModel && v.availabilityModel.inventoryRecord) {
                totalInventory += v.availabilityModel.inventoryRecord.ATS.value;
            }
        }
    } else {
        firstVariant = product;
        totalInventory = (product.availabilityModel && product.availabilityModel.inventoryRecord) ? product.availabilityModel.inventoryRecord.ATS.value : 0;
    }

    // Skip master product if no online variants found
    if (!firstVariant) return null;

    var priceModel = firstVariant.getPriceModel();
    var priceInfo = priceModel.getPrice();

    // Price Validation: Skip if N/A or unavailable
    if (!priceInfo.available || priceInfo.currencyCode === 'N/A') {
        return null;
    }

    var salesPrice = priceInfo.value;
    var listPriceObj = priceModel.getPriceBookPrice(LIST_PRICE_BOOK_ID);
    var listPrice = listPriceObj.available ? listPriceObj.value : salesPrice;

    var category = product.primaryCategory || (product.categories.length > 0 ? product.categories[0] : null);
    if (!category) return null;

    return [
        product.ID,
        product.name,
        false, // archived
        baseProductUrl + product.ID,
        product.getImage('large', 0) ? product.getImage('large', 0).getAbsURL().toString() : '',
        salesPrice.toFixed(2),
        listPrice.toFixed(2),
        totalInventory.toFixed(0),
        product.shortDescription ? product.shortDescription.markup.replace(/<[^>]*>?/gm, '').trim() : '',
        priceInfo.currencyCode,
        getCategoryPath(category)
    ];
}

function getCategoryPath(category) {
    if (!category || category.root) return '';
    var parentPath = getCategoryPath(category.parent);
    return (parentPath ? parentPath + '|' : '') + category.displayName;
}

module.exports = { execute: execute };