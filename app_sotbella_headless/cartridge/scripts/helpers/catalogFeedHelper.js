'use strict';

var StringUtils = require('dw/util/StringUtils');

/**
 * Helper to process product and add to map
 */
function addToMap(map, product, baseUrl) {
    var id = product.ID;

    if (map[id]) {
        return; 
    }

    var title = escapeCSV(product.name);
    var brand = escapeCSV(product.brand);

    var rawDesc = product.shortDescription ? product.shortDescription.markup : (product.longDescription ? product.longDescription.markup : '');
    var description = rawDesc.replace(/<[^>]*>?/gm, ' ')
                             .replace(/[\r\n]+/g, ' ')
                             .replace(/\s\s+/g, ' ')
                             .trim();
    description = escapeCSV(description);

    var availability = product.availabilityModel.isInStock() ? 'in stock' : 'out of stock';
    var condition = 'new'; 

    var priceModel = product.getPriceModel();
    var priceValue = priceModel.getPrice().available ? priceModel.getPrice() : priceModel.getMinPrice(); 
    var price = priceValue.value + ' ' + priceValue.currencyCode;

    var masterId = product.isVariant() ? product.masterProduct.ID : product.ID;
    var link = baseUrl + masterId;

    var imageLink = '';
    var image = product.getImage('large', 0); 
    if (image) {
        imageLink = image.absURL.toString();
    }

    var productVideo = '';
    var videoAlt = '';

    var mediaFiles = product.getImages('large'); 

    if (mediaFiles) {
        var iterator = mediaFiles.iterator();
        while (iterator.hasNext()) {
            var media = iterator.next();
            var url = media.absURL.toString();
            var alt = media.alt ? escapeCSV(media.alt) : '';
            var isVideo = false;
            if (url.indexOf('.mp4') > -1 || 
                url.indexOf('.mov') > -1 || 
                url.indexOf('webm') > -1) {
                isVideo = true;
            }
            if (isVideo) {
                if (productVideo === '') {
                    productVideo = url;
                    videoAlt = alt;
                }
            }
            if (productVideo !== '') {
                break;
            }
        }
    }

    var categoryPath = getCategoryPath(product);
    var googleProductCategory = product.custom.googleProductCategory || categoryPath;
    var fbProductCategory = categoryPath; // Not available by default
    var quantityToSellOnFacebook = '' // Not available by default
    var salePrice = priceValue.value + ' ' + priceValue.currencyCode;
    var salePriceEffectiveDate = ''; // Not available by default
    var itemGroupId = product.isVariant() ? product.masterProduct.ID : '';
    var gender = product.custom.targetGender || '';
    var color = product.custom.color || ''; 
    var size = product.custom.size || '';
    var ageGroup = product.custom.ageGroup || ''; // custom.ageGroup
    var material = product.custom.material || ''; 
    var pattern = '';  // Not available by default
    var shipping = ''; // Not available by default
    var shippingWeight = product.custom.weight ? product.custom.weight + ' ' + product.custom.weightUnit.value : '';
    var videoUrl = productVideo || '';
    var videoTag = videoAlt || '';
    var gtin = product.isVariant() ? product.masterProduct.custom.GTINNumber || '' : product.custom.GTINNumber || '';
    var productTag0 = product.isVariant() ? product.masterProduct.custom.tags[0] || '' : product.custom.tags[0] || '';
    var productTag1 = product.isVariant() ? product.masterProduct.custom.tags[1] || '' : product.custom.tags[1] || '';
    var style0 = product.isVariant() ? product.masterProduct.custom.productType || '' : product.custom.productType || ''; // custom.productType

    var row = StringUtils.format(
        '{0},{1},{2},{3},{4},{5},{6},{7},{8},{9},{10},{11},{12},{13},{14},{15},{16},{17},{18},{19},{20},{21},{22},{23},{24},{25},{26},{27},{28} \n',
        id, title, description, availability, condition, price, link, imageLink, brand, googleProductCategory, fbProductCategory, quantityToSellOnFacebook, salePrice, salePriceEffectiveDate, itemGroupId, gender, color, size, ageGroup, material, pattern, shipping, shippingWeight, videoUrl, videoTag, gtin, productTag0, productTag1, style0
    );

    map[id] = row;
}

/**
 * Helper to build category path: "Parent > Child > Grandchild"
 */
function getCategoryPath(product) {
    var category = product.primaryCategory;

    // 1. Fallback: If no primary category, try Classification Category
    if (!category) {
        category = product.classificationCategory;
    }

    // 2. Fallback: If still nothing (and it's a variant), try the Master's primary category
    if (!category && product.isVariant()) {
        category = product.masterProduct.primaryCategory;
    }

    // 3. Fallback: Just grab the first online category found
    if (!category && product.onlineCategories && product.onlineCategories.length > 0) {
        category = product.onlineCategories[0];
    }

    // If product is not assigned to any category
    if (!category) {
        return '';
    }

    var path = [];
    
    // Traverse up the tree
    while (category !== null) {
        // Stop if we hit the internal system 'root' category (usually ID 'root')
        if (category.ID === 'root') {
            break;
        }
        
        // Add current category name to the FRONT of the array
        path.unshift(category.displayName);
        
        category = category.parent;
    }

    // Join with the separator
    return path.join(' > ');
}

/**
 * escape CSV characters (commas, quotes, newlines)
 */
function escapeCSV(field) {
    if (!field) return '';
    var str = field.toString();
    if (str.search(/("|,|\n|\r)/g) >= 0) {
        str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

module.exports = {
    escapeCSV: escapeCSV,
    addToMap: addToMap,
    getCategoryPath: getCategoryPath
}