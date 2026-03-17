'use strict';

var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');
var marketingAuthService = require('*/cartridge/services/marketingAuth');
var marketingEmailService = require('*/cartridge/services/marketingSendEmail');
var Currency = require('dw/util/Currency');
var refundHelper = require('*/cartridge/scripts/helpers/refundHelper');
/**
 * Retrieves a valid OAuth Access Token from Marketing Cloud
 * Copied from your reference file
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
 * Helper to get product image URL safely
 */
function getProductImageUrl(product) {
    if (!product) return '';
    var image = product.getImage('large', 0);
    return image ? image.getAbsURL().toString() : '';
}

/**
 * Helper to construct "Color/Size/Material" string
 */
function getVariantDetails(product) {
    if (!product || !product.isVariant()) return '';

    var variationModel = product.getVariationModel();
    var pvas = variationModel.getProductVariationAttributes();
    var details = [];

    var iter = pvas.iterator();
    while (iter.hasNext()) {
        var pva = iter.next();
        var selectedValue = variationModel.getSelectedValue(pva);
        if (selectedValue) {
            details.push(selectedValue.displayValue);
        }
    }
    return details.join('/');
}

/**
 * Helper to get the applied coupon code
 */
function getOrderCoupon(order) {
    var couponLineItems = order.getCouponLineItems();
    return !couponLineItems.empty ? couponLineItems[0].couponCode : '';
}
/**
 * Helper to get Shipping Discount Code (if any)
 */
function getShippingDiscountCode(order) {
    var shipments = order.getShipments();
    if (!shipments.empty) {
        var shippingPriceAdjustments = shipments[0].shippingPriceAdjustments;
        if (!shippingPriceAdjustments.empty) {
             // Return the promotion ID or Coupon Code associated
            var promo = shippingPriceAdjustments[0].promotion;
            return promo ? promo.ID : '';
        }
    }
    return '';
}
/**
 * Main function to send Order Delivered Email via Marketing Cloud
 * Uses the reference file's service pattern
 */
