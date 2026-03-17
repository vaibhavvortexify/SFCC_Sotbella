'use strict';

var Transaction = require('dw/system/Transaction');
var BasketMgr = require('dw/order/BasketMgr');
var ProductMgr = require('dw/catalog/ProductMgr');
var HookMgr = require('dw/system/HookMgr');
var Money = require('dw/value/Money');
var Status = require('dw/system/Status');
var Site = require('dw/system/Site');
var RefundHelper = require('*/cartridge/scripts/helpers/refundHelper');
var emailHelper = require('*/cartridge/scripts/helpers/emailHelper');
var ArrayList = require('dw/util/ArrayList');

/* =========================================================================
   UTILITY FUNCTIONS
   ========================================================================= */


/**
 * Validates if the item is in an eligible status for Return/Exchange.
 * Blocks items that are already Cancelled, Returned, or in an Exchange flow.
 */

function validateItemStatus(order, itemId) {
    // List of statuses that block a new request
    var BLOCKED_STATUSES = [
        3,  // CANCELLED
        16, // EXCHANGED
        17, // RETURNED
        18, // RETURN REQUESTED
        19, // RETURN ACCEPTED
        // 20, // RETURN REJECTED (Usually blocks new auto-requests, depends on business rule)
        21, // EXCHANGE REQUESTED
        22, // EXCHANGE REJECTED
        23, // EXCHANGE ACCEPTED
        24, // CANCELLED AND REFUNDED
        25, // RETURN INITIATED
        26, // EXCHANGE INITIATED
        27, // RETURNED AND REFUNDED
        28, // EXCHANGED AND REFUNDED
        29  // EXCHANGED AND CANCELLED
    ];

    var plis = order.getProductLineItems().iterator();
    while (plis.hasNext()) {
        var pli = plis.next();

        if (pli.productID === itemId) {
            // Check if status exists and is in the blocked list
            if ('lineItemStatus' in pli.custom && pli.custom.lineItemStatus != null) {
                var currentStatus = pli.custom.lineItemStatus;

                // If current status is in our blocked list
                if (BLOCKED_STATUSES.indexOf(currentStatus.value) !== -1) {
                    return {
                        allowed: false,
                        message: "Request rejected: Item is already in status " + currentStatus.displayValue + "."
                    };
                }
            }
            // If status is 0-15 (e.g. DELIVERED=5), it is valid.
            return { allowed: true };
        }
    }

    // Fallback if item not found (though item existence is usually checked before this)
    return { allowed: false, message: "Item not found in order." };
}

/**
 * Copies address fields from source to target
 */
function copyAddress(sourceAddress, targetAddress) {
    targetAddress.setFirstName(sourceAddress.firstName);
    targetAddress.setLastName(sourceAddress.lastName);
    targetAddress.setAddress1(sourceAddress.address1);
    targetAddress.setAddress2(sourceAddress.address2);
    targetAddress.setCity(sourceAddress.city);
    targetAddress.setPostalCode(sourceAddress.postalCode);
    targetAddress.setStateCode(sourceAddress.stateCode);
    targetAddress.setCountryCode(sourceAddress.countryCode);
    targetAddress.setPhone(sourceAddress.phone);
}

function validateRequestWindow(order, actionType, itemId) {
    var deadlineDays = 0;
    var preferenceId = '';

    // 1. Determine Site Preference
    if (actionType === 'RETURN') {
        preferenceId = 'orderReturnDeadline';
    } else if (actionType === 'EXCHANGE-SAME' || actionType === 'EXCHANGE-DIFFERENT') {
        preferenceId = 'orderExchangeDeadline';
    }

    // 2. Get Deadline Config
    var prefs = Site.getCurrent().getPreferences().getCustom();
    if (preferenceId in prefs && prefs[preferenceId]) {
        deadlineDays = prefs[preferenceId];
    }

    // If no deadline configured, allow it (or block it depending on your business rule)
    if (!deadlineDays) {
        return { allowed: true };
    }

    // 3. Find the Specific PLI and its Delivered Date
    var deliveredDate = null;
    var itemFound = false;
    var plis = order.getProductLineItems().iterator();

    while (plis.hasNext()) {
        var pli = plis.next();
        if (pli.productID === itemId) {
            itemFound = true;
            if ('deliveredDate' in pli.custom && pli.custom.deliveredDate) {
                deliveredDate = pli.custom.deliveredDate;
            }
            break;
        }
    }

    if (!itemFound) {
        return { allowed: false, message: "Item with ID " + itemId + " not found in this order." };
    }

    // 4. CHECK: Is Delivered Date Available?
    if (!deliveredDate) {
        return {
            allowed: false,
            message: "Request rejected: The product is not delivered yet."
        };
    }

    // 5. Calculate Difference (Delivered Date vs Now)
    var currentDate = new Date();
    var timeDiff = currentDate.getTime() - deliveredDate.getTime();
    var daysDiff = timeDiff / (1000 * 3600 * 24);

    // 6. Compare with Deadline
    if (daysDiff > deadlineDays) {
        return {
            allowed: false,
            message: "Request rejected: The deadline of " + deadlineDays + " days from delivery has passed."
        };
    }
    return { allowed: true };
}


