'use strict';

var server = require('server');
var Site = require('dw/system/Site');
var ProductSearchModel = require('dw/catalog/ProductSearchModel');
var catalogFeedHelper = require('*/cartridge/scripts/helpers/catalogFeedHelper');
var Logger = require('dw/system/Logger');

server.get('GetCSV', function (req, res, next) {

    var filename = req.querystring.filename || 'facebook_feed.csv';

    res.setHttpHeader('Content-Type', 'text/csv');
    res.setHttpHeader('Content-Disposition', 'attachment; filename=' + filename);

    try {
        var baseUrl = Site.current.getCustomPreferenceValue('storefrontBaseUrl'); 
        
        if (!baseUrl) {
            baseUrl = "https://sotbella.com/product/";
        } else {
            if (!baseUrl.endsWith('/')) {
                baseUrl += '/product/';
            } else {
                baseUrl += 'product/';
            }
        }

        var header = 'id,title,description,availability,condition,price,link,image_link,brand,google_product_category,fb_product_category,quantity_to_sell_on_facebook,sale_price,sale_price_effective_date,item_group_id,gender,color,size,age_group,material,pattern,shipping,shipping_weight,video[0].url,video[0].tag[0],gtin,product_tags[0],product_tags[1],style[0]\n';

        res.print(header);

        var productsMap = {};

        var searchModel = new ProductSearchModel();
        searchModel.setCategoryID('root');
        searchModel.setOrderableProductsOnly(true);
        searchModel.setRecursiveCategorySearch(true);
        searchModel.search();

        var hits = searchModel.getProductSearchHits();

        while (hits.hasNext()) {
            var hit = hits.next();
            var product = hit.getProduct();

            if (product.isMaster()) {
                var variants = product.getVariants();
                var pIt = variants.iterator();
                while (pIt.hasNext()) {
                    var variant = pIt.next();
                    if(variant.online) { 
                        // writeProductRow(res, variant, baseUrl);
                        catalogFeedHelper.addToMap(productsMap, variant, baseUrl);
                    }
                }
            } else {
                // writeProductRow(res, product, baseUrl);
                catalogFeedHelper.addToMap(productsMap, product, baseUrl);
            }
        }

        var ids = Object.keys(productsMap);
        
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            res.print(productsMap[id]);
        }

    } catch (error) {
        Logger.error('Error generating CSV feed: ' + error.message);
        res.print('\nError generating CSV: ' + error.message);
    }
    
    next();
});


module.exports = server.exports();