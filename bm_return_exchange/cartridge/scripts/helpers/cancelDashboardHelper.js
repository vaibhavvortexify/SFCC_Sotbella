'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var System = require('dw/system/System');
var StringUtils = require('dw/util/StringUtils');
var Currency = require('dw/util/Currency');
var Transaction = require('dw/system/Transaction');
var RefundHelper = require('*/cartridge/scripts/helpers/refundHelper');


function loadJSONPref(prefID) {
    var raw = System.getPreferences().getCustom()[prefID];
    return raw ? JSON.parse(raw) : {};
}

function mapCancelAttributes(order, pli) {
    var imageUrl = '';
    if (pli.product && pli.product.getImage('large', 0)) {
        imageUrl = pli.product.getImage('large', 0).getAbsURL().toString();
    }

    var finalPrice = RefundHelper.calculateRefundAmount(order, pli.productID, false);

    var paymentMethodName = 'N/A';
    var paymentMethodID = 'N/A';
    var paymentInstruments = order.getPaymentInstruments();
    if (paymentInstruments.length > 0) {
        var pi = paymentInstruments[0];
        // Attempt to get the display name from PaymentMgr, fallback to technical ID
        var method = dw.order.PaymentMgr.getPaymentMethod(pi.getPaymentMethod());
        paymentMethodName = method ? method.getName() : pi.getPaymentMethod();
        paymentMethodID = pi.getPaymentMethod();
    }

    var oAddress = order.getBillingAddress() || order.getShippingAddress();
    var orderAddress = '';

    if (oAddress) {
        var parts = [];
        if (oAddress.getAddress1()) parts.push(oAddress.getAddress1());
        if (oAddress.getAddress2()) parts.push(oAddress.getAddress2());
        if (oAddress.getCity()) parts.push(oAddress.getCity());
        if (oAddress.getStateCode()) parts.push(oAddress.getStateCode());
        if (oAddress.getPostalCode()) parts.push(oAddress.getPostalCode());
        if (oAddress.getCountryCode()) parts.push(oAddress.getCountryCode());
        orderAddress = parts.join(', ');
    }

    var currencyCode = order.getCurrencyCode();
    var currencySymbol = Currency.getCurrency(currencyCode).getSymbol();

    var customerPhone = '';
    var customerEmail = order.customerEmail; // Default to the email on the order object

    if (order.customer && order.customer.profile) {
        customerPhone = order.customer.profile.phoneMobile || order.customer.profile.phoneHome || '';
        customerEmail = order.customer.profile.email || order.customerEmail;
    } else {
        var defaultShipment = order.getDefaultShipment(); // Get the primary shipment
        if (defaultShipment && defaultShipment.getShippingAddress()) {
            customerPhone = defaultShipment.getShippingAddress().getPhone() || '';
        }
    }

    return {
        orderNo: order.orderNo,
        lineItemId: pli.UUID,
        sku: pli.productID,
        productName: pli.productName,
        productImage: imageUrl,
        status: pli.custom.lineItemStatus ? pli.custom.lineItemStatus.value : null,
        displayStatus: pli.custom.lineItemStatus ? pli.custom.lineItemStatus.displayValue : null,
        quantity: pli.quantityValue,
        price: pli.price.available ? pli.price.value : 0,
        singlePrice: pli.basePrice.available ? pli.basePrice.value : 0,
        finalPrice: finalPrice,
        customerName: order.customerName,
        customerPhone: customerPhone,
        orderAddress: orderAddress,
        customerEmail: customerEmail,
        paymentMethod: paymentMethodName,
        paymentMethodID: paymentMethodID,
        creationDate: StringUtils.formatDate(order.creationDate, 'dd-MM-yyyy'),
        description: pli.custom.Description || '',
        reason: pli.custom.Reason || '',
        currencySymbol: currencySymbol,
        cancellationDate: pli.custom.cancellationDate ? StringUtils.formatDate(pli.custom.cancellationDate, 'dd-MM-yyyy') : null,
        BankName: order.custom.BankName || 'Bank Name Not Provided',
        BankMobileNumber: order.custom.MobileNumber || 'Mobile Number Not Provided',
        BankAccountNumber: order.custom.AccountNumber || 'Account Number Not Provided',
        BankifscCode: order.custom.ifscCode || 'IFSC Code Not Provided'
    };
}

function getCancelledItemsData(startDate, endDate, tabStatus) {
    var orderStatusMap = loadJSONPref('orderStatusJSON');
    var lineItemStatusMap = loadJSONPref('lineItemStatusJSON');
    var filteredItems = [];

    // Search for New or Open orders that are cancelled at line level
    var orders = OrderMgr.searchOrders(
        '(status={0} OR status={1}) AND (creationDate >= {2} AND creationDate <= {3})',
        'creationDate desc', 
        Order.ORDER_STATUS_NEW, Order.ORDER_STATUS_OPEN, startDate, endDate
    );

    try {
        while (orders.hasNext()) {
            var order = orders.next();
            var plis = order.getAllProductLineItems();
            var x = plis;
            for (var i = 0; i < plis.length; i++) {
                var pli = plis[i];
                var statusValue = pli.custom.lineItemStatus ? pli.custom.lineItemStatus.value : null;

                var isMatch = false;
                if (tabStatus === 'cancelled') {
                    isMatch = (statusValue === lineItemStatusMap["CANCELLED"]);
                } else if (tabStatus === 'refunded') {
                    isMatch = (statusValue === lineItemStatusMap["CANCELLED AND REFUNDED"]);
                }

                if (isMatch) filteredItems.push(mapCancelAttributes(order, pli));
            }
        }
    } finally { orders.close(); }
    return filteredItems;
}

function updateStatusToCancelledRefunded(order, pli, amount, details) {
    var lineItemStatusMap = loadJSONPref('lineItemStatusJSON');
    try {
        Transaction.wrap(function () {
            pli.custom.lineItemStatus = lineItemStatusMap["CANCELLED AND REFUNDED"];
            order.custom.UpdateFlowFlag = true;
        });
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

module.exports = {
    getCancelledItemsData: getCancelledItemsData,
    updateStatusToCancelledRefunded: updateStatusToCancelledRefunded,
    loadJSONPref: loadJSONPref
};