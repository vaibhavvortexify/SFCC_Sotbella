'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var RESTResponseMgr = require('dw/system/RESTResponseMgr');
var Logger = require('dw/system/Logger');
var ProductMgr = require('dw/catalog/ProductMgr');
var ProductFactory = require('*/cartridge/scripts/factories/product');
var System = require('dw/system/System');

/**
 * Converts a dw.order.Order object into a plain JSON structure.
 */
function serializeOrder(order) {
    var orderJSON = {
        orderNo: order.orderNo,
        creationDate: order.creationDate,
        currencyCode: order.currencyCode,
        totalGrossPrice: order.totalGrossPrice ? order.totalGrossPrice.value : 0,
        customerEmail: order.customerEmail,
        orderStatus: order.custom.orderStatus.displayValue,
        paymentStatus: order.paymentStatus.displayValue,
        shippingStatus: order.shippingStatus.displayValue,
        c_paymentMethods: [],
        shipments: [],
        productLineItems: [],
        status: order.status.displayValue
    };

    // Add payment methods info
    try {
        var payments = order.getPaymentInstruments().iterator();
        while (payments.hasNext()) {
            var payment = payments.next();
            orderJSON.c_paymentMethods.push({
                paymentMethod: payment.paymentMethod,
                amount: payment.paymentTransaction.amount ? payment.paymentTransaction.amount.value : 0
            });
        }
    } catch (error) {
        Logger.error("Error while fetching payment methods: " + error.message);
    }

    // Add shipment info
    var shipments = order.shipments.iterator();
    while (shipments.hasNext()) {
        var shipment = shipments.next();
        orderJSON.shipments.push({
            shipmentNo: shipment.shipmentNo,
            shippingMethod: shipment.shippingMethod ? shipment.shippingMethod.displayName : null,
            shippingStatus: shipment.shippingStatus.displayValue,
            shippingCost: shipment.shippingTotalPrice ? shipment.shippingTotalPrice.value : 0
        });
    }

    // Add product line items info
    var items = order.productLineItems.iterator();
    while (items.hasNext()) {
        var item = items.next();
        var product = ProductMgr.getProduct(item.productID);
        var apiProduct = ProductFactory.get({
            pid: product.ID,
            pview: 'order', // context view (optional)
            variations: true,
            quantity: item.quantity.value
        });
        orderJSON.productLineItems.push({
            productID: item.productID,
            productName: item.productName,
            quantity: item.quantity.value,
            price: item.price.value,
            adjustedPrice: item.adjustedGrossPrice ? item.adjustedGrossPrice.value : null,
            lineItemText: item.lineItemText,
            c_images:apiProduct.images,
            c_variationAttributes:apiProduct.variationAttributes,
            c_shortDescription: product.shortDescription ? product.shortDescription.source : null,
            lineItemStatus: item.custom.lineItemStatus ? item.custom.lineItemStatus.displayValue : '-'
        });
    }

    return orderJSON;
}

/**
 * Load global preference JSON safely
 */
function loadJSONPref(prefID) {
    try {
        var orgPrefs = System.getPreferences().getCustom();
        var raw = orgPrefs[prefID];
        if (raw) {
            return JSON.parse(raw);
        }
    } catch (e) {
        Logger.error('Invalid JSON in preference {0}: {1}', prefID, e.message);
    }
    return {};
}

/**
 * Fetch orders for the current customer with optional status filter and pagination.
 */
exports.getOrdersData = function () {
    var req = request;
    var customer = req.session.customer;
    // var params = req.httpParameters;
    var requestBody = request.httpParameterMap.requestBodyAsString;

    var requestJSON;
    try {
        requestJSON = JSON.parse(requestBody);
    } catch (e) {
        return { success: false, message: 'Invalid JSON Body' };
    }

    var limit = parseInt(requestJSON.limit || 10, 10);
    var offset = parseInt(requestJSON.offset || 0, 10);
    var failedOrders = requestJSON.hasOwnProperty('failedOrders') ? requestJSON.failedOrders : true;

    if (limit < 0 || offset < 0) {
        return { success: false, message: 'Limit and offset must be non-negative integers' };
    }

    var status = requestJSON.status ? requestJSON.status.trim() : null;

    // Default response if not authenticated
    if (!customer || !customer.authenticated || !customer.profile) {
        return { success: false, message: 'Customer not authenticated' };
    }

    var customerNo = customer.profile.customerNo;
    var query = "customerNo = {0}";
    var args = [customerNo];

    if (failedOrders === false) {
        var Order = require('dw/order/Order');
        query += " AND status != {" + args.length + "}";
        args.push(Order.ORDER_STATUS_FAILED); // This is system status 8
    }

    var statusMap = loadJSONPref('orderStatusJSON');
    var filterApplied = false;

    if (status) {
        if (!statusMap.hasOwnProperty(status)) {
            return { success: false, message: 'Invalid status filter' };
        }

        // Use args.length to ensure we use the correct next placeholder (e.g., {1} or {2})
        query += " AND custom.orderStatus = {" + args.length + "}";
        args.push(statusMap[status]);
        filterApplied = true;
    }
    Logger.info("Executing Order Search | Query: {0} | Args: {1}", query, args.join(', '));

    var ordersIter = OrderMgr.searchOrders(query, "creationDate desc", args);
    var allOrders = [];

    if (ordersIter) {
        while (ordersIter.hasNext()) {
            allOrders.push(ordersIter.next());
        }
        ordersIter.close();
    }

    if (allOrders.length === 0) {
        return { limit: 0, offset: 0, orders: [] };
    }

    // Apply pagination
    var paginatedOrders = allOrders.slice(offset, offset + limit);

    // Build response
    var responseData = {
        limit: limit,
        offset: offset,
        orders: paginatedOrders.map(function (order) {
            return { OrderData: serializeOrder(order) };
        })
    };

    if (filterApplied) {
        responseData.filter = status;
    }

    return responseData;
};

/**
 * REST endpoint entry point
 */
exports.getOrders = function () {
    RESTResponseMgr.createSuccess(exports.getOrdersData()).render();
};

exports.getOrders.public = true;
