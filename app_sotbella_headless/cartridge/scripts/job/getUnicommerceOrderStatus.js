'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger').getLogger('Unicommerce', 'OrderStatus');
var Site = require('dw/system/Site');
var System = require('dw/system/System');

var serviceHelpers = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper');
var searchSaleOrders = require('*/cartridge/services/unicommerceSearchOrderService');
var getSaleOrder = require('*/cartridge/services/unicommerceGetOrderService');
var ReviewHelper = require('*/cartridge/scripts/helpers/reviewHelper');
var ArrayList = require('dw/util/ArrayList');
var emailHelper = require('*/cartridge/scripts/helpers/emailHelper');
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

function getUnicommerceOrderStatus(parameters) {
    var lastNMinutes = parameters.lastNMinutes || 30;

    var channel = Site.getCurrent().getID().toUpperCase();
    Logger.info('Starting Unicommerce Status Job - Channel: {0}, lastNMinutes: {1}', channel, lastNMinutes);

    var orderStatusMap = loadJSONPref('orderStatusJSON');
    var lineItemStatusMap = loadJSONPref('lineItemStatusJSON');

    // 1) SEARCH API
    var searchResponse = serviceHelpers.callSearchSaleOrders(
        channel,
        lastNMinutes,
        function (channel, lastNMinutes, token) {
            return searchSaleOrders(channel, lastNMinutes, token);
        }
    );

    if (!searchResponse || searchResponse.error || !searchResponse.object.successful) {
        Logger.error('Search API failed.');
        return new Status(Status.ERROR, 'ERROR', 'Unable to fetch/update Unicommerce Order statuses.');
    }

    var items = searchResponse.object.elements || [];

    if (items.length === 0) {
        Logger.info('No orders found to update in last {0} minutes', lastNMinutes);
        return new Status(Status.OK, 'WARN', 'No Orders found to update.');
    }

    var updatedCount = 0;

    // Iterate orders
    items.forEach(function (orderObj) {
        var orderNo = orderObj.code;

        try {
            Logger.info('Processing order {0}', orderNo);

            // 2) Fetch full details
            var detailResponse = serviceHelpers.callGetSaleOrder(orderNo, function (orderNo, token) {
                return getSaleOrder(orderNo, token);
            });

            if (!detailResponse || detailResponse.error || !detailResponse.object.successful) {
                Logger.warn('Unable to fetch detail for {0}', orderNo);
                return;
            }

            var saleOrder = detailResponse.object.saleOrderDTO;
            if (!saleOrder) {
                Logger.warn('Empty saleOrderDTO for {0}', orderNo);
                return;
            }

            // 3) Get SFCC Order
            var sfccOrder = OrderMgr.getOrder(orderNo);
            if (!sfccOrder) {
                Logger.warn('SFCC order not found: {0}', orderNo);
                return;
            }

            var deliveredPLIs = new ArrayList();
            var dispatchedPLIs = new ArrayList(); // List to collect items for Shipping Confirmation

            // 4) Update Order + Line Items
            Transaction.wrap(function () {

                // --- 4a. Package Map (for Delivered Date) ---
                var packageDeliveredMap = {};
                var packages = saleOrder.shippingPackages || [];
                packages.forEach(function (pkg) {
                    if (pkg.code && pkg.delivered) {
                        packageDeliveredMap[pkg.code] = pkg.delivered;
                    }
                });

                if (packages.length > 0) {
                    var firstPackage = packages[0];
                    if (sfccOrder.custom.trackingNumber == null) sfccOrder.custom.trackingNumber = firstPackage.trackingNumber;
                    if (sfccOrder.custom.shippingProvider == null) sfccOrder.custom.shippingProvider = firstPackage.shippingProvider;
                }

                // --- 4b. Returns Map (Map ReversePickupCode -> StatusCode) ---
                var returnsStatusMap = {};
                var returnObjList = saleOrder.returns || [];
                returnObjList.forEach(function (retObj) {
                    if (retObj.code && retObj.statusCode) {
                        returnsStatusMap[retObj.code] = retObj.statusCode.toUpperCase();
                    }
                });

                // --- 4c. Update Order Level Status ---
                var ucOrderStatus = saleOrder.status || '';
                var mappedOrderStatus = orderStatusMap[ucOrderStatus.toUpperCase()] !== undefined
                    ? orderStatusMap[ucOrderStatus.toUpperCase()]
                    : null;

                if (mappedOrderStatus !== null) {
                    if (sfccOrder.custom.orderStatus != orderStatusMap['DELIVERED']) {
                        sfccOrder.custom.orderStatus = mappedOrderStatus;
                    }
                    sfccOrder.custom.UpdateFlowFlag = false;
                }

                // --- 4d. Item Update Logic ---

                // Map SFCC PLIs by UUID
                var pliMap = {};
                sfccOrder.getAllProductLineItems().toArray().forEach(function (pli) {
                    pliMap[pli.UUID] = pli;
                });

                // --- Aggregate Return Inventory Data ---
                var inventoryCountsByUUID = {};
                returnObjList.forEach(function (retObj) {
                    var retItems = retObj.returnItems || [];
                    retItems.forEach(function (retItem) {
                        var retItemCode = retItem.saleOrderItemCode || '';
                        var invType = retItem.inventoryType;
                        if (retItemCode && invType) {
                            var parts = retItemCode.split('-');
                            if (parts.length >= 2) {
                                var uuid = parts[parts.length - 2];
                                if (!inventoryCountsByUUID[uuid]) {
                                    inventoryCountsByUUID[uuid] = {};
                                }
                                if (!inventoryCountsByUUID[uuid][invType]) {
                                    inventoryCountsByUUID[uuid][invType] = 0;
                                }
                                inventoryCountsByUUID[uuid][invType]++;
                            }
                        }
                    });
                });

                // Apply aggregated JSON to PLIs
                Object.keys(inventoryCountsByUUID).forEach(function (uuid) {
                    var pli = pliMap[uuid];
                    if (pli) {
                        pli.custom.returnInventoryStatus = JSON.stringify(inventoryCountsByUUID[uuid]);
                    }
                });

                var ucItems = saleOrder.saleOrderItems || [];

                ucItems.forEach(function (ucItem) {
                    var ucCode = ucItem.code || '';
                    var extractedUUID = null;
                    if (ucCode) {
                        var parts = ucCode.split('-');
                        if (parts.length >= 2) {
                            extractedUUID = parts[parts.length - 2];
                        }
                    }

                    var pli = extractedUUID ? pliMap[extractedUUID] : null;

                    if (!pli) {
                        return;
                    }

                    // --- STATUS LOGIC START ---

                    // 1. Incoming Status
                    var ucItemStatus = ucItem.statusCode || '';
                    var standardMappedStatus = lineItemStatusMap[ucItemStatus.toUpperCase()] !== undefined
                        ? lineItemStatusMap[ucItemStatus.toUpperCase()]
                        : null;

                    // 2. Current Status
                    var currentSfccStatusValue = pli.custom.lineItemStatus ? pli.custom.lineItemStatus.value : null;
                    var currentSfccStatusDisplay = pli.custom.lineItemStatus ? pli.custom.lineItemStatus.displayValue.toUpperCase() : null;

                    var finalStatusToUpdate = standardMappedStatus;

                    // 3. Reverse Pickup Logic
                    var reversePickupCode = ucItem.reversePickupCode;
                    if (ucItemStatus.toUpperCase() === 'CANCELLED' && reversePickupCode) {
                        var returnStatus = returnsStatusMap[reversePickupCode];
                        if (returnStatus === 'COMPLETE') {
                            if (currentSfccStatusDisplay === 'RETURN INITIATED') {
                                finalStatusToUpdate = lineItemStatusMap['RETURNED'];
                            } else if (currentSfccStatusDisplay === 'EXCHANGE INITIATED') {
                                finalStatusToUpdate = lineItemStatusMap['EXCHANGED'];
                            } else {
                                finalStatusToUpdate = currentSfccStatusValue;
                            }
                        }
 
                    } else if (ucItemStatus.toUpperCase() === 'CANCELLED' && (currentSfccStatusDisplay === 'CANCELLED AND REFUNDED' || currentSfccStatusDisplay === 'RETURNED AND REFUNDED' || currentSfccStatusDisplay === 'EXCHANGED AND REFUNDED' || currentSfccStatusDisplay ==='EXCHANGED AND CANCELLED' || currentSfccStatusDisplay==='EXCHANGE INITIATED' || currentSfccStatusDisplay==='RETURN INITIATED' || currentSfccStatusDisplay==='RETURN REJECTED' || currentSfccStatusDisplay==='EXCHANGE REJECTED'|| currentSfccStatusDisplay==='RETURN ACCEPTED' || currentSfccStatusDisplay==='EXCHANGE ACCEPTED' || currentSfccStatusDisplay==='RETURNED' || currentSfccStatusDisplay==='EXCHANGED')) {
                        finalStatusToUpdate = currentSfccStatusValue;
                    }
                    else if(ucItemStatus.toUpperCase() === 'DELIVERED' && (currentSfccStatusDisplay==='RETURN REQUESTED' || currentSfccStatusDisplay==='EXCHANGE REQUESTED' || currentSfccStatusDisplay==='RETURN REJECTED' || currentSfccStatusDisplay==='EXCHANGE REJECTED' || currentSfccStatusDisplay==='RETURN ACCEPTED' || currentSfccStatusDisplay==='EXCHANGE ACCEPTED' )){
                        finalStatusToUpdate = currentSfccStatusValue;
                    }

                    // 4. Apply Final Status
                    if (finalStatusToUpdate !== null) {
                        pli.custom.lineItemStatus = finalStatusToUpdate;
                        sfccOrder.custom.UpdateFlowFlag = false;
                        if (finalStatusToUpdate == lineItemStatusMap['CANCELLED']) {
                            if (pli.custom.cancellationDate == null)
                                pli.custom.cancellationDate = new Date();
                        }
                    }
                    // --- STATUS LOGIC END ---

                    // Update Delivered Date
                    var pkgCode = ucItem.shippingPackageCode;
                    if (pkgCode && packageDeliveredMap[pkgCode]) {
                        var deliveredDateObj = new Date(packageDeliveredMap[pkgCode]);
                        pli.custom.deliveredDate = deliveredDateObj;
                    }

                    // --- EMAIL TRIGGERS LOGIC ---

                    // Collect for Shipping Confirmation (DISPATCHED = 4)
                    // We only collect if the status is CHANGING to 4 (i.e. it wasn't 4 before)
                    if (finalStatusToUpdate == 4 && currentSfccStatusValue != 4) {
                        if (!dispatchedPLIs.contains(pli)) {
                            dispatchedPLIs.add(pli);
                        }
                    }

                    // Collect for Delivery Confirmation (DELIVERED = 5)
                    if (finalStatusToUpdate == 5) {
                        if (!deliveredPLIs.contains(pli)) {
                            deliveredPLIs.add(pli);
                        }
                    }
                });

                // --- NEW ORDER STATUS LOGIC: ANY ITEM DELIVERED -> ORDER DELIVERED ---
                // 1. If Order is already DELIVERED, do nothing.
                // 2. If Order is COMPLETE, check if ANY item is DELIVERED. If so, update Order to DELIVERED.

                if (orderStatusMap['DELIVERED'] && sfccOrder.custom.orderStatus == orderStatusMap['COMPLETE']) {

                    Logger.info('Order {0} updated Delivered', orderNo);
                    var hasDeliveredItem = false;
                    var pliIter = sfccOrder.getAllProductLineItems().iterator();

                    while (pliIter.hasNext()) {
                        var p = pliIter.next();
                        // Check if PLI status is DELIVERED (5)
                        if (p.custom.lineItemStatus && p.custom.lineItemStatus.value === 5) {
                            hasDeliveredItem = true;
                            break; // Found one, that's enough
                        }
                    }

                    if (hasDeliveredItem) {
                        sfccOrder.custom.orderStatus = orderStatusMap['DELIVERED'];
                    }
                }
                // -----------------------------------------------------
            });

            updatedCount++;
            Logger.info('Order {0} updated successfully', orderNo);

            // --- SEND EMAILS ---

            // 1. Send Shipping Confirmation (Dispatched)
            if (!dispatchedPLIs.isEmpty()) {
                try {
                    Logger.info('Triggering Shipping Confirmation for {0} items in Order {1}', dispatchedPLIs.size(), orderNo);
                    var shipResult = emailHelper.sendShippingConfirmMail(sfccOrder, dispatchedPLIs);
                    if (!shipResult.success) {
                        Logger.error('Error sending Shipping Confirm Email for order {0}: {1}', orderNo, shipResult.error);
                    }
                } catch (shipErr) {
                    Logger.error('Exception sending Shipping Confirm Email for order {0}: {1}', orderNo, shipErr.message);
                }
            }

            // 2. Send Delivered Email & Review Reminder (Delivered)
            if (!deliveredPLIs.isEmpty()) {
                try {
                    Logger.info('Triggering Order Delivered Email for {0} items in Order {1}', deliveredPLIs.size(), orderNo);
                    var emailResult = emailHelper.sendOrderDeliveredEmail(sfccOrder, deliveredPLIs);
                    if (!emailResult.success) {
                        Logger.error('Error sending Order Delivered Email for order {0}: {1}', orderNo, emailResult.error);
                    }
                } catch (emailErr) {
                    Logger.error('Error sending order delivered email for order {0}: {1}', orderNo, emailErr.message);
                }

                try {
                    Logger.info('Triggering Review Reminder for {0} items in Order {1}', deliveredPLIs.size(), orderNo);
                    ReviewHelper.sendOrderReviewReminder(sfccOrder, deliveredPLIs, false);
                } catch (reviewErr) {
                    Logger.error('Error sending review reminder for order {0}: {1}', orderNo, reviewErr.message);
                }
            }

        } catch (err) {
            Logger.error('Error processing order {0}: {1}', orderNo, err.message);
        }
    });

    Logger.info('Completed Unicommerce Job. Updated {0} orders.', updatedCount);
    return new Status(Status.OK, 'OK', 'Fetched and updated Unicommerce Order statuses successfully.');
}

module.exports = {
    getUnicommerceOrderStatus: getUnicommerceOrderStatus
};