function sendOrderDeliveredEmail(order, plis) {
    var logger = Logger.getLogger('MarketingCloud', 'OrderDelivered');
    var eventDefinitionKey = Site.getCurrent().getCustomPreferenceValue('MCOrderDeliveredEventKey');

    if (!eventDefinitionKey) {
        logger.error('Missing MCOrderDeliveredEventKey Preference');
        return { success: false, error: 'Missing Preference' };
    }
    var currencyCode = order.getCurrencyCode(); // e.g., "USD", "INR"
    
    // 1. Construct OrderItems JSON Array
    var orderItemsArray = [];
    var pliIter = plis.iterator();

    while (pliIter.hasNext()) {
        var pli = pliIter.next();
        var product = pli.product;

        if (product) {
            var productPrice = pli.basePrice.value;
            var adjustedPrice = refundHelper.calculateRefundAmount(order,pli.getProductID(),false); // this will return the products price after all discounts
            var discount = productPrice - adjustedPrice;

            orderItemsArray.push({
                ProductName: pli.productName,
                ProductVariantDetail: getVariantDetails(product),
                ProductPrice: currencyCode + ' '+productPrice,
                ProductImage: getProductImageUrl(product),
                ProductDiscountPrice: currencyCode + ' ' + (adjustedPrice/pli.quantityValue),
                OrderDiscount:currencyCode+ ' '+ (discount > 0 ? discount : 0),
                ProductQuantity: pli.quantityValue,
                OrderDiscountCode: getOrderCoupon(order)
            });
        }
    }

    // 2. Build Payload
    var storeBaseUrl = Site.getCurrent().getCustomPreferenceValue('viewYourOrderLink')
    var orderLink = storeBaseUrl + order.orderNo;
    var trackingNo = '';
    if(order.custom && order.custom.trackingNumber){
        trackingNo = order.custom.trackingNumber;
    }
    var sitePrefLocale = Site.getCurrent().getCustomPreferenceValue('locale');
    var finalLocale = sitePrefLocale ? sitePrefLocale : order.customerLocaleID;
    var apiBody = {
        ContactKey: order.customerEmail,
        EventDefinitionKey: eventDefinitionKey,
        Data: {
            ViewYourOrderLink: orderLink,
            OrderID: order.orderNo,
            VisitOurStoreLink: storeBaseUrl,
            EmailAddress: order.customerEmail,
            FirstName: order.billingAddress.firstName,
            LastName: order.billingAddress.lastName,
            PhoneNumber: order.billingAddress.phone || "",
            UPSTrackingNumber: trackingNo,
            Locale: finalLocale,
            OrderItems: JSON.stringify(orderItemsArray) // Stringified as required by SFMC
        }
    };

    // 3. Get Access Token (Using helper from reference)
    var accessToken = getAccessToken();
    if (!accessToken) {
        return { success: false, error: 'Auth Failed' };
    }

    // 4. Call Email Service (Using service from reference)
    try {
        var sendCodeResult = marketingEmailService.marketingEmailService.call({
            accessToken: accessToken,
            body: apiBody
        });

        if (sendCodeResult.ok) {
            logger.info('Order Delivered Email Sent for Order {0}:{1}', order.orderNo, JSON.stringify(apiBody));
            return { success: true, result: sendCodeResult.object };
        } else {
            logger.error('Email Service Failed for Order {0}: {1}', order.orderNo, sendCodeResult.errorMessage);
            return { success: false, error: sendCodeResult.errorMessage };
        }
    } catch (e) {
        logger.error('Exception in sendOrderDeliveredEmail: {0}', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * NEW: Sends Order Cancellation Email
 * @param {dw.order.Order} order 
 * @param {dw.util.Collection} plis - The cancelled ProductLineItems
 */
function sendOrderCancellationEmail(order, plis) {
    var logger = Logger.getLogger('MarketingCloud', 'OrderCancelled');
    var eventDefinitionKey = Site.getCurrent().getCustomPreferenceValue('MCOrderCancelledEventKey');

    if (!eventDefinitionKey) {
        logger.error('Missing MCOrderCancelledEventKey Preference');
        return { success: false, error: 'Missing Preference' };
    }

    // 1. Prepare Totals & Currency
    var currencyCode = order.getCurrencyCode();
    
    
    var runningSubtotal = 0;
    var runningTax = 0;
    var runningTotal = 0; // The actual value of items (Prorated)
    var runningDiscount = 0;

    // 2. Construct OrderItems Array
    var orderItemsArray = [];
    var pliIter = plis.iterator();

    while (pliIter.hasNext()) {
        var pli = pliIter.next();
        var product = pli.product;

        if (product) {
            // Price Calculations per item
            var qty = pli.quantityValue;
            var basePriceTotal = pli.basePrice.value * qty; // Unit Price * Qty
            var adjustedPriceTotal = pli.adjustedPrice.value; // Price after item discounts
            var itemTax = pli.tax.value;
            var itemProratedPrice = pli.proratedPrice.value; // Price including order-level discount share

            // Update Totals
            runningSubtotal += basePriceTotal;
            runningTax += itemTax;
            runningTotal = refundHelper.calculateRefundAmount(order,pli.getProductID(),false); // Total Amount usually includes Tax
            
            // Calculate Discount (Base Total - Actual Paid)
            var itemDiscount = basePriceTotal - itemProratedPrice;
            if (itemDiscount > 0) runningDiscount += itemDiscount;

            orderItemsArray.push({
                ProductName: pli.productName,
                ProductVariantDetail: getVariantDetails(product),
                ProductPrice: currencyCode + ' ' + pli.basePrice.value.toFixed(2), // Unit Price
                ProductImage: getProductImageUrl(product),
                ProductDiscountPrice: currencyCode + ' ' + (runningTotal / qty), // Unit Discount Price
                OrderDiscount:currencyCode+ ' '+ itemDiscount,
                ProductQuantity: qty,
                OrderDiscountCode: getOrderCoupon(order)
            });
        }
    }

    // 3. Calculate Shipping Discount (Order Level)
    var shippingDiscount = 0;
    var shippingTotal = order.shippingTotalPrice.value;
    var shippingAdjusted = order.adjustedShippingTotalPrice.value;
    if (shippingTotal > shippingAdjusted) {
        shippingDiscount = shippingTotal - shippingAdjusted;
    }
var finalSavedValue = runningDiscount + shippingDiscount;
    var sitePrefLocale = Site.getCurrent().getCustomPreferenceValue('locale');
    var finalLocale = sitePrefLocale ? sitePrefLocale : order.customerLocaleID;
    // 4. Build Payload
    var apiBody = {
        ContactKey: order.customerEmail,
        EventDefinitionKey: eventDefinitionKey,
        Data: {
            OrderID: order.orderNo,
            EmailAddress: order.customerEmail,
            FirstName: order.billingAddress.firstName,
            LastName: order.billingAddress.lastName,
            PhoneNumber: order.billingAddress.phone || "",
            Locale: finalLocale,
            // Calculated Financials
            Subtotal: currencyCode + ' ' + runningSubtotal,
            ShippingDiscount: currencyCode + ' ' + shippingDiscount,
            ShippingDiscountCode: getShippingDiscountCode(order),
            Taxes: currencyCode + ' ' + runningTax,
            TotalAmount: currencyCode + ' ' + runningTotal,
            SavedValue: currencyCode + ' ' + finalSavedValue, // Total Saved
            OrderDiscount: currencyCode + ' ' + runningDiscount,
            OrderDiscountCode: getOrderCoupon(order),
            OrderItems: JSON.stringify(orderItemsArray)
        }
    };

    // 5. Auth & Send
    var accessToken = getAccessToken();
    if (!accessToken) {
        return { success: false, error: 'Auth Failed' };
    }

    try {
        var sendCodeResult = marketingEmailService.marketingEmailService.call({
            accessToken: accessToken,
            body: apiBody
        });

        if (sendCodeResult.ok) {
            logger.info('Order Cancellation Email Sent for Order {0}: api body {1}', order.orderNo,apiBody);
            return { success: true, result: sendCodeResult.object };
        } else {
            logger.error('Cancellation Email Service Failed for Order {0}: {1}', order.orderNo, sendCodeResult.errorMessage);
            return { success: false, error: sendCodeResult.errorMessage };
        }
    } catch (e) {
        logger.error('Exception in sendOrderCancellationEmail: {0}', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * Sends Refund Email
 * Uses refundHelper for accurate pricing logic
 */
function sendRefundEmail(order, plis,refundAmount,cancelledContext) {
    var logger = Logger.getLogger('MarketingCloud', 'OrderRefund');
    var eventDefinitionKey = Site.getCurrent().getCustomPreferenceValue('MCRefundEventKey');

    if (!eventDefinitionKey) {
        logger.error('Missing MCRefundEventKey Preference');
        return { success: false, error: 'Missing Preference' };
    }

    var currencyCode = order.getCurrencyCode();
    
    
    var runningSubtotal = 0;
    var runningTax = 0;
    var runningTotal = 0; 
    var runningDiscount = 0;

    var orderItemsArray = [];
    var pliIter = plis.iterator();

    while (pliIter.hasNext()) {
        var pli = pliIter.next();
        var product = pli.product;

        if (product) {
            var qty = pli.quantityValue;
            var basePriceTotal = pli.basePrice.value * qty;
            var itemTax = pli.tax.value;
            var itemProratedPrice = pli.proratedPrice.value;

            // USE HELPER: Call calculateRefundAmount for this item
            var calculatedLineTotal = refundHelper.calculateRefundAmount(order, pli.productID, cancelledContext);
            var refundAmount  = refundAmount;
            // Logic: Unit Price = Total Calculated Refund / Quantity
            var lineTotalWithoutShipping = refundHelper.calculateRefundAmount(order, pli.productID, false);
            var unitDiscountedPrice = lineTotalWithoutShipping / qty;

            // Aggregating Totals
            runningSubtotal += basePriceTotal;
            runningTax += itemTax;
            runningTotal += lineTotalWithoutShipping; 
            
            var itemDiscount = basePriceTotal - itemProratedPrice;
            if (itemDiscount > 0) runningDiscount += itemDiscount;

            orderItemsArray.push({
                ProductName: pli.productName,
                ProductVariantDetail: getVariantDetails(product),
                ProductPrice: currencyCode +' '+ pli.basePrice.value.toFixed(2),
                ProductImage: getProductImageUrl(product),
                ProductDiscountPrice: currencyCode +' '+ unitDiscountedPrice, // Populated via helper result
                OrderDiscount: currencyCode +' '+ itemDiscount,
                ProductQuantity: qty,
                OrderDiscountCode: getOrderCoupon(order)
            });
        }
    }

    var shippingDiscount = 0;
    var shippingTotal = order.shippingTotalPrice.value;
    var shippingAdjusted = order.adjustedShippingTotalPrice.value;
    if (shippingTotal > shippingAdjusted) {
        shippingDiscount = shippingTotal - shippingAdjusted;
    }

    // ROUNDING for SFMC
    var finalSubtotal =runningSubtotal;
    var finalTaxes = runningTax;
    var finalSavedValue = runningDiscount + shippingDiscount;
    var finalOrderDiscount = runningDiscount;
    var finalRefundAmount = refundAmount;
    var sitePrefLocale = Site.getCurrent().getCustomPreferenceValue('locale');
    var finalLocale = sitePrefLocale ? sitePrefLocale : order.customerLocaleID;
    var apiBody = {
        ContactKey: order.customerEmail,
        EventDefinitionKey: eventDefinitionKey,
        Data: {
            OrderID: order.orderNo,
            EmailAddress: order.customerEmail,
            FirstName: order.billingAddress.firstName,
            LastName: order.billingAddress.lastName,
            PhoneNumber: order.billingAddress.phone || "",
            Locale: finalLocale,
            AmountRefundValue:currencyCode+ ' '+ finalRefundAmount, 
            AmountPaid: currencyCode + ' '+ order.totalGrossPrice.value,
            Subtotal: currencyCode + ' '+ finalSubtotal,
            ShippingDiscount: currencyCode + ' '+ shippingDiscount,
            ShippingDiscountCode: getShippingDiscountCode(order),
            Taxes: currencyCode + ' '+ finalTaxes,
            TotalAmount: currencyCode + ' '+ calculatedLineTotal,
            SavedValue: currencyCode + ' '+ finalSavedValue,
            OrderDiscount: currencyCode + ' '+ finalOrderDiscount,
            OrderDiscountCode: getOrderCoupon(order), 
            OrderItems: JSON.stringify(orderItemsArray)
        }
    };

    var accessToken = getAccessToken();
    if (!accessToken) return { success: false, error: 'Auth Failed' };

    try {
        var sendCodeResult = marketingEmailService.marketingEmailService.call({
            accessToken: accessToken,
            body: apiBody
        });

        if (sendCodeResult.ok) {
            logger.info('Refund Email Sent for Order {0}, Amount: {1}', order.orderNo, refundAmount);
            return { success: true, result: sendCodeResult.object };
        } else {
            logger.error('Refund Email Service Failed for Order {0}: {1}', order.orderNo, sendCodeResult.errorMessage);
            return { success: false, error: sendCodeResult.errorMessage };
        }
    } catch (e) {
        logger.error('Exception in sendRefundEmail: {0}', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * NEW: Sends Return Request Email
 * @param {dw.order.Order} order 
 * @param {dw.util.Collection} plis - The ProductLineItems involved in the return request
 */
function sendReturnRequestEmail(order, plis) {
    var logger = Logger.getLogger('MarketingCloud', 'ReturnRequest');
    var eventDefinitionKey = Site.getCurrent().getCustomPreferenceValue('MCReturnReqEventKey');

    if (!eventDefinitionKey) {
        logger.error('Missing MCReturnReqEventKey Preference');
        return { success: false, error: 'Missing Preference' };
    }

    var currencyCode = order.getCurrencyCode();
    
    
    
    
    // 1. Calculate Merchandise Discount (Standard Total - Adjusted Total)
    // using getMerchandizeTotalGrossPrice() covers tax-inclusive sites (B2C standard)
    var merchTotal = order.getMerchandizeTotalGrossPrice();
    var merchAdjusted = order.getAdjustedMerchandizeTotalGrossPrice();
    var totalMerchDiscount = merchTotal.subtract(merchAdjusted);

    // 2. Calculate Shipping Discount (e.g. Free shipping promos)
    var shippingTotal = order.getShippingTotalPrice();
    var shippingAdjusted = order.getAdjustedShippingTotalPrice();
    var totalShippingDiscount = shippingTotal.subtract(shippingAdjusted);

    // 3. Combine for "Whole Order" discount
    // .value returns the raw decimal number
    var wholeOrderDiscount = totalMerchDiscount.add(totalShippingDiscount).value;
    

    // 1. Construct OrderItems JSON Array
    var orderItemsArray = [];
    var pliIter = plis.iterator();

    while (pliIter.hasNext()) {
        var pli = pliIter.next();
        var product = pli.product;

        if (product) {
            var productPrice = pli.basePrice.value;
            var adjustedPrice = refundHelper.calculateRefundAmount(order, pli.getProductID(), false);
            
            // Note: This logic seems to calculate the discount for THIS item specifically
            // If you want to keep the item-level discount for reference, use a different key like 'ItemDiscount'
            var itemDiscount = productPrice - adjustedPrice; 

            orderItemsArray.push({
                ProductName: pli.productName,
                ProductVariantDetail: getVariantDetails(product),
                ProductPrice: currencyCode + ' '+ productPrice,
                ProductImage: getProductImageUrl(product),
                ProductDiscountPrice: currencyCode + ' '+ (adjustedPrice / pli.quantityValue),
                
                // Use the global variable calculated above
                OrderDiscount: currencyCode + ' '+ (wholeOrderDiscount > 0 ? wholeOrderDiscount : 0), 
                
                ProductQuantity: pli.quantityValue,
                OrderDiscountCode: getOrderCoupon(order)
            });
        }
    }

    // 2. Build Payload
    var storeBaseUrl = Site.getCurrent().getCustomPreferenceValue('viewYourOrderLink');
    var orderLink = storeBaseUrl + order.orderNo;
    var sitePrefLocale = Site.getCurrent().getCustomPreferenceValue('locale');
    var finalLocale = sitePrefLocale ? sitePrefLocale : order.customerLocaleID;
    var apiBody = {
        ContactKey: order.customerEmail,
        EventDefinitionKey: eventDefinitionKey,
        Data: {
            ViewYourOrderLink: orderLink,
            OrderID: order.orderNo,
            VisitOurStoreLink: storeBaseUrl, 
            EmailAddress: order.customerEmail,
            FirstName: order.billingAddress.firstName,
            LastName: order.billingAddress.lastName,
            PhoneNumber: order.billingAddress.phone || "",
            Locale: finalLocale,
            OrderItems: JSON.stringify(orderItemsArray)
        }
    };

    // 3. Auth & Send
    var accessToken = getAccessToken();
    if (!accessToken) {
        return { success: false, error: 'Auth Failed' };
    }

    try {
        var sendCodeResult = marketingEmailService.marketingEmailService.call({
            accessToken: accessToken,
            body: apiBody
        });

        if (sendCodeResult.ok) {
            logger.info('Return Request Email Sent for Order {0}: {1}', order.orderNo, JSON.stringify(apiBody));
            return { success: true, result: sendCodeResult.object };
        } else {
            logger.error('Return Request Email Service Failed for Order {0}: {1}', order.orderNo, sendCodeResult.errorMessage);
            return { success: false, error: sendCodeResult.errorMessage };
        }
    } catch (e) {
        logger.error('Exception in sendReturnRequestEmail: {0}', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * Sends Return Rejected Email
 * @param {dw.order.Order} order 
 * @param {dw.util.Collection} plis - The ProductLineItems that were rejected
 */
function sendReturnRejectedEmail(order, plis) {
    var logger = Logger.getLogger('MarketingCloud', 'ReturnRejected');
    var eventDefinitionKey = Site.getCurrent().getCustomPreferenceValue('MCReturnRejectedEventKey');

    if (!eventDefinitionKey) {
        logger.error('Missing MCReturnRejectedEventKey Preference');
        return { success: false, error: 'Missing Preference' };
    }

    var currencyCode = order.getCurrencyCode();
    

    // 1. Calculate Whole Order Discount (Merchandise + Shipping Savings)
    var merchTotal = order.getMerchandizeTotalGrossPrice();
    var merchAdjusted = order.getAdjustedMerchandizeTotalGrossPrice();
    var totalMerchDiscount = merchTotal.subtract(merchAdjusted);

    var shippingTotal = order.getShippingTotalPrice();
    var shippingAdjusted = order.getAdjustedShippingTotalPrice();
    var totalShippingDiscount = shippingTotal.subtract(shippingAdjusted);

    // This value is now constant for all items in the payload
    var wholeOrderDiscount = totalMerchDiscount.add(totalShippingDiscount).value;

    // 2. Construct OrderItems JSON Array
    var orderItemsArray = [];
    var pliIter = plis.iterator();

    while (pliIter.hasNext()) {
        var pli = pliIter.next();
        var product = pli.product;

        if (product) {
            var productPrice = pli.basePrice.value;
            
            // For Rejected items, we display the price they *would* have paid (Adjusted Price)
            // We use standard SFCC adjustedPrice divided by quantity to get unit price
            var adjustedUnitPrice = pli.adjustedPrice.value / pli.quantityValue;

            orderItemsArray.push({
                ProductName: pli.productName,
                ProductVariantDetail: getVariantDetails(product),
                ProductPrice: currencyCode + ' ' + productPrice.toFixed(2), // Display formatted price if needed, or just number
                ProductImage: getProductImageUrl(product),
                ProductDiscountPrice: currencyCode + ' ' + adjustedUnitPrice.toFixed(2),
                
                // Using the global whole order discount calculated above
                OrderDiscount: currencyCode + ' ' + (wholeOrderDiscount > 0 ? wholeOrderDiscount.toFixed(2) : 0),
                
                ProductQuantity: pli.quantityValue,
                OrderDiscountCode: getOrderCoupon(order)
            });
        }
    }

    // 3. Build Payload
    var storeBaseUrl = Site.getCurrent().getCustomPreferenceValue('viewYourOrderLink');
    var orderLink = storeBaseUrl + order.orderNo;
    
    // Attempt to get tracking number from default shipment
    var trackingNumber = '';
    if (order.custom && order.custom.trackingNumber) {
        trackingNumber = order.custom.trackingNumber;
    }
    var sitePrefLocale = Site.getCurrent().getCustomPreferenceValue('locale');
    var finalLocale = sitePrefLocale ? sitePrefLocale : order.customerLocaleID;
    var apiBody = {
        ContactKey: order.customerEmail,
        EventDefinitionKey: eventDefinitionKey,
        Data: {
            ViewYourOrderLink: orderLink,
            OrderID: order.orderNo,
            EmailAddress: order.customerEmail,
            FirstName: order.billingAddress.firstName,
            LastName: order.billingAddress.lastName,
            PhoneNumber: order.billingAddress.phone || "",
            // Mapped per your JSON requirement
            UPSTrackingNumber: trackingNumber, 
            Locale: finalLocale,
            OrderItems: JSON.stringify(orderItemsArray)
        }
    };

    // 4. Auth & Send
    var accessToken = getAccessToken(); // Ensure this helper function exists in scope
    if (!accessToken) {
        return { success: false, error: 'Auth Failed' };
    }

    try {
        var sendCodeResult = marketingEmailService.marketingEmailService.call({
            accessToken: accessToken,
            body: apiBody
        });

        if (sendCodeResult.ok) {
            logger.info('Return Rejected Email Sent for Order {0}: {1}', order.orderNo, JSON.stringify(apiBody));
            return { success: true, result: sendCodeResult.object };
        } else {
            logger.error('Return Rejected Email Service Failed for Order {0}: {1}', order.orderNo, sendCodeResult.errorMessage);
            return { success: false, error: sendCodeResult.errorMessage };
        }
    } catch (e) {
        logger.error('Exception in sendReturnRejectedEmail: {0}', e.message);
        return { success: false, error: e.message };
    }
}
/**
 * Sends Welcome Email to a new customer
 * @param {dw.customer.Profile} profile - The profile of the logged-in customer
 */
function sendWelcomeEmail(email,phone,firstName,lastName) {
    var logger = Logger.getLogger('MarketingCloud', 'WelcomeEmail');
    var eventDefinitionKey = Site.getCurrent().getCustomPreferenceValue('MCWelcomeEventKey');

    if (!eventDefinitionKey) {
        logger.error('Missing MCWelcomeEventKey Preference');
        return { success: false, error: 'Missing Preference' };
    }

    // 1. Prepare Data
    // URLUtils.home().abs().toString() generates the full https://sotbella.com/ URL dynamically
    var homepageLink = Site.getCurrent().getCustomPreferenceValue('storefrontBaseUrl') || 'https://sotbella.com';
    
    // Fallback for phone number (Mobile -> Home -> Empty)
    
    var sitePrefLocale = Site.getCurrent().getCustomPreferenceValue('locale');
    var finalLocale = sitePrefLocale ? sitePrefLocale : request.locale;
    // 2. Build Payload
    var apiBody = {
        ContactKey: email,
        EventDefinitionKey: eventDefinitionKey,
        Data: {
            HomepageLink: homepageLink,
            EmailAddress: email,
            FirstName: firstName,
            LastName: lastName,
            PhoneNumber: phone,
            Locale: finalLocale
        }
    };

    // 3. Auth & Send
    var accessToken = getAccessToken(); // Assuming this helper exists
    if (!accessToken) {
        return { success: false, error: 'Auth Failed' };
    }

    try {
        var sendCodeResult = marketingEmailService.marketingEmailService.call({
            accessToken: accessToken,
            body: apiBody
        });

        if (sendCodeResult.ok) {
            logger.info('Welcome Email Sent for {0}: {1}', email, JSON.stringify(apiBody));
            return { success: true, result: sendCodeResult.object };
        } else {
            logger.error('Welcome Email Service Failed for {0}: {1}', email, sendCodeResult.errorMessage);
            return { success: false, error: sendCodeResult.errorMessage };
        }
    } catch (e) {
        logger.error('Exception in sendWelcomeEmail: {0}', e.message);
        return { success: false, error: e.message };
    }
}
/**
 * NEW: Sends Return Accepted Email
 * Uses refundHelper to calculate actual discounted prices for items and subtotal.
 * @param {dw.order.Order} order 
 * @param {dw.util.Collection} plis - The ProductLineItems accepted for return
 */
function sendReturnAcceptedEmail(order, plis) {
    var logger = Logger.getLogger('MarketingCloud', 'ReturnAccepted');
    var eventDefinitionKey = Site.getCurrent().getCustomPreferenceValue('MCReturnAcceptedEventKey');

    if (!eventDefinitionKey) {
        logger.error('Missing MCReturnAcceptedEventKey Preference');
        return { success: false, error: 'Missing Preference' };
    }

    var currencyCode = order.getCurrencyCode();
    

    // 1. Calculate Subtotal using the Refund Helper
    var runningSubtotal = 0;

    // 2. Construct OrderItems JSON Array
    var orderItemsArray = [];
    var pliIter = plis.iterator();

    while (pliIter.hasNext()) {
        var pli = pliIter.next();
        var product = pli.product;

        if (product) {
            var qty = pli.quantityValue;
            
            // USE HELPER: Calculate the actual paid amount for this line item (Total for the Qty)
            // 'false' indicates we are not in a cancellation context, just calculating value
            var calculatedLineTotal = refundHelper.calculateRefundAmount(order, pli.productID, false);
            
            // Calculate Unit Price based on the discounted total
            var unitDiscountedPrice = calculatedLineTotal / qty;

            // Add the true discounted total to the email subtotal
            runningSubtotal += calculatedLineTotal;

            orderItemsArray.push({
                ProductName: pli.productName,
                ProductVariantDetail: getVariantDetails(product),
                ProductImage: getProductImageUrl(product),
                ProductQuantity: qty,
                // Requirement: ProductPrice should be the discounted price
                ProductPrice: currencyCode + ' '+ unitDiscountedPrice 
            });
        }
    }

    // 3. Build Payload
    var storeBaseUrl = Site.getCurrent().getCustomPreferenceValue('viewYourOrderLink');
    var orderLink = storeBaseUrl + order.orderNo;
    
    // Attempt to get tracking number
    var trackingNumber = '';
    if (order.custom && order.custom.trackingNumber) {
        trackingNumber = order.custom.trackingNumber;
    }
    var sitePrefLocale = Site.getCurrent().getCustomPreferenceValue('locale');
    var finalLocale = sitePrefLocale ? sitePrefLocale : order.customerLocaleID;

    var apiBody = {
        ContactKey: order.customerEmail,
        EventDefinitionKey: eventDefinitionKey,
        Data: {
            ViewYourOrderLink: orderLink,
            OrderID: order.orderNo,
            EmailAddress: order.customerEmail,
            FirstName: order.billingAddress.firstName,
            LastName: order.billingAddress.lastName,
            PhoneNumber: order.billingAddress.phone || "",
            UPSTrackingNumber: trackingNumber,
            Locale: finalLocale,
            Subtotal: currencyCode + ' '+ runningSubtotal, // This now reflects the sum of discounted item prices
            OrderItems: JSON.stringify(orderItemsArray)
        }
    };

    // 4. Auth & Send
    var accessToken = getAccessToken();
    if (!accessToken) {
        return { success: false, error: 'Auth Failed' };
    }

    try {
        var sendCodeResult = marketingEmailService.marketingEmailService.call({
            accessToken: accessToken,
            body: apiBody
        });

        if (sendCodeResult.ok) {
            logger.info('Return Accepted Email Sent for Order {0}: {1}', order.orderNo, JSON.stringify(apiBody));
            return { success: true, result: sendCodeResult.object };
        } else {
            logger.error('Return Accepted Email Service Failed for Order {0}: {1}', order.orderNo, sendCodeResult.errorMessage);
            return { success: false, error: sendCodeResult.errorMessage };
        }
    } catch (e) {
        logger.error('Exception in sendReturnAcceptedEmail: {0}', e.message);
        return { success: false, error: e.message };
    }
}


/**
 * Formats address to string with HTML line breaks
 */
function formatAddress(address) {
    if (!address) return '';
    var parts = [];
    var name = (address.getFirstName() || '') + ' ' + (address.getLastName() || '');
    if (name.trim()) parts.push(name.trim());
    if (address.getAddress1()) parts.push(address.getAddress1());
    if (address.getAddress2()) parts.push(address.getAddress2());
    var csz = (address.getCity() || '') + (address.getStateCode() ? ', ' + address.getStateCode() : '') + (address.getPostalCode() ? ' ' + address.getPostalCode() : '');
    if (csz.trim()) parts.push(csz);
    if (address.getCountryCode()) parts.push(address.getCountryCode().getDisplayValue());
    return parts.join('<br>');
}
/**
 * REFACTORED: Builds updated order items array matching the specific payload requirements
 */
function buildOrderItems(productLineItems, order) {
    var items = [];
    var pliIter = productLineItems.iterator();
    var currencyCode = order.getCurrencyCode();
    while (pliIter.hasNext()) {
        var pli = pliIter.next();
        var product = pli.getProduct();

        // 1. Variant Details
        var variantDetailString = '';
        if (product && product.isVariant()) {
            variantDetailString = getVariantDetails(product);
        }

        // 2. Coupon Code for this item
        var itemCoupon = "";
        var adjustments = pli.getPriceAdjustments().iterator();
        if (adjustments.hasNext()) {
            var adj = adjustments.next();
            itemCoupon = adj.couponLineItem ? adj.couponLineItem.couponCode : (adj.promotionID || "");
        }

        // 3. Price Calculations
        // Base Price (Unit Price before discount)
        var unitBasePrice = pli.getBasePrice().getValue();

        // Prorated Price (Total Price for quantity after all discounts)
        var totalProratedPrice = pli.getProratedPrice().getValue();
        var quantity = pli.getQuantityValue();

        // Discounted Unit Price
        var unitDiscountedPrice = totalProratedPrice / quantity;

        // Total Discount Amount for this line item
        var itemTotalDiscount = (unitBasePrice * quantity) - totalProratedPrice;

        items.push({
            ProductName: pli.getProductName(),
            ProductVariantDetail: variantDetailString,
            ProductPrice: currencyCode + ' ' + unitBasePrice, // Numeric: 1999
            ProductImage: (product && product.getImage('large', 0)) ? product.getImage('large', 0).getAbsURL().toString() : '',
            ProductDiscountPrice: currencyCode + ' '+ unitDiscountedPrice, // Numeric: 1499
            OrderDiscount: currencyCode + ' '+ (itemTotalDiscount > 0 ? itemTotalDiscount : 0), // Numeric: 500
            ProductQuantity: quantity,
            OrderDiscountCode: itemCoupon // "WELCOME500"
        });
    }
    return items;
}

/**
 * REFACTORED: Sends the updated Order Confirmation Email
 */
function sendOrderConfirmMail(order) {
    var logger = Logger.getLogger('MarketingCloud', 'OrderConfirm');

    try {
        if (!order) return { success: false, error: 'Order is null' };

        var currentSite = Site.getCurrent();
        var eventKey = currentSite.getCustomPreferenceValue('MCOrderConfirmEventKey');
        var storeBaseUrl = currentSite.getCustomPreferenceValue('viewYourOrderLink');

        if (!eventKey) {
            logger.error('Site Preference MCOrderConfirmEventKey is missing.');
            return { success: false, error: 'Missing Configuration' };
        }

        var orderLink = storeBaseUrl + order.orderNo;
        var defaultShipment = order.getDefaultShipment();
        var currencyCode = order.getCurrencyCode(); // Get Symbol like "$"

        // =========================================================================
        // UPDATED CALCULATION LOGIC START
        // =========================================================================

        // 1. TotalPrice (Merchandise Net Price - Sum of all items before discount)
        var totalPriceVal = order.getMerchandizeTotalNetPrice().getValue();

        // 2. Shipping (Net Price)
        var shippingPriceVal = order.getShippingTotalNetPrice().getValue();

        // 3. Total Discount (Merchandise Discount + Shipping Discount)
        var merchDiscount = order.getMerchandizeTotalNetPrice().getValue() - order.getAdjustedMerchandizeTotalNetPrice().getValue();
        var shippingDiscount = order.getShippingTotalNetPrice().getValue() - order.getAdjustedShippingTotalNetPrice().getValue();
        var totalDiscountVal = merchDiscount + shippingDiscount;

        // 4. Taxes (Total Tax - Automatically includes Shipping & Merch Tax)
        var taxesVal = order.getTotalTax().getValue();

        // 5. Total Paid (Gross Price - Final amount customer pays)
        var totalPaidGross = order.getTotalGrossPrice().getValue();

        // 6. Saved Value (Original Gross - Final Paid Gross)
        var totalSavedValue = (order.getMerchandizeTotalGrossPrice().getValue() + order.getShippingTotalGrossPrice().getValue()) - totalPaidGross;

        // Get Coupon Codes (Preserving your existing helper calls)
        var shippingDiscountCode = getShippingDiscountCode(order);
        var orderDiscountCode = "";

        // Logic to get Order Coupon (Preserving your existing logic)
        var orderPriceAdjustments = order.getPriceAdjustments().iterator();
        while (orderPriceAdjustments.hasNext()) {
            var opa = orderPriceAdjustments.next();
            if (!orderDiscountCode) {
                orderDiscountCode = opa.couponLineItem ? opa.couponLineItem.couponCode : opa.promotionID;
            }
        }
        if (!orderDiscountCode) {
            orderDiscountCode = getOrderCoupon(order);
        }

        // =========================================================================
        // UPDATED CALCULATION LOGIC END
        // =========================================================================

        var sitePrefLocale = Site.getCurrent().getCustomPreferenceValue('locale');
        // Fallback to order locale OR request locale if order locale is missing
        var finalLocale = sitePrefLocale ? sitePrefLocale : order.customerLocaleID;

        // --- 5. Prepare Payload ---
        var apiBody = {
            ContactKey: order.getCustomerEmail(),
            EventDefinitionKey: eventKey,
            Data: {
                ViewYourOrderLink: orderLink,
                OrderID: parseInt(order.orderNo, 10) || order.orderNo, // Ensure numeric if possible, else string
                VisitOurStoreLink: storeBaseUrl,

                // Addresses with <br>
                ShippingAddress: formatAddress(defaultShipment.getShippingAddress()),
                BillingAddress: formatAddress(order.getBillingAddress()),

                ShippingMethod: defaultShipment.getShippingMethod() ? defaultShipment.getShippingMethod().getDisplayName() : 'Standard Shipping',
                EmailAddress: order.getCustomerEmail(),
                FirstName: order.getBillingAddress().getFirstName() || '',
                LastName: order.getBillingAddress().getLastName() || '',

                // =================================================================
                // UPDATED FIELDS MAPPING
                // =================================================================

                // 1. TotalPrice (Merch Net)
                TotalPrice: currencyCode + ' ' + totalPriceVal.toFixed(2),

                // 2. ShippingPrice (Net)
                ShippingPrice: currencyCode + ' ' + shippingPriceVal.toFixed(2),

                // 3. Taxes (Total)
                Taxes: currencyCode + ' ' + taxesVal.toFixed(2),

                // 4. OrderDiscount (Total Savings calculated above)
                OrderDiscount: currencyCode + ' ' + totalDiscountVal.toFixed(2),
                // 5. TotalAmount (Final Pay)
                TotalAmount: currencyCode + ' ' + totalPaidGross.toFixed(2),

                // 6. SavedValue
                SavedValue: currencyCode + ' ' + totalSavedValue.toFixed(2),

                // 7. Subtotal (Mapped to Adjusted Merch Net - Standard Subtotal view)
                Subtotal: currencyCode + ' ' + order.getAdjustedMerchandizeTotalNetPrice().getValue().toFixed(2),

                // Other Fields
                ShippingDiscount: currencyCode + ' ' + shippingDiscount.toFixed(2), // Optional: If you still need specifically shipping discount value
                ShippingDiscountCode: shippingDiscountCode,
                PhoneNumber: order.getBillingAddress().getPhone() || '',
                Locale: finalLocale,
                OrderDiscountCode: orderDiscountCode,

                // JSON Stringified Array
                OrderItems: JSON.stringify(buildOrderItems(order.getProductLineItems(), order))
            }
        };

        var token = getAccessToken();
        if (!token) return { success: false, error: 'Authentication failed' };

        var result = marketingEmailService.marketingEmailService.call({
            accessToken: token,
            body: apiBody
        });
        logger.info('Order Confirm API Body for Order {0}: {1}', order.orderNo, JSON.stringify(apiBody));

        if (result.ok) {
            logger.info('Order Confirmation Email Sent for Order: ' + order.orderNo);
            return { success: true };
        }

        logger.error('Service Error for Order {0}: {1}', order.orderNo, result.errorMessage);
        return { success: false, error: result.errorMessage };

    } catch (e) {
        logger.error('Exception in sendOrderConfirmMail: {0} \n {1}', e.message, e.stack);
        return { success: false, error: e.message };
    }
}
/**
 * Helper to build the Tracking Link based on Provider JSON mapping
 */
function getTrackingLink(order) {
    var Site = require('dw/system/Site');
    var trackingLink = '';
    
    try {
        var providerJsonString = Site.getCurrent().getCustomPreferenceValue('trackingLinks'); 
        var trackingNumber = order.custom.trackingNumber;
        var provider = order.custom.shippingProvider; // e.g., "SHIPROCKET"

        // if(provider == 'SELF') return 'https://shiprocket.co/tracking/' + trackingNumber

        if (providerJsonString && trackingNumber && provider) {
            var providerMap = JSON.parse(providerJsonString);
            var baseUrl = providerMap[provider]; // Look up the URL (e.g., https://shiprocket.co/tracking/)
            
            if (baseUrl) {
                trackingLink = baseUrl + trackingNumber;
            }
        }
    } catch (e) {
        Logger.getLogger('MarketingCloud', 'ShippingConfirm').error('Error parsing shippingProviderLinks: ' + e.message);
    }
    
    return trackingLink;
}

/**
 * Builds specific item array for Shipping Confirmation
 */
function buildShippingItems(productLineItems) {
    var items = [];
    var pliIter = productLineItems.iterator();

    while (pliIter.hasNext()) {
        var pli = pliIter.next();
        var product = pli.getProduct();
        
        items.push({
            ProductName: pli.getProductName(),
            ProductVariantDetail: getVariantDetails(product),
            ProductImage: getProductImageUrl(product),
            ProductQuantity: pli.getQuantityValue()
        });
    }
    return items;
}

/**
 * Sends Shipping Confirmation Email
 */
function sendShippingConfirmMail(order, productLineItems) {
    var logger = Logger.getLogger('MarketingCloud', 'ShippingConfirm');

    try {
        if (!order || !productLineItems) return { success: false, error: 'Missing Order or PLIs' };

        var currentSite = Site.getCurrent();
        var eventKey = currentSite.getCustomPreferenceValue('MCShippingConfirmEventKey');
        
        if (!eventKey) {
            logger.error('Site Preference MCShippingConfirmEventKey is missing.');
            return { success: false, error: 'Missing Configuration' };
        }

        var trackingNumber = order.custom.trackingNumber || '';
        var trackingLink = getTrackingLink(order);
        var sitePrefLocale = Site.getCurrent().getCustomPreferenceValue('locale');
        // Fallback to order locale OR request locale if order locale is missing
        var finalLocale = sitePrefLocale ? sitePrefLocale : order.customerLocaleID ;

        var apiBody = {
            ContactKey: order.getCustomerEmail(),
            EventDefinitionKey: eventKey,
            Data: {
                ViewYourOrderLink: currentSite.getCustomPreferenceValue('viewYourOrderLink') + order.orderNo,
                OrderID: order.orderNo,
                EmailAddress: order.customerEmail,
                FirstName: order.getBillingAddress().getFirstName() || '',
                LastName: order.getBillingAddress().getLastName() || '',
                PhoneNumber: order.getBillingAddress().getPhone() || '',
                UPSTrackingNumber: trackingNumber,
                Locale: finalLocale,
                ShippingStatus: "Shipped", 
                TrackingLink: trackingLink,
                OrderItems: JSON.stringify(buildShippingItems(productLineItems))
            }
        };

        var token = getAccessToken();
        if (!token) return { success: false, error: 'Auth Failed' };

        var result = marketingEmailService.marketingEmailService.call({
            accessToken: token,
            body: apiBody
        });

        if (result.ok) {
            logger.info('Shipping Confirmation Sent for Order: ' + order.orderNo + ' | Provider: ' + order.custom.shippingProvider);
            return { success: true };
        }

        logger.error('Service Error for Order {0}: {1}', order.orderNo, result.errorMessage);
        return { success: false, error: result.errorMessage };

    } catch (e) {
        logger.error('Exception in sendShippingConfirmMail: {0} \n {1}', e.message, e.stack);
        return { success: false, error: e.message };
    }
}

module.exports = {
    sendOrderDeliveredEmail: sendOrderDeliveredEmail,
    sendOrderCancellationEmail: sendOrderCancellationEmail,
    sendRefundEmail:sendRefundEmail,
    sendReturnRequestEmail:sendReturnRequestEmail,
    sendReturnRejectedEmail:sendReturnRejectedEmail,
    sendWelcomeEmail:sendWelcomeEmail,
    sendReturnAcceptedEmail:sendReturnAcceptedEmail,
    sendOrderConfirmMail: sendOrderConfirmMail,
    sendShippingConfirmMail: sendShippingConfirmMail
};
