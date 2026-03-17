'use strict';

var Logger = require('dw/system/Logger');
var ReviewService = require('*/cartridge/services/ReviewService');
var Site = require('dw/system/Site');
var marketingAuthService = require('*/cartridge/services/marketingAuth');
var marketingEmailService = require('*/cartridge/services/marketingSendEmail');
/**
 * Checks if a review exists for a given customer email and product ID.
 * * @param {string} email - The customer's email address.
 * @param {string} productId - The product ID (SKU).
 * @returns {Object} { success: boolean, data: Object, error: string }
 */
function checkReviewExists(email, productId) {
    try {
        if (!email || !productId) {
            return {
                success: false,
                error: 'Missing required parameters: email or productId'
            };
        }

        // Call the service
        var result = ReviewService.checkReviewExists.call({
            productId: productId,
            authorEmail: email
        });

        if (result.ok) {
            // Service call successful (HTTP 200-299)
            // The service's parseResponse returns the JSON body
            return {
                success: true,
                data: result.object
            };
        } else {
            // Service call failed (HTTP 4xx, 5xx, or Connectivity Error)
            Logger.error('ReviewHelper: Service call failed. Error: {0}', result.errorMessage);
            
            // Try to parse error message from service response if available
            var errorDetails = result.errorMessage;
            try {
                if (result.object && result.object.message) {
                    errorDetails = result.object.message;
                }
            } catch (e) { /* ignore */ }

            return {
                success: false,
                error: errorDetails
            };
        }

    } catch (e) {
        Logger.error('ReviewHelper: Exception in checkReviewExists: {0}', e.message);
        return {
            success: false,
            error: e.message
        };
    }
}

/**
 * Retrieves a valid OAuth Access Token from Marketing Cloud
 * Uses 'marketingAuthService'
 * @returns {string|null} The access token or null if failed
 */
function getAccessToken() {
    var logger = Logger.getLogger('MarketingCloud', 'Auth');

    // 1. Get Credentials from Site Preferences
    var currentSite = Site.getCurrent();
    var clientId = currentSite.getCustomPreferenceValue('marketingCloudClientId');
    var clientSecret = currentSite.getCustomPreferenceValue('marketingCloudClientSecret');

    if (!clientId || !clientSecret) {
        logger.error('Missing Site Preferences: marketingCloudClientId or marketingCloudClientSecret');
        return null;
    }

    // 2. Call Auth Service
    var authResult = marketingAuthService.marketingAuthService.call({
        clientId: clientId,
        clientSecret: clientSecret
    });

    // 3. Handle Response
    if (!authResult.ok) {
        logger.error('Marketing Cloud Auth Error: ' + JSON.stringify(authResult));
        return null;
    }

    return authResult.object;
}

/**
 * Processes an Order and a specific list of PLIs to send a consolidated Review Reminder Email.
 * Filters items that already have reviews.
 * @param {dw.order.Order} order - The Order object
 * @param {dw.util.Collection} productLineItems - The specific list of ProductLineItems to process
 * @returns {Object} { success: boolean, sentSkus: Array, existingReviewSkus: Array, error: string }
 */