/**
 * Manually builds a JSON response for the Basket
 */
function getBasketResponse(basket) {
    if (!basket) return null;

    var val = function (money) {
        return (money && money.available) ? money.value : null;
    };

    // -------------------------------------------------------------------------
    // HELPER: Format Address Object
    // -------------------------------------------------------------------------
    var getAddress = function (address) {
        if (!address) return null;
        var addrObj = {
            "id": address.getUUID(),
            "firstName": address.getFirstName(),
            "lastName": address.getLastName(),
            "fullName": address.getFullName(),
            "address1": address.getAddress1(),
            "address2": address.getAddress2(),
            "city": address.getCity(),
            "postalCode": address.getPostalCode(),
            "stateCode": address.getStateCode(),
            "countryCode": address.getCountryCode().value,
            "phone": address.getPhone()
        };

        // Add custom attributes if they exist (to match your ideal response)
        if ('State' in address.custom) addrObj.c_State = address.custom.State;
        if ('Town' in address.custom) addrObj.c_Town = address.custom.Town;

        return addrObj;
    };

    var response = {
        "basketId": basket.getUUID(),
        "currency": basket.getCurrencyCode(),
        "channelType": "storefront",
        "agentBasket": basket.isAgentBasket(),
        "temporaryBasket": true,
        // Totals
        "productTotal": val(basket.getAdjustedMerchandizeTotalPrice(false)),
        "productSubTotal": val(basket.getMerchandizeTotalPrice()),
        "merchandizeTotalTax": val(basket.getMerchandizeTotalTax()),
        "adjustedMerchandizeTotalTax": val(basket.getAdjustedMerchandizeTotalTax()),
        "shippingTotal": val(basket.getAdjustedShippingTotalPrice()),
        "shippingTotalTax": val(basket.getAdjustedShippingTotalTax()),
        "taxTotal": val(basket.getTotalTax()),
        "orderTotal": val(basket.getTotalGrossPrice()),

        "customerInfo": {
            "customerId": basket.getCustomerNo() || (basket.getCustomer() ? basket.getCustomer().getID() : null),
            "customerNo": basket.getCustomerNo(),
            "email": basket.getCustomerEmail() || ""
        },

        // NEW: Billing Address
        "billingAddress": getAddress(basket.getBillingAddress()),

        "notes": {},
        "productItems": [],
        "shipments": [],
        "orderPriceAdjustments": [],
        "paymentInstruments": []
    };

    // 1. Map Product Items & Item Adjustments
    var pliIter = basket.getProductLineItems().iterator();
    while (pliIter.hasNext()) {
        var pli = pliIter.next();

        var itemAdjustments = [];
        var adjIter = pli.getPriceAdjustments().iterator();
        while (adjIter.hasNext()) {
            var adj = adjIter.next();
            itemAdjustments.push({
                "price": val(adj.getPrice()),
                "lineItemText": adj.getLineItemText(),
                "promotionId": adj.getPromotionID(),
                "couponCode": adj.getCouponLineItem() ? adj.getCouponLineItem().getCouponCode() : null
            });
        }

        response.productItems.push({
            "itemId": pli.getUUID(),
            "productId": pli.getProductID(),
            "productName": pli.getProductName(),
            "itemText": pli.getLineItemText(),
            "quantity": pli.getQuantityValue(),
            "basePrice": val(pli.getBasePrice()),
            "price": val(pli.getPrice()),
            "priceAfterItemDiscount": val(pli.getAdjustedPrice()),
            "priceAfterOrderDiscount": val(pli.getProratedPrice()),
            "shipmentId": pli.getShipment().getID(),
            "tax": val(pli.getTax()),
            "taxRate": pli.getTaxRate(),
            "taxBasis": val(pli.getTaxBasis()),
            "taxClassId": pli.getTaxClassID(), // Added
            "priceAdjustments": itemAdjustments,
            "bonusProductLineItem": pli.isBonusProductLineItem(),
            "gift": pli.isGift(),
            "adjustedTax": val(pli.getAdjustedTax())
        });
    }

    // 2. Map Shipments & Shipping Adjustments
    var shipmentIter = basket.getShipments().iterator();
    while (shipmentIter.hasNext()) {
        var shipment = shipmentIter.next();

        var shippingItems = [];
        var sliIter = shipment.getShippingLineItems().iterator();
        while (sliIter.hasNext()) {
            var sli = sliIter.next();

            var shippingAdjustments = [];
            var spaIter = sli.getShippingPriceAdjustments().iterator();
            while (spaIter.hasNext()) {
                var spa = spaIter.next();
                shippingAdjustments.push({
                    "price": val(spa.getPrice()),
                    "lineItemText": spa.getLineItemText(),
                    "promotionId": spa.getPromotionID()
                });
            }

            shippingItems.push({
                "itemId": sli.getUUID(),
                "itemText": sli.getLineItemText(),
                "shipmentId": shipment.getID(),
                "basePrice": val(sli.getBasePrice()),
                "price": val(sli.getPrice()),
                "priceAfterItemDiscount": val(sli.getAdjustedPrice()),
                "tax": val(sli.getTax()),
                "taxRate": sli.getTaxRate(), // Added
                "taxBasis": val(sli.getTaxBasis()), // Added
                "taxClassId": sli.getTaxClassID(), // Added
                "priceAdjustments": shippingAdjustments,
                "adjustedTax": val(sli.getAdjustedTax())
            });
        }

        // NEW: Shipping Method Object
        var shippingMethodObj = null;
        var sm = shipment.getShippingMethod();
        if (sm) {
            shippingMethodObj = {
                "id": sm.getID(),
                "name": sm.getDisplayName(),
                "description": sm.getDescription(),
                "price": val(shipment.getShippingTotalPrice()),
                "c_storePickupEnabled": ('storePickupEnabled' in sm.custom) ? sm.custom.storePickupEnabled : false
            };
        }

        response.shipments.push({
            "shipmentId": shipment.getID(),
            "shippingStatus": "not_shipped",
            "productTotal": val(shipment.getMerchandizeTotalPrice()),
            "productSubTotal": val(shipment.getAdjustedMerchandizeTotalPrice(false)),
            "shipmentTotal": val(shipment.getShippingTotalPrice()),
            "shippingTotal": val(shipment.getAdjustedShippingTotalPrice()),
            "shippingTotalTax": val(shipment.getAdjustedShippingTotalTax()),
            "taxTotal": val(shipment.getTotalTax()),
            "shippingAddress": getAddress(shipment.getShippingAddress()), // NEW: Shipping Address
            "shippingMethod": shippingMethodObj, // NEW: Shipping Method
            "shippingItems": shippingItems
        });
    }

    // 3. Map Order Price Adjustments
    var opaIter = basket.getPriceAdjustments().iterator();
    while (opaIter.hasNext()) {
        var opa = opaIter.next();
        response.orderPriceAdjustments.push({
            "price": val(opa.getPrice()),
            "lineItemText": opa.getLineItemText(),
            "promotionId": opa.getPromotionID(),
            "couponCode": opa.getCouponLineItem() ? opa.getCouponLineItem().getCouponCode() : null
        });
    }

    // 4. Map Payment Instruments
    var piIter = basket.getPaymentInstruments().iterator();
    while (piIter.hasNext()) {
        var pi = piIter.next();
        var piObj = {
            "paymentMethodId": pi.getPaymentMethod(),
            "amount": val(pi.getPaymentTransaction().getAmount()),
            "transactionId": pi.getPaymentTransaction().getTransactionID(),
            "paymentInstrumentId": pi.getUUID()
        };

        if (pi.getPaymentMethod() === 'CREDIT_CARD') {
            piObj.creditCardType = pi.getCreditCardType();
            piObj.maskedCreditCardNumber = pi.getMaskedCreditCardNumber();
            piObj.creditCardExpirationMonth = pi.getCreditCardExpirationMonth();
            piObj.creditCardExpirationYear = pi.getCreditCardExpirationYear();
        }

        response.paymentInstruments.push(piObj);
    }

    return response;
}


