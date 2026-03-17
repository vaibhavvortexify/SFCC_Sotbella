'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');
var System = require('dw/system/System');


/**
 * Helper: Build Unicommerce Sale Order Body
 * @param {dw.order.Order} order
 * @returns {Object} request body
 */
function buildUnicommerceSaleOrderBody(order) {

    // var pref = Site.getCurrent().getPreferences().getCustom();
    var orgPrefs = System.getPreferences().getCustom();
    var fulfillmentHours = orgPrefs.UnicommerceFulfillmentTatHours || 48; 

    var now = new Date();
    var fulfillmentDate = new Date(now.getTime() + (fulfillmentHours * 60 * 60 * 1000));

    // ---- Customer & Address ----
    var shipping = order.defaultShipment.shippingAddress;
    var customerEmail = '';
    var customerPhone = '';
    if (order) {
        if (order.customer && order.customer.profile) {
            customerEmail = order.customer.profile.email;
            customerPhone = order.customer.profile.phoneMobile;
        }
    }
    var addressId = shipping.UUID;

    var addresses = [{
        id: addressId,
        name: shipping.fullName,
        addressLine1: shipping.address1,
        city: shipping.city,
        state: shipping.stateCode,
        country: shipping.countryCode.value,
        pincode: shipping.postalCode,
        phone: customerPhone,
        email: customerEmail
    }];

    // ---- Build Sale Order Items with Quantity Logic ----
    var saleOrderItems = [];
    var pliIter = order.productLineItems.iterator();

    while (pliIter.hasNext()) {
        var pli = pliIter.next();

        var quantity = pli.quantityValue;  // e.g. 2
        var sku = pli.productID;

        // Create N items for quantity
        for (var i = 0; i < quantity; i++) {
            saleOrderItems.push({
                itemSku: sku,
                shippingMethodCode: 'STD',
                code: order.orderNo + '-' + pli.getUUID() + '-' + (i + 1),
                totalPrice: String(pli.getBasePrice().value),
                sellingPrice: String(pli.getBasePrice().value),
                prepaidAmount: "0",
                facilityCode: orgPrefs.UnicommerceFacility
            });
        }
    }

    // ---- Final Body ----
    return {
        saleOrder: {
            code: order.orderNo,
            displayOrderCode: order.orderNo,
            displayOrderDateTime: now.toISOString(),
            channelProcessingTime: now.toISOString(),

            customerName: order.customerName,
            channel: (Site.getCurrent().getID()).toUpperCase(),

            notificationEmail: customerEmail,
            notificationMobile: customerPhone,
            cashOnDelivery:
                order.paymentInstrument &&
                order.paymentInstrument.paymentMethod === "COD",

            addresses: addresses,

            billingAddress: { referenceId: addressId },
            shippingAddress: { referenceId: addressId },

            saleOrderItems: saleOrderItems,

            currencyCode: order.getCurrencyCode(),
            taxExempted: false,
            cformProvided: false,
            fulfillmentTat: fulfillmentDate.toISOString(),
            verificationRequired: false,
            priority: 0,

            totalDiscount: order.merchandizeTotalPrice.value - order.adjustedMerchandizeTotalPrice.value,
            totalShippingCharges: order.shippingTotalPrice.value,
            totalCashOnDeliveryCharges: 0,
            totalGiftWrapCharges: 0,
            totalStoreCredit: 0,
            totalPrepaidAmount: 0
        }
    };
}




/**
 * Calls Unicommerce Create order API
 * @returns {Object} response object
 */

function createSaleOrder(order, accessToken) {

    var callbacks = {
        createRequest: function (svc) {
            // var pref = Site.getCurrent().getPreferences().getCustom();
            var orgPrefs = System.getPreferences().getCustom();


            svc.addHeader('Authorization', 'Bearer ' + accessToken);
            svc.addHeader('Facility', orgPrefs.UnicommerceFacility);

            svc.addHeader('Content-Type', 'application/json');
            svc.setRequestMethod('POST');

            var credential = svc.getConfiguration().getCredential();
            var baseURL = credential.getURL();
            var fullURL = baseURL + '/services/rest/v1/oms/saleOrder/create';
            svc.setURL(fullURL);
            var a = order;
            var body = buildUnicommerceSaleOrderBody(order);
            return JSON.stringify(body);
        },
        parseResponse: function (svc, client) {
            return JSON.parse(client.text);
        },
        mockCall: function () {
            return {
                ok: true,
                object: {
                    saleOrderCode: 'SO123456',
                    status: 'Created'
                }
            };
        }
    }

    return LocalServiceRegistry.createService('unicommerce.service', callbacks).call();
}

module.exports = {
    createSaleOrder: createSaleOrder
};