function sendOrderReviewReminder(order, productLineItems,reminderContext) {
    var logger = Logger.getLogger('MarketingCloud', 'ReviewEmail');
    var sentSkus = [];
    var existingReviewSkus = [];

    try {
        // 0. Validate Inputs
        if (!productLineItems || productLineItems.isEmpty()) {
            return { 
                success: true, 
                skipped: true, 
                sentSkus: [], 
                existingReviewSkus: [] 
            };
        }

        // 1. Get Site Preferences
        var currentSite = Site.getCurrent();
        var eventDefinitionKey = '';
        if(reminderContext == true){
            eventDefinitionKey = currentSite.getCustomPreferenceValue('MCReviewReminderEventKey');
        }
        else{
            eventDefinitionKey = currentSite.getCustomPreferenceValue('MCReviewEmailDefinitionKey');
        }
        var reviewLinkBase = currentSite.getCustomPreferenceValue('reviewLink');

        if (!eventDefinitionKey || !reviewLinkBase) {
            return { success: false, error: 'Missing Site Preferences' };
        }

        var customerEmail = order.getCustomerEmail();
        var customerName = order.getCustomerName();
        var orderNo = order.getOrderNo();
        var orderItemsPayload = [];

        // 2. Iterate the PASSED Product Line Items
        var pliIter = productLineItems.iterator();

        while (pliIter.hasNext()) {
            var pli = pliIter.next();
            var productId = pli.getProductID();
            
            // --- Step A: Check if Review Exists ---
            var reviewCheck = checkReviewExists(customerEmail, productId);

            if (reviewCheck.success && reviewCheck.data && reviewCheck.data.hasReview === true) {
                // Review exists: Track SKU to update flag later, do NOT add to email
                logger.info(' > SKU {0}: Review already exists. Skipping email.', productId);
                existingReviewSkus.push(productId);
            } else {
                // Review does NOT exist: Prepare data for email
                var product = pli.getProduct();
                var productName = pli.getProductName();
                var productVariantDetail = '';
                var productImage = '';

                if (product) {
                    // --- FIXED VARIANT LOGIC ---
                    if (product.isVariant()) {
                        var variationModel = product.getVariationModel();
                        var productVariationAttributes = variationModel.getProductVariationAttributes();
                        var details = [];

                        var pvaIter = productVariationAttributes.iterator();
                        while (pvaIter.hasNext()) {
                            var pva = pvaIter.next();
                            var selectedValue = variationModel.getSelectedValue(pva);
                            if (selectedValue) {
                                details.push(selectedValue.displayValue);
                            }
                        }
                        
                        if (details.length > 0) {
                            productVariantDetail = details.join('/');
                        }
                    }
                    // ---------------------------

                    // Image Logic (Large, index 0)
                    var img = product.getImage('large', 0);
                    if (img) {
                        productImage = img.getAbsURL().toString();
                    }
                }

                // Construct Link
                var separator = reviewLinkBase.indexOf('?') !== -1 ? '&' : '?';
                var itemReviewLink = reviewLinkBase + separator + 'orderId=' + orderNo + '&sku=' + productId;

                // Add to Payload List
                orderItemsPayload.push({
                    ProductSKU: productId,
                    ProductName: productName,
                    ProductVariantDetail: productVariantDetail || "",
                    ProductImage: productImage || "",
                    ReviewLink: itemReviewLink
                });

                // Track SKU as "To Be Sent"
                sentSkus.push(productId);
            }
        }

        // 3. Check if we have items to send
        if (orderItemsPayload.length === 0) {
            logger.info('Order {0}: No eligible items to send (all reviewed or skipped).', orderNo);
            return { 
                success: true, 
                skipped: true, 
                sentSkus: [], 
                existingReviewSkus: existingReviewSkus 
            };
        }

        // 4. Construct Final Payload
        var apiBody = {
            ContactKey: customerEmail,
            EventDefinitionKey: eventDefinitionKey,
            Data: {
                CustomerName: customerName,
                CustomerEmail: customerEmail,
                OrderId: orderNo,
                OrderItems: JSON.stringify(orderItemsPayload) // The array of items
            }
        };

        // 5. Get Access Token
        var accessToken = getAccessToken();
        if (!accessToken) {
            return { success: false, error: 'Auth Failed' };
        }

        // 6. Call Email Service
        var sendCodeResult = marketingEmailService.marketingEmailService.call({
            accessToken: accessToken,
            body: apiBody
        });

        if (sendCodeResult.ok) {
            logger.info('Review Email Sent for Order {0} with {1} items.', orderNo, orderItemsPayload.length);
            return { 
                success: true, 
                sentSkus: sentSkus, 
                existingReviewSkus: existingReviewSkus,
                result: sendCodeResult.object 
            };
        } else {
            logger.error('Email Service Failed for Order {0}: {1}', orderNo, sendCodeResult.errorMessage);
            return { success: false, error: sendCodeResult.errorMessage };
        }

    } catch (e) {
        logger.error('Exception in sendOrderReviewReminder: {0}', e.message);
        return { success: false, error: e.message };
    }
}
module.exports = {
    checkReviewExists: checkReviewExists,
    sendOrderReviewReminder: sendOrderReviewReminder
};