/**
 * Cleanup function to remove stale temporary baskets
 */
function cleanupTempBaskets() {
    try {
        var tempBaskets = BasketMgr.getTemporaryBaskets();
        for (var i = 0; i < tempBaskets.size(); i++) {
            var tempBasket = tempBaskets.get(i);
            Transaction.wrap(function () {
                BasketMgr.deleteTemporaryBasket(tempBasket);
            });
        }
    } catch (e) {
        // Log error but don't stop execution
    }
}

/* =========================================================================
   CORE LOGIC FUNCTIONS
   ========================================================================= */

/**
 * Scenario: RETURN
 * Updates original order attributes and item status.
 */
function processReturn(order, body) {
    Transaction.wrap(function () {
        // Update Order Attributes
        order.custom.BankName = body.returnData && body.returnData.bankName ? body.returnData.bankName : '';
        order.custom.AccountNumber = body.returnData && body.returnData.accountNumber ? body.returnData.accountNumber : '';
        order.custom.ifscCode = body.returnData && body.returnData.ifscCode ? body.returnData.ifscCode : '';
        order.custom.MobileNumber = body.returnData && body.returnData.mobileNumber ? body.returnData.mobileNumber : '';

        // Update Item Status
        var itemId = body.itemId;
        var plis = order.getProductLineItems().iterator();
        while (plis.hasNext()) {
            var pli = plis.next();
            if (pli.productID === itemId) {
                pli.custom.Reason = body.reason || '';
                pli.custom.Description = body.description || '';
                if (body.mediaLinks && body.mediaLinks.length > 0) {
                    pli.custom.MediaLinks = body.mediaLinks.toArray ? body.mediaLinks.toArray() : body.mediaLinks;
                }
                pli.custom.lineItemStatus = 18; // 18 = RETURNED
                pli.custom.returnExchangeRequestDate = new Date();
                order.custom.returnProcessing = true
                var returnedPlis = new ArrayList();
                returnedPlis.add(pli);
                emailHelper.sendReturnRequestEmail(order, returnedPlis);
            }
        }
    });

    return { success: true, message: "Return processed successfully" };
}

/**
 * Scenario: EXCHANGE-SAME
 * Prepares basket with same item.
 * - If isExchangeShipping = false: Zeroes out Shipping.
 * - Always Zeroes out Merchandise (Equal Exchange).
 * - Returns Basket Response (No Order Creation).
 */
function processExchangeSame(order, body) {
    var exchangeItemId = body.exchangeData.exchangeItemId;
    var returnItemId = body.itemId;

    // -------------------------------------------------------------------------
    // SETUP & DEPENDENCIES
    // -------------------------------------------------------------------------
    var TaxMgr = require('dw/order/TaxMgr');
    var Site = require('dw/system/Site');
    var Money = require('dw/value/Money');
    var taxationPolicy = TaxMgr.getTaxationPolicy();

    // Site Preference for Shipping
    var isExchangeShipping = Site.getCurrent().getPreferences().getCustom()['isExchangeShipping'];

    // -------------------------------------------------------------------------
    // STEP 1: VALIDATION (Read-Only)
    // -------------------------------------------------------------------------
    var returnProduct = ProductMgr.getProduct(returnItemId);
    var exchangeProduct = ProductMgr.getProduct(exchangeItemId);

    if (!returnProduct || !exchangeProduct) {
        return { success: false, message: "One of the products involved in the exchange could not be found." };
    }
    if (!returnProduct.isVariant() || !exchangeProduct.isVariant()) {
        return { success: false, message: "Invalid Exchange: Products must be variants (e.g. size/color)." };
    }
    if (returnProduct.getMasterProduct().getID() !== exchangeProduct.getMasterProduct().getID()) {
        return { success: false, message: "Invalid Exchange: Must be a variant of the same Master Product." };
    }

    var quantity = 0;
    var originalLineItems = order.getProductLineItems().iterator();
    while (originalLineItems.hasNext()) {
        var item = originalLineItems.next();
        if (item.productID === returnItemId) {
            quantity += item.quantityValue;
        }
    }

    if (quantity === 0) {
        return { success: false, message: 'Item to return (' + returnItemId + ') not found in original order.' };
    }

    var basket;

    // -------------------------------------------------------------------------
    // STEP 2: CREATE & PREPARE BASKET
    // -------------------------------------------------------------------------
    try {
        var basketResult = Transaction.wrap(function () {
            try {
                var currentBasket = BasketMgr.createTemporaryBasket();
                var ArrayList = require('dw/util/ArrayList');

                var itemsList = new ArrayList();
                itemsList.add({ productId: exchangeItemId, quantity: quantity });

                // Hook Call
                if (HookMgr.hasHook('dw.ocapi.shop.basket.items.beforePOST')) {
                    var hookResult = HookMgr.callHook(
                        'dw.ocapi.shop.basket.items.beforePOST', 'beforePOST', currentBasket, itemsList);
                    if (hookResult && typeof hookResult === 'object' && hookResult.error) {
                        return { error: true, message: "Add Product Hook Failed: " + (hookResult.message || "Validation Error") };
                    }
                }

                // Add Product
                var shipment = currentBasket.getDefaultShipment();
                var pli = currentBasket.createProductLineItem(exchangeProduct, null, shipment);
                pli.setQuantityValue(quantity);

                // Copy Addresses
                var origShipment = order.getDefaultShipment();
                if (origShipment.getShippingAddress()) {
                    copyAddress(origShipment.getShippingAddress(), shipment.createShippingAddress());
                }

                if (origShipment.getShippingMethod()) {
                    shipment.setShippingMethod(origShipment.getShippingMethod());
                } else {
                    var ShippingMgr = require('dw/order/ShippingMgr');
                    var defaultMethod = ShippingMgr.getDefaultShippingMethod();
                    if (defaultMethod) shipment.setShippingMethod(defaultMethod);
                }

                if (order.getBillingAddress()) {
                    copyAddress(order.getBillingAddress(), currentBasket.createBillingAddress());
                }
                currentBasket.setCustomerEmail(order.getCustomerEmail());
                currentBasket.setCustomerName(order.getCustomerName());

                // Pass info to Basket (for Order Creation Hooks later)
                currentBasket.custom.exchangeOriginalOrderId = order.orderNo;
                currentBasket.custom.exchangeReturnedItemId = returnItemId;
                if (body.reason) currentBasket.custom.exchangeReturnReason = body.reason;
                if (body.description) currentBasket.custom.exchangeReturnDescription = body.description;

                // FIX 1: FORCE SHIPPING PRICE (Unconditional - Match processExchangeDifferent)
                var shipmentIter = currentBasket.getShipments().iterator();
                while (shipmentIter.hasNext()) {
                    var ship = shipmentIter.next();
                    var sliIter = ship.getShippingLineItems().iterator();
                    while (sliIter.hasNext()) {
                        var sli = sliIter.next();
                        if (!sli.getBasePrice().available) {
                            sli.setPriceValue(0.00);
                        }
                    }
                }

                // E. INITIAL CALCULATION
                currentBasket.updateTotals();
                HookMgr.callHook('dw.order.calculate', 'calculate', currentBasket);

                // -------------------------------------------------------------
                // CONDITIONAL SHIPPING ZEROING
                // -------------------------------------------------------------
                if (!isExchangeShipping) {
                    var shipmentIter2 = currentBasket.getShipments().iterator();
                    while (shipmentIter2.hasNext()) {
                        var ship = shipmentIter2.next();
                        var sliIter = ship.getShippingLineItems().iterator();
                        while (sliIter.hasNext()) {
                            var sli = sliIter.next();
                            var cost = sli.getAdjustedPrice();
                            if (cost.getValue() > 0) {
                                var spa = sli.createShippingPriceAdjustment('EXCHANGE_FREE_SHIPPING');
                                spa.setPriceValue(-cost.getValue());
                                spa.setLineItemText("Free Shipping (Exchange)");
                            }
                        }
                    }
                }

                // -------------------------------------------------------------
                // MERCHANDISE LOGIC (Always Offset for Same Exchange)
                // -------------------------------------------------------------
                // Even if shipping is paid, the product itself should be free/exchanged.
                // We use 'false' to get the raw Merch Total (Net or Gross matches site policy)
                var merchTotal = currentBasket.getAdjustedMerchandizeTotalPrice(false);

                if (merchTotal.available && merchTotal.getValue() > 0) {
                    var pa = currentBasket.createPriceAdjustment("EXCHANGE_OFFSET");
                    pa.setPriceValue(-merchTotal.getValue());
                    pa.setLineItemText("Exchange Adjustment (Equal Value)");
                }

                // Recalc (Net vs Gross safe hook)
                if (taxationPolicy === TaxMgr.TAX_POLICY_NET) {
                    HookMgr.callHook('dw.order.calculateTax', 'calculateTax', currentBasket);
                } else {
                    HookMgr.callHook('dw.order.calculate', 'calculate', currentBasket);
                }
                currentBasket.updateTotals();

                // Payment Instrument
                var amountToPay = currentBasket.getTotalGrossPrice();
                var methodId = 'COD';

                // If Shipping is Paid, amountToPay will be > 0.
                // if (amountToPay.available && amountToPay.getValue() > 0.01) {
                    var origPIs = order.getPaymentInstruments();
                    if (origPIs.length > 0) {
                        methodId = origPIs.iterator().next().getPaymentMethod();
                    }
                // }

                currentBasket.createPaymentInstrument(methodId, amountToPay);

                return currentBasket;

            } catch (innerE) {
                return { error: true, message: innerE.message };
            }
        });

        if (!basketResult) {
            return { success: false, message: "Basket Creation Failed." };
        }
        if (typeof basketResult.getCurrencyCode === 'function') {
            basket = basketResult;
        } else {
            return { success: false, message: "Basket Creation Failed: " + (basketResult.message || "Unknown Error") };
        }

    } catch (e) {
        return { success: false, message: "System Error (Basket): " + e.message };
    }

    // -------------------------------------------------------------------------
    // STEP 3: UPDATE ORIGINAL ORDER (Status Only)
    // -------------------------------------------------------------------------
    try {
        var finalExchangeAmount = 0.00;
        if (basket && basket.getTotalGrossPrice().available) {
            finalExchangeAmount = basket.getTotalGrossPrice().getValue();
        }
        Transaction.wrap(function () {
            order.custom.BankName = body.exchangeData && body.exchangeData.bankName ? body.exchangeData.bankName : '';
            order.custom.AccountNumber = body.exchangeData && body.exchangeData.accountNumber ? body.exchangeData.accountNumber : '';
            order.custom.ifscCode = body.exchangeData && body.exchangeData.ifscCode ? body.exchangeData.ifscCode : '';
            order.custom.MobileNumber = body.exchangeData && body.exchangeData.mobileNumber ? body.exchangeData.mobileNumber : '';

            var plisToUpdate = order.getProductLineItems().iterator();
            while (plisToUpdate.hasNext()) {
                var originalPli = plisToUpdate.next();
                if (originalPli.productID === returnItemId) {
                    originalPli.custom.Reason = body.reason || '';
                    originalPli.custom.Description = body.description || '';
                    if (body.mediaLinks && body.mediaLinks.length > 0) {
                        originalPli.custom.MediaLinks = body.mediaLinks.toArray ? body.mediaLinks.toArray() : body.mediaLinks;
                    }
                    originalPli.custom.exchangeAmount = finalExchangeAmount;
                }
            }
        });
    } catch (e) {
        return { success: false, message: "Order Update Failed: " + e.message };
    }

    // -------------------------------------------------------------------------
    // STEP 4: RESPONSE
    // -------------------------------------------------------------------------
    return {
        success: true,
        basket: getBasketResponse(basket)
    };
}

/**
 * Scenario: EXCHANGE-DIFFERENT
 * Calculates credit, applies UPSSELL DISCOUNT, updates Original Order, prepares basket.
 */
function processExchangeDifferent(order, body) {
    var exchangeItemId = body.exchangeData.exchangeItemId;
    var quantity = body.exchangeData.quantity || 1;
    var returnItemId = body.itemId;

    // -------------------------------------------------------------------------
    // SETUP & DEPENDENCIES
    // -------------------------------------------------------------------------
    var TaxMgr = require('dw/order/TaxMgr');
    var Site = require('dw/system/Site');
    var Money = require('dw/value/Money'); // Import once at top
    var taxationPolicy = TaxMgr.getTaxationPolicy();

    // Site Preference for Shipping
    var isExchangeShipping = Site.getCurrent().getPreferences().getCustom()['isExchangeShipping'];

    // -------------------------------------------------------------------------
    // STEP 1: VALIDATION & CREDIT CALCULATION
    // -------------------------------------------------------------------------
    var exchangeProduct = ProductMgr.getProduct(exchangeItemId);
    if (!exchangeProduct) {
        return { success: false, message: "Exchange Product not found: " + exchangeItemId };
    }

    var itemFound = false;
    var originalLineItems = order.getProductLineItems().iterator();
    while (originalLineItems.hasNext()) {
        var item = originalLineItems.next();
        if (item.productID === returnItemId) {
            itemFound = true;
            break;
        }
    }

    if (!itemFound) {
        return { success: false, message: "Item to return (" + returnItemId + ") not found in original order." };
    }

    var creditAmount = RefundHelper.calculateRefundAmount(order, returnItemId, false);
    var totalReturnCredit = new Money(creditAmount, order.getCurrencyCode());

    var basket;
    var financialDifferenceValue = 0.00;

    // -------------------------------------------------------------------------
    // STEP 2: CREATE & PREPARE BASKET
    // -------------------------------------------------------------------------
    try {
        var basketResult = Transaction.wrap(function () {
            try {
                var currentBasket = BasketMgr.createTemporaryBasket();
                var ArrayList = require('dw/util/ArrayList');

                // A. Add Product
                var itemsList = new ArrayList();
                itemsList.add({ productId: exchangeItemId, quantity: quantity });

                if (HookMgr.hasHook('dw.ocapi.shop.basket.items.beforePOST')) {
                    var hookResult = HookMgr.callHook('dw.ocapi.shop.basket.items.beforePOST', 'beforePOST', currentBasket, itemsList);
                    if (hookResult && typeof hookResult === 'object' && hookResult.error) {
                        return { error: true, message: "Add Product Hook Failed: " + (hookResult.message || "Validation Error") };
                    }
                }

                // B. Create Line Item
                var shipment = currentBasket.getDefaultShipment();
                var pli = currentBasket.createProductLineItem(exchangeProduct, null, shipment);
                pli.setQuantityValue(quantity);

                // C. Copy Details
                var origShipment = order.getDefaultShipment();
                if (origShipment.getShippingAddress()) copyAddress(origShipment.getShippingAddress(), shipment.createShippingAddress());
                if (order.getBillingAddress()) copyAddress(order.getBillingAddress(), currentBasket.createBillingAddress());
                currentBasket.setCustomerEmail(order.getCustomerEmail());
                currentBasket.setCustomerName(order.getCustomerName());

                currentBasket.custom.exchangeOriginalOrderId = order.orderNo;
                currentBasket.custom.exchangeReturnedItemId = returnItemId;
                if (body.reason) currentBasket.custom.exchangeReturnReason = body.reason;
                if (body.description) currentBasket.custom.exchangeReturnDescription = body.description;

                // D. Set Shipping Method
                if (origShipment.getShippingMethod()) shipment.setShippingMethod(origShipment.getShippingMethod());
                else {
                    var ShippingMgr = require('dw/order/ShippingMgr');
                    var defaultMethod = ShippingMgr.getDefaultShippingMethod();
                    if (defaultMethod) shipment.setShippingMethod(defaultMethod);
                }

                // FIX 1: FORCE SHIPPING PRICE (Unconditional)
                var shipmentIter = currentBasket.getShipments().iterator();
                while (shipmentIter.hasNext()) {
                    var ship = shipmentIter.next();
                    var sliIter = ship.getShippingLineItems().iterator();
                    while (sliIter.hasNext()) {
                        var sli = sliIter.next();
                        if (!sli.getBasePrice().available) {
                            sli.setPriceValue(0.00);
                        }
                    }
                }

                // E. INITIAL CALCULATION
                currentBasket.updateTotals();
                HookMgr.callHook('dw.order.calculate', 'calculate', currentBasket);

                // CONDITIONAL SHIPPING ZEROING
                if (!isExchangeShipping) {
                    var shipmentIter2 = currentBasket.getShipments().iterator();
                    while (shipmentIter2.hasNext()) {
                        var ship = shipmentIter2.next();
                        var sliIter = ship.getShippingLineItems().iterator();
                        while (sliIter.hasNext()) {
                            var sli = sliIter.next();
                            var cost = sli.getAdjustedPrice();
                            if (cost.getValue() > 0) {
                                var spa = sli.createShippingPriceAdjustment('EXCHANGE_FREE_SHIPPING');
                                spa.setPriceValue(-cost.getValue());
                                spa.setLineItemText("Free Shipping (Exchange)");
                            }
                        }
                    }
                }

                // Recalc (Tax Only for Net to preserve shipping fix)
                if (taxationPolicy === TaxMgr.TAX_POLICY_NET) {
                    HookMgr.callHook('dw.order.calculateTax', 'calculateTax', currentBasket);
                } else {
                    HookMgr.callHook('dw.order.calculate', 'calculate', currentBasket);
                }
                currentBasket.updateTotals();

                // =============================================================
                // F. EXCHANGE DISCOUNT (UPSSELL ONLY)
                // =============================================================
                var tempTotal = currentBasket.getTotalGrossPrice();

                // Fallback check if N/A
                if (!tempTotal.available) {
                    var sub = currentBasket.getAdjustedMerchandizeTotalPrice(true);
                    var ship = currentBasket.getAdjustedShippingTotalPrice(true);
                    if (sub.available && ship.available) tempTotal = sub.add(ship);
                }

                var creditVal = totalReturnCredit.getValue();
                var currentTotalVal = tempTotal.getValue();

                // CONDITION 1: Only apply if New Order > Old Credit (Customer is paying)

                // =============================================================
                // G. CALCULATE DIFFERENCE (Store Exact Value Now)
                // =============================================================
                var currentGrossTotal = currentBasket.getTotalGrossPrice();
                if (!currentGrossTotal.available) {
                    var sub = currentBasket.getAdjustedMerchandizeTotalPrice(true);
                    var ship = currentBasket.getAdjustedShippingTotalPrice(true);
                    if (sub.available && ship.available) currentGrossTotal = sub.add(ship);
                }

                var basketTotalVal = currentGrossTotal.getValue();

                // *** CRITICAL STEP: Store exact difference ***
                financialDifferenceValue = basketTotalVal - creditVal;

                // =============================================================
                // H. APPLY CREDIT ADJUSTMENT (To fix the Basket Total)
                // =============================================================
                var adjustmentAmount = 0.00;

                if (creditVal >= basketTotalVal) {
                    // CASE 1: REFUND (Old > New) or EQUAL
                    // Zero out the basket.
                    if (taxationPolicy === TaxMgr.TAX_POLICY_NET) {
                        adjustmentAmount = -currentBasket.getMerchandizeTotalNetPrice().getValue();
                    } else {
                        adjustmentAmount = -currentBasket.getMerchandizeTotalGrossPrice().getValue();
                    }
                } else {
                    // CASE 2: PAYMENT (New > Old)
                    // We must reduce the basket by the credit amount.

                    if (taxationPolicy === TaxMgr.TAX_POLICY_NET) {
                        // NET Policy: De-Tax the credit
                        var totalNet = currentBasket.getTotalNetPrice().getValue();
                        var totalTax = currentBasket.getTotalTax().getValue();
                        var effectiveTaxRate = 0;

                        if (totalNet > 0) {
                            effectiveTaxRate = totalTax / totalNet;
                        }

                        // Formula: 330 / (1 + 0.10) = 300.00
                        var netAdjustment = creditVal / (1 + effectiveTaxRate);
                        adjustmentAmount = -netAdjustment;

                    } else {
                        // GROSS Policy: Apply directly
                        adjustmentAmount = -creditVal;
                    }
                }

                if (adjustmentAmount !== 0) {
                    var adjMoney = new Money(adjustmentAmount, currentBasket.getCurrencyCode());
                    var pa = currentBasket.createPriceAdjustment("EXCHANGE_CREDIT");
                    pa.setPriceValue(adjMoney.getValue());
                    pa.setLineItemText("Exchange Credit");

                    if (taxationPolicy === TaxMgr.TAX_POLICY_NET) {
                        HookMgr.callHook('dw.order.calculateTax', 'calculateTax', currentBasket);
                    } else {
                        HookMgr.callHook('dw.order.calculate', 'calculate', currentBasket);
                    }
                    currentBasket.updateTotals();
                }

                if (currentTotalVal > creditVal) {
                    var prefs = Site.getCurrent().getPreferences().getCustom();
                    var discountPercent = 'exchangeDiscountPercentage' in prefs ? prefs['exchangeDiscountPercentage'] : null;
                    var discountMsg = 'exchangeDiscountMessage' in prefs ? prefs['exchangeDiscountMessage'] : "Exchange Discount";

                    if (discountPercent && discountPercent > 0) {
                        // var merchTotal = currentBasket.getAdjustedMerchandizeTotalPrice(false);
                        var merchTotal = currentBasket.getTotalNetPrice();

                        if (merchTotal.available && merchTotal.getValue() > 0) {
                            var discountAmount = merchTotal.getValue() * (discountPercent / 100);

                            // CONDITION 2: CAP THE DISCOUNT (Don't allow refunds due to discount)
                            var maxGrossDiscount = currentTotalVal - creditVal; // e.g. 1120 - 1117 = 3.00
                            var finalDiscountToApply = discountAmount;

                            if (taxationPolicy === TaxMgr.TAX_POLICY_NET) {
                                // For NET Tax, convert Gross Cap to Net Cap
                                var totalNet = currentBasket.getTotalNetPrice().getValue();
                                var totalGross = currentBasket.getTotalGrossPrice().getValue();
                                var ratio = (totalGross > 0) ? (totalNet / totalGross) : 1;
                                var maxNetDiscount = maxGrossDiscount * ratio;

                                // Cap the discount
                                if (discountAmount > maxNetDiscount) {
                                    finalDiscountToApply = maxNetDiscount;
                                }
                            } else {
                                // For GROSS Tax, simple comparison
                                if (discountAmount > maxGrossDiscount) {
                                    finalDiscountToApply = maxGrossDiscount;
                                }
                            }

                            // Apply Final Discount
                            if (finalDiscountToApply > 0) {
                                var roundedDiscount = new Number(finalDiscountToApply).toFixed(2);
                                var discountMoney = new Money(roundedDiscount * -1, currentBasket.getCurrencyCode());

                                var pa;
                                if (creditVal == currentBasket.getMerchandizeTotalGrossPrice().getValue()) {
                                    pa = currentBasket.createShippingPriceAdjustment("EXCHANGE_DISCOUNT");
                                }else{
                                    pa = currentBasket.createPriceAdjustment("EXCHANGE_DISCOUNT");
                                }
                                pa.setPriceValue(discountMoney.getValue());
                                pa.setLineItemText(discountMsg);

                                // RE-CALCULATE
                                if (taxationPolicy === TaxMgr.TAX_POLICY_NET) {
                                    HookMgr.callHook('dw.order.calculateTax', 'calculateTax', currentBasket);
                                } else {
                                    HookMgr.callHook('dw.order.calculate', 'calculate', currentBasket);
                                }
                                currentBasket.updateTotals();
                            }
                        }
                    }
                }

                // FIX 2: EXCHANGE AMOUNT TRUTH (Upsell Case)
                var finalTotal = currentBasket.getTotalGrossPrice();
                if (finalTotal.available && finalTotal.getValue() > 0.01) {
                    financialDifferenceValue = finalTotal.getValue();
                }

                // I. PAYMENT INSTRUMENT
                var amountToPay = currentBasket.getTotalGrossPrice();
                var methodId = 'COD';

                // if (amountToPay.available && amountToPay.getValue() > 0.01) {
                    var origPIs = order.getPaymentInstruments();
                    if (origPIs.length > 0) {
                        methodId = origPIs.iterator().next().getPaymentMethod();
                    }
                // }

                currentBasket.createPaymentInstrument(methodId, amountToPay);

                return currentBasket;

            } catch (innerE) {
                return { error: true, message: innerE.message };
            }
        });

        if (!basketResult) {
            return { success: false, message: "Basket Creation Failed." };
        }
        if (typeof basketResult.getCurrencyCode === 'function') {
            basket = basketResult;
        } else {
            return { success: false, message: "Basket Creation Failed: " + (basketResult.message || "Unknown Error") };
        }

    } catch (e) {
        return { success: false, message: "System Error (Basket): " + e.message };
    }

    // -------------------------------------------------------------------------
    // STEP 3: UPDATE ORIGINAL ORDER
    // -------------------------------------------------------------------------
    try {
        Transaction.wrap(function () {
            order.custom.BankName = body.exchangeData && body.exchangeData.bankName ? body.exchangeData.bankName : '';
            order.custom.AccountNumber = body.exchangeData && body.exchangeData.accountNumber ? body.exchangeData.accountNumber : '';
            order.custom.ifscCode = body.exchangeData && body.exchangeData.ifscCode ? body.exchangeData.ifscCode : '';
            order.custom.MobileNumber = body.exchangeData && body.exchangeData.mobileNumber ? body.exchangeData.mobileNumber : '';

            var plisToUpdate = order.getProductLineItems().iterator();
            while (plisToUpdate.hasNext()) {
                var originalPli = plisToUpdate.next();
                if (originalPli.productID === returnItemId) {
                    originalPli.custom.Reason = body.reason || '';
                    originalPli.custom.Description = body.description || '';
                    if (body.mediaLinks && body.mediaLinks.length > 0) {
                        originalPli.custom.MediaLinks = body.mediaLinks.toArray ? body.mediaLinks.toArray() : body.mediaLinks;
                    }
                    originalPli.custom.exchangeAmount = financialDifferenceValue;
                }
            }
        });
    } catch (e) {
        return { success: false, message: "Order Update Failed: " + e.message };
    }

    // -------------------------------------------------------------------------
    // STEP 4: RESPONSE
    // -------------------------------------------------------------------------
    return {
        success: true,
        basket: getBasketResponse(basket)
    };
}

module.exports = {
    cleanupTempBaskets: cleanupTempBaskets,
    processReturn: processReturn,
    processExchangeSame: processExchangeSame,
    processExchangeDifferent: processExchangeDifferent,
    validateRequestWindow: validateRequestWindow,
    validateItemStatus: validateItemStatus
};