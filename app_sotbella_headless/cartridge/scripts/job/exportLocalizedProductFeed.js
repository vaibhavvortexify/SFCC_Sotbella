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
    var isLastSite = args.IsLastSite === true || args.IsLastSite === 'true';
    var isFirstSite = args.IsFirstSite === true || args.IsFirstSite === 'true';
    var baseProductUrl = args.BaseProductUrl || 'https://sotbella.ae/product/';

    try {
        var now = new Calendar();
        var fileName = 'locale-product-' + StringUtils.formatCalendar(now, 'yyyy-MM-dd_HH') + '-00-00.csv';
        var folder = new File(FOLDER_PATH);
        if (!folder.exists()) folder.mkdirs();

        var file = new File(folder, fileName);

        if (isFirstSite && file.exists()) {
            file.remove();
        }

        var isNewFile = !file.exists();
        fileWriter = new FileWriter(file, true);
        csvWriter = new CSVStreamWriter(fileWriter);

        if (isNewFile) {
            csvWriter.writeNext([
                'id',
                'locale',
                'attribute:name',
                'attribute:url',
                'attribute:description',
                'attribute:price',
                'attribute:currency',
                'attribute:listPrice'
            ]);
        }

        var siteCatalog = CatalogMgr.getSiteCatalog();
        var allowedLocales = currentSite.getAllowedLocales();

        if (siteCatalog) {
            for (var i = 0; i < allowedLocales.length; i++) {
                var currentLocale = allowedLocales[i];
                request.setLocale(currentLocale);

                productIterator = ProductMgr.queryProductsInCatalog(siteCatalog);
                while (productIterator.hasNext()) {
                    var product = productIterator.next();

                    // Basic filters: Skip variants and offline products
                    if (product.isVariant() || !product.online) continue;

                    // VALIDATION: Get row data which now includes the variant-assignment check
                    var rowData = getLocalizedRowData(product, currentLocale, baseProductUrl);

                    // Skip if rowData is null (means no valid variants or no valid price)
                    if (rowData && rowData[6] !== 'N/A') {
                        csvWriter.writeNext(rowData);
                    }
                }
                productIterator.close();
            }
        }

        csvWriter.close();
        csvWriter = null;
        fileWriter = null;

        if (isLastSite) {
            Logger.info('Localization Feed: Final site ({0}) complete. Uploading...', siteID);
            var serviceID = 'sfmc.sftp.service';
            var targetFolder = args.TargetFolder || 'Import/International/Localization Data';
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
        Logger.error('Localization Feed Error ({0}): {1}', siteID, e.message);
        return new Status(Status.ERROR, 'ERROR', e.message);
    } finally {
        if (productIterator) productIterator.close();
        if (csvWriter) csvWriter.close();
        else if (fileWriter) fileWriter.close();
    }
}

/**
 * Fetches localized attributes and validates variant availability/pricing
 */
function getLocalizedRowData(product, locale, baseProductUrl) {
    var firstVariant = null;

    // LOGIC: Ensure at least one variant is online
    if (product.isMaster()) {
        var variants = product.getVariants().iterator();
        while (variants.hasNext()) {
            var v = variants.next();
            // In SFCC, variants returned from a site-catalog query are assigned to that site
            if (v.online) {
                firstVariant = v;
                break; // Found at least one valid variant
            }
        }
    } else {
        firstVariant = product; // Standalone product
    }

    // Skip Master product if no online variants were found
    if (!firstVariant) {
        return null;
    }

    var priceModel = firstVariant.getPriceModel();
    var priceInfo = priceModel.getPrice();

    // VALIDATION: Skip if price is unavailable or currency is N/A
    if (!priceInfo.available || priceInfo.currencyCode === 'N/A') {
        return null;
    }

    var salesPrice = priceInfo.value;
    var listPriceObj = priceModel.getPriceBookPrice(LIST_PRICE_BOOK_ID);
    var listPrice = listPriceObj.available ? listPriceObj.value : salesPrice;

    return [
        product.ID,
        locale,
        product.name || '',
        baseProductUrl + product.ID,
        product.shortDescription ? product.shortDescription.markup.replace(/<[^>]*>?/gm, '').trim() : '',
        salesPrice.toFixed(2),
        priceInfo.currencyCode,
        listPrice.toFixed(2)
    ];
}

module.exports = { execute: execute };