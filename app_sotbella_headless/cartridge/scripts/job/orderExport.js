'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var Order = require('dw/order/Order');
var Transaction = require('dw/system/Transaction');
var callCreateSaleOrder = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCreateSaleOrder;
// var callCreateReversePickup = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCreateReversePickup;
// var callAllocateCourierForReversePickup = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callAllocateCourierForReversePickup;
var UnicommerceCreatOrderService = require('*/cartridge/services/UnicommerceCreateOrderService')
// var UnicommerceReturnServices = require('*/cartridge/services/unicommerceReturnServices');
var RefundHelper = require('*/cartridge/scripts/helpers/refundHelper');
// var callCancelSaleOrder = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCancelSaleOrder;
// var UnicommerceCancelOrderService = require('*/cartridge/services/unicommerceCancelOrderService');
var emailHelper = require('*/cartridge/scripts/helpers/emailHelper')
var ArrayList = require('dw/util/ArrayList');
/**
 * Job Entry Point: Exports Orders to Unicommerce
 * Criteria: custom.UpdateFlowFlag is FALSE or NULL
 */
exports.execute = function (parameters, stepExecution) {
    var logger = Logger.getLogger('OrderExport', 'OrderExport');

    try {
        var queryString = "(custom.UpdateFlowFlag = {0} OR custom.UpdateFlowFlag = NULL) AND (status = {1} OR status = {2})";
        var sortString = "creationDate asc";

        var orderIterator = OrderMgr.searchOrders(queryString, sortString, false,Order.ORDER_STATUS_NEW,Order.ORDER_STATUS_OPEN);

        logger.info('Found {0} orders to process for export.', orderIterator.count);

        while (orderIterator.hasNext()) {
            var order = orderIterator.next();
            // var isReturnRejected = false; // Flag to track status across PLIs
            var isCancelled = false; // [NEW] Flag for Cancelled Status
            // var isReturned = false; // Flag for Returned Status
            // var isExchanged = false;
            var flowUpdated = false;
            //commented as handled by Return and Exchange Dashboard
            // var isReturnInitiated = false; // Flag for Return Initiated Status
            // var isExchangeInitiated = false; // Flag for Exchange Initiated Status
            // var isExchangeRejected = false;
            // var isReturnRequested = fals
            // var isExchangeRequested = false
            // List to hold SKUs for cancellation
            var cancelledSkus = [];
            //List to hold returned skus
            // var returnedSkus = [];
            // var returnedRejectedPlis = new ArrayList();
            // //exchnanged skus whose balance we need to refund or check
            // var exchangedSkus = [];
            // //exchanged and reject plis skus
            // var exchangedAndRejectedSkus = [];
            // //return Accepted Skus to process reverse pickup
            // var returnAcceptedSkus = []
            // // Exchnage Acccepted skus
            // var exchangeAcceptedSkus = []
            try {
                // STEP 1: CHECK EXPORT STATUS & CREATE SALE ORDER
                if (order.exportStatus.value === Order.EXPORT_STATUS_NOTEXPORTED) {
                    // Call the helper wrapper which handles token generation/refresh
                    var createOrderRes = callCreateSaleOrder(order, function (order, token) {
                        return UnicommerceCreatOrderService.createSaleOrder(order, token);
                    });
                    if (createOrderRes.object.successful == false) {
                        logger.error('Unicommerce: Failed to create order on unicommerce for Order {0}.', order.orderNo);
                    } else {
                        logger.info('Unicommerce: Successfully created order for Order {0}.', order.orderNo);
                        // Transaction: Update Export Status AND Flow Flag
                        Transaction.wrap(function () {
                            order.setExportStatus(Order.EXPORT_STATUS_EXPORTED); // Mark as Exported
                            order.custom.UpdateFlowFlag = true; // Mark flow as complete
                        });
                        flowUpdated = true;
                    }
                }
            } catch (error) {
                logger.error('Failed to createSaleOrder {0}: {1}', order.getOrderNo(), error.message);
            }

            try {
                // 1. Iterate through Product Line Items to check status
                var productLineItems = order.getProductLineItems();
                var pliIter = productLineItems.iterator();

                while (pliIter.hasNext()) {
                    var pli = pliIter.next();


                    // Use loose equality (==) to handle both Number(20) and String("20")
                    if ('lineItemStatus' in pli.custom && pli.custom.lineItemStatus !== null) {
                        var status = pli.custom.lineItemStatus;
                        var sku = pli.getProductID();
                        //commented as handled by Return and Exchange Dashboard

                        // if (status == 20) {
                        //     logger.info('Order {0} | PLI {1}: Found Return Rejected status (20).', order.getOrderNo(), pli.getProductID());
                        //     isReturnRejected = true;
                        //     returnedRejectedPlis.add(pli);
                        //     emailHelper.sendReturnRejectedEmail(order,returnedRejectedPlis);
                        // }
                        if (status == 3) { // Cancelled (refund processing)
                            // Add to list if not already present (avoid duplicates)
                            if (cancelledSkus.indexOf(sku) === -1) {
                                cancelledSkus.push(sku);
                            }
                        }
                        //commented as handled by Return and Exchange Dashboard

                        // if (status == 19 || status == 23) { // Return Accepted or Exchange Accepted
                        //     logger.info('Order {0} | PLI {1}: Found Return Accepted (19) or Exchange Accepted (23). Processing Reverse Pickup.', order.getOrderNo(), pli.getProductID());
                        //     if(returnAcceptedSkus.indexOf(sku) === -1 && status ==19){
                        //         returnAcceptedSkus.push(sku);
                        //     }
                        //     else{
                        //         if(exchangeAcceptedSkus.indexOf(sku)==-1){
                        //             exchangeAcceptedSkus.push(sku);
                        //         }
                        //     }
                        // }
                        // if (status == 17) { // Returned
                        //     // Add to list if not already present (avoid duplicates)
                        //     if (returnedSkus.indexOf(sku) === -1) {
                        //         returnedSkus.push(sku);
                        //     }
                        // }
                        // if (status == 16) { // Exchanged
                        //     if (exchangedSkus.indexOf(sku) === -1) {
                        //         exchangedSkus.push(sku);
                        //     }
                        // }
                        // if (status == 22) { //Exchange Rejected
                        //     if (exchangedAndRejectedSkus.indexOf(sku) === -1) {
                        //         exchangedAndRejectedSkus.push(sku);
                        //     }
                        // }
                        // if(status==18){ // Return requested
                        //     isReturnRequested = true
                        // }
                        // if(status==21){ // Exchange requested
                        //     isExchangeRequested = true
                        // }

                    }
                }
                if (cancelledSkus.length > 0) {
                    logger.info('Order {0}: Processing Cancellation & Refund for SKUs: {1}', order.getOrderNo(), cancelledSkus.join(', '));
                    // 1. Call Cancel Line Items Logic (Pass list)
                     isCancelled =  refundPlis(order, cancelledSkus, false); // false means isReturnContext
                    // Mark as processed so Order Level flag updates at the end
                     
                }
                //commented as handled by Return and Exchange Dashboard

                //returned case
                // if (returnedSkus.length > 0) {
                //    isReturned =  refundPlis(order, returnedSkus, true); // true means isReturnContext
                // }
                //return accepted case
                
                // if(returnAcceptedSkus.length >0){
                //     var isReturnedSuccess = processReverseLogistics(order.getOrderNo(), returnAcceptedSkus, 19)
                //     if(isReturnedSuccess!=undefined){
                //         isReturnInitiated = isReturnedSuccess
                //     }
                // }
                // if(exchangeAcceptedSkus.length >0){
                //     var isExchangedSuccess = processReverseLogistics(order.getOrderNo(), exchangeAcceptedSkus, 23)
                //     if(isExchangedSuccess!=undefined){
                //         isExchangeInitiated = isExchangedSuccess
                //     }
                // }
                // //exchanged case
                // if (exchangedSkus.length > 0) {
                //     isExchanged = refundExchangeAmount(order, exchangedSkus);
                // }
                // if (exchangedAndRejectedSkus.length > 0) {
                //     logger.info('Processing Exchange Rejection for SKUs: {0}', exchangedAndRejectedSkus.join(', '));
                //     isExchangeRejected = processExchangeRejected(order, exchangedAndRejectedSkus);
                // }
                
                // 2. Update Order Flag if condition met
                // if (isReturnRejected || isCancelled || isReturnInitiated || isReturned || isExchanged || isExchangeInitiated || isExchangeRejected) {
                //     Transaction.wrap(function () {
                //         logger.info('Order {0}: Updating UpdateFlowFlag to TRUE.', order.getOrderNo());
                //         order.custom.UpdateFlowFlag = true;

                //         if ((isReturnRejected || isReturned) && !isReturnInitiated && !isReturnRequested) {
                //             order.custom.returnProcessing = false; // Clears the value
                //             logger.info('Order {0}: Cleared custom.returnProcessing because Return was Rejected ', order.getOrderNo());
                //         }
                //         if((isExchangeRejected || isExchanged) && !isExchangeInitiated && !isExchangeRequested){
                //             order.custom.exchangeProcessing = false; // Clears the value
                //             logger.info('Order {0}: Cleared custom.exchangeProcessing because Exchange was Rejected', order.getOrderNo());
                //         }
                //     });
                // }
                if(isCancelled){
                    Transaction.wrap(function () {
                        logger.info('Order {0}: Updating UpdateFlowFlag to TRUE.', order.getOrderNo());
                        order.custom.UpdateFlowFlag = true;
                    })
                }

            } catch (orderError) {
                logger.error('Failed to process order {0}: {1}', order.getOrderNo(), orderError.message);
            }
        }

        orderIterator.close();

        return new Status(Status.OK, 'OK', 'Order export finished.');

    } catch (e) {
        logger.error('Fatal Error in OrderExport job: {0}', e.message);
        return new Status(Status.ERROR, 'ERROR', e.message);
    }
};
//commented as handled by Return and Exchange Dashboard

// /**
//  * Handles Reverse Pickup and Courier Allocation for specific SKUs.
//  * Calls services ONCE per SKU, then updates all matching PLIs.
//  * * @param {string} orderNo - The Order ID
//  * @param {Array} skuList - List of SKUs to process
//  * @param {number} triggerStatus - The status triggering this flow (19 for Return, 23 for Exchange)
//  */
// function processReverseLogistics(orderNo, skuList, triggerStatus) {
//     var Logger = require('dw/system/Logger').getLogger('ReverseLogistics');
//     var OrderMgr = require('dw/order/OrderMgr');
//     var Transaction = require('dw/system/Transaction');

//     var order = OrderMgr.getOrder(orderNo);
//     if (!order) {
//         Logger.error('Order {0} not found.', orderNo);
//         return;
//     }

//     var productLineItems = order.getProductLineItems();
//     var success = true;
//     // Iterate through the unique SKU list provided
//     skuList.forEach(function (sku) {
//         Logger.info('Starting Reverse Logistics sequence for Order {0} | SKU {1}', orderNo, sku);

//         try {
//             // 1. Find a representative PLI to get Reason and MediaLinks
//             // We need this data for the Service Call
//             var representativePli = null;
//             var pliIter = productLineItems.iterator();
            
//             while (pliIter.hasNext()) {
//                 var p = pliIter.next();
//                 if (p.getProductID() === sku) {
//                     representativePli = p;
//                     break; // Found one, that's enough for data extraction
//                 }
//             }

//             if (!representativePli) {
//                 Logger.error('SKU {0} not found in Order {1} line items.', sku, orderNo);
//                 return; // Skip to next SKU
//             }

//             // 2. Extract Data for Service Call
//             var reason = 'Reason' in representativePli.custom ? representativePli.custom.Reason : 'Other';
//             var customerImageUrl = '';
//             if ('MediaLinks' in representativePli.custom && representativePli.custom.MediaLinks && representativePli.custom.MediaLinks.length > 0) {
//                 customerImageUrl = representativePli.custom.MediaLinks[0];
//             }

//             // 3. Service Call: Create Reverse Pickup
//             var revPickupRes = callCreateReversePickup(order, sku, reason, customerImageUrl, function (order, returnContext, token) {
//                 // Assuming UnicommerceReturnServices is available in scope or required
//                 return UnicommerceReturnServices.createReversePickup(order, returnContext, token);
//             });

//             // 4. Validate Pickup Response
//             if (!revPickupRes || !revPickupRes.object || revPickupRes.object.successful === false) {
//                 var errorMsg = revPickupRes && revPickupRes.errorMessage ? revPickupRes.errorMessage : 'Unknown Error';
//                 Logger.error('Failed CreateReversePickup for Order {0} SKU {1}: {2}', orderNo, sku, errorMsg);
//                 success = false; return; // Skip rest of logic    for this SKU
//             }

//             var reversePickupCode = revPickupRes.object.reversePickupCode;
//             if (!reversePickupCode) {
//                 Logger.error('Reverse Pickup Code not found in response for Order {0} SKU {1}', orderNo, sku);
//                 success = false; return; // Skip rest of logic for this SKU
//             }
//             Logger.info('Generated Reverse Pickup Code: {0} for Order {1} SKU {2}', reversePickupCode, orderNo, sku);

//             // 5. Service Call: Allocate Courier
//             var allocateCourierRes = callAllocateCourierForReversePickup(reversePickupCode, function (reversePickupCode, token) {
//                 return UnicommerceReturnServices.allocateCourierForReversePickup(reversePickupCode, token);
//             });
            
//             // Check if allocation call itself succeeded (checking the service wrapper response)
//             // Adjust this check based on your actual allocateCourierRes object structure (e.g. .ok or .object.successful)
//             if (!allocateCourierRes || (allocateCourierRes.object && allocateCourierRes.object.successful === false)) {
//                  Logger.error('Failed Allocate Courier for Code {0}', reversePickupCode);
//                  // Decide: Do you want to stop here? Usually yes.
//                  success = false; return;
//             }

//             Logger.info('Successfully Allocated Courier for Order {0}, Code {1}', orderNo, reversePickupCode);
//             // 6. Database Update: Update Status for ALL matching PLIs
//             Transaction.wrap(function () {
//                 var updateIter = productLineItems.iterator();
//                 while (updateIter.hasNext()) {
//                     var pli = updateIter.next();

//                     // Update ALL lines matching this SKU
//                     if (pli.getProductID() === sku) {
//                         if (triggerStatus == 19) {
//                             pli.custom.lineItemStatus = 25; // Return Initiated
//                             var returnAcceptedPlis = new ArrayList();
//                             returnAcceptedPlis.add(pli);
//                             emailHelper.sendReturnAcceptedEmail(order,returnAcceptedPlis);
//                             Logger.info('Order {0} | PLI {1}: Status updated to 25.', orderNo, sku);
//                         } 
//                         else if (triggerStatus == 23) {
//                             pli.custom.lineItemStatus = 26; // Exchange Initiated
//                             Logger.info('Order {0} | PLI {1}: Status updated to 26.', orderNo, sku);
//                         }
//                     }
//                 }
//             });

//         } catch (e) {
//             Logger.error('Exception in processReverseLogistics for Order {0} SKU {1}: {2}', orderNo, sku, e);
//         }
//     });
//     return success;
// }
// /**
//  * Cancel Line Item Logic (Status 3)
//  * Iterates through SKUs, calls Cancel Service, and triggers Refund for successes.
//  * * @param {dw.order.Order} order 
//  * @param {Array} skuList - List of SKUs to cancel
//  */
// function cancelLineItems(order, skuList, isReturnContext) {
//     var logger = Logger.getLogger('OrderExport');
//     var successfullyCancelledSkus = [];
//     var orderNo = order.getOrderNo();

//     // 1. Process Cancellations via Service Call
//     for (var i = 0; i < skuList.length; i++) {
//         var sku = skuList[i];

//         // Define callback to be executed inside the helper (handling token)
//         var apiCallback = function (ordNo, sku, cancelWholeOrder, token) {
//             // Assuming UnicommerceReturnServices has a method to cancel item by SKU
//             return UnicommerceCancelOrderService.cancelSaleOrder(ordNo, sku, cancelWholeOrder, token);
//         };

//         // Call the helper (which you added to UnicommerceServiceCallHelper)
//         var response = callCancelSaleOrder(orderNo, sku, false, apiCallback);

//         if (response.object && response.object.successful) {
//             successfullyCancelledSkus.push(sku);
//             logger.info('Successfully cancelled SKU {0} for Order {1} in Unicommerce.', sku, orderNo);
//         } else {
//             logger.error('Failed to cancel SKU {0} for Order {1}. Message: {2}', sku, orderNo, response.errorMessage);
//         }
//     }

//     // 2. Call Refund Logic ONLY for successful cancellations
//     if (successfullyCancelledSkus.length > 0) {
//         logger.info('Triggering refund for {0} successful items on Order {1}', successfullyCancelledSkus.length, orderNo);
//         refundPlis(order, successfullyCancelledSkus, isReturnContext);
//     }
// }

/**
 * Refund Logic for Cancelled Items
 * Calls Refund Helper ONCE per SKU (aggregated) and updates Status to 24 for all matching items.
 * @param {dw.order.Order} order 
 * @param {Array} skuList - List of successfully cancelled SKUs to refund
 */
function refundPlis(order, skuList, isReturnContext) {
    var logger = Logger.getLogger('OrderExport');
    var productLineItems = order.getProductLineItems();
    var success = true;
    // Iterate through the list of unique SKUs
    skuList.forEach(function (sku) {
        logger.info('Processing Refund for Order {0}, SKU {1}', order.getOrderNo(), sku);

        // 1. Call Refund Helper ONCE per SKU
        // The helper now calculates the total refund for ALL items of this SKU
        var isCancelledContext = !isReturnContext;
        var refundResult = RefundHelper.processRefund(order, sku, isCancelledContext);

        // 2. Check Success
        if (refundResult.success) {
            try {
                // 3. Update Status to 24 for ALL matching PLIs in one Transaction
                Transaction.wrap(function () {
                    var pliIter = productLineItems.iterator();

                    while (pliIter.hasNext()) {
                        var pli = pliIter.next();

                        // Update every line item that matches the refunded SKU
                        if (pli.getProductID() === sku) {
                            var plisToEmail = new ArrayList();
                            plisToEmail.add(pli);
                            emailHelper.sendRefundEmail(order,plisToEmail,refundResult.refundAmount,isCancelledContext);
                            if (!isReturnContext) {
                                //@ts-ignore
                                pli.custom.lineItemStatus = 24; // Cancelled and Refunded
                            }
                            else {
                                //@ts-ignore
                                pli.custom.lineItemStatus = 27; // Returned and Refunded
                            }
                        }
                    }
                    logger.info('Order {0}: Refund Successful for SKU {1}. Updated status to 24 for all matching items.', order.getOrderNo(), sku);
                });

            } catch (e) {
                success = false
                logger.error('Error updating status for Order {0}, SKU {1}: {2}', order.getOrderNo(), sku, e.message);
            }
        } else {
                success = false
            logger.error('Refund failed for Order {0}, SKU {1}: {2}', order.getOrderNo(), sku, refundResult.message);
        }
    });
    return success;
}

// /**
//  * Checks matching PLIs for negative exchange amounts (refund owed).
//  * LOGIC: Takes the exchangeAmount ONCE per SKU (from the first valid PLI found).
//  * * @param {dw.order.Order} order 
//  * @param {Array} exchangedSkus - List of SKUs involved in the exchange
//  */
// function refundExchangeAmount(order, exchangedSkus) {
//     var logger = Logger.getLogger('OrderExport');
//     var productLineItems = order.getProductLineItems();
//     var totalRefundAmount = 0.0;
//     var skusToRefund = [];
//     // Iterate through the unique list of SKUs passed to the function
//     exchangedSkus.forEach(function(sku) {
//         var amountFoundForSku = false; // Flag to ensure we only take amount ONCE per SKU

//         var pliIter = productLineItems.iterator();
//         while (pliIter.hasNext()) {
//             var pli = pliIter.next();
            
//             // Check if PLI matches the current SKU
//             if (pli.getProductID() === sku) {

//                 // If we haven't found an amount for this SKU yet...
//                 if (!amountFoundForSku) {
//                     // Check for negative exchange amount on this PLI
//                     if ('exchangeAmount' in pli.custom && pli.custom.exchangeAmount < 0) {
//                         var lineAmount = Math.abs(pli.custom.exchangeAmount);
                        
//                         // Add to total
//                         totalRefundAmount += lineAmount;
                        
//                         // Mark as found so we don't add it again for other PLIs of the SAME SKU
//                         amountFoundForSku = true; 

//                         // Track SKU for logging
//                         if (skusToRefund.indexOf(sku) === -1) {
//                             skusToRefund.push(sku);
//                         }
//                     }
//                 }
//             }
//         }
//     });

//     if (totalRefundAmount > 0) {
//         logger.info('Order {0}: Found Total Negative Exchange Amount ({1}) across SKUs: {2}. Triggering refund.',
//             order.getOrderNo(), totalRefundAmount, skusToRefund.join(', '));

//         return refundExchangedAmount(order, exchangedSkus, totalRefundAmount);
//     } else {
//         logger.info('Order {0}: No negative exchange amount found. Proceeding to status update.', order.getOrderNo());
//         return refundExchangedAmount(order, exchangedSkus, 0); 
//     }
// }

// /**
//  * Refunds the specific exchange amount (if any) and updates PLI status to 28.
//  * Resets PLI exchangeAmount to 0.
//  * * @param {dw.order.Order} order 
//  * @param {Array} skuList - List of SKUs to update status for
//  * @param {number} amount - The positive amount to refund (can be 0 if just status update needed)
//  */
// function refundExchangedAmount(order, skuList, amount) {
//     var logger = Logger.getLogger('OrderExport');
//     var productLineItems = order.getProductLineItems();
//     var refundSuccess = true;
//     // 1. Process Money Refund (Only if amount > 0)
//     var refundResult ;
//     if (amount > 0 && amount!=0) {
//         refundResult = RefundHelper.processManualRefund(order, amount);
        
//         if (refundResult.success) {
//             logger.info('Order {0}: Exchange Refund Successful. Amount: {1}. Proceeding to status update.', order.getOrderNo(), amount);
//         } else {
//             logger.error('Exchange Refund failed for Order {0}: {1}. Status update aborted.', order.getOrderNo(), refundResult.message);
//             refundSuccess = false;
//         }
//     } else {
//         logger.info('Order {0}: Exchange refund amount is 0. Skipping refund call, proceeding directly to status update.', order.getOrderNo());
//     }

//     // 2. Update Status & Reset Attributes (If refund succeeded OR amount was 0)
//     if (refundSuccess) {
//         try {
//             Transaction.wrap(function () {
                
//                 // We iterate through the specific SKUs passed to this function
//                 skuList.forEach(function (sku) {
//                     var pliIter = productLineItems.iterator();
//                     while (pliIter.hasNext()) {
//                         var pli = pliIter.next();

//                         if (pli.getProductID() === sku) {
//                         var plisToEmail = new ArrayList();
//                         plisToEmail.add(pli);
//                         emailHelper.sendRefundEmail(order,plisToEmail,refundResult.refundAmount,false);
//                             // A. Update Status to 28 (Exchanged And Refunded/Settled)
//                                 pli.custom.lineItemStatus = 28; 
//                             // B. Reset PLI-level exchangeAmount to 0
//                             if ('exchangeAmount' in pli.custom) {
//                                 pli.custom.exchangeAmount = 0;
//                             }

//                             logger.info('Order {0} | PLI {1}: Updated status to 28 and reset exchangeAmount to 0.', order.getOrderNo(), sku);
//                         }
//                     }
//                 });
                
//             });
//         } catch (e) {
//             logger.error('Error updating status 28 for Order {0}: {1}', order.getOrderNo(), e.message);
//         }
//     }
//     return refundSuccess;
// }

/**
 * Handles logic for Exchange Rejected (Status 29).
 * - Aggregates refund amounts for the specific SKU (taking amount ONCE per SKU).
 * - Refunds ONCE per SKU.
 * - Cancels the linked Exchange Order ONCE.
 * - Updates Status to 29 and Resets exchangeAmount to 0 for ALL matching PLIs.
 * * @param {dw.order.Order} currentOrder - The original order being processed
 * @param {Array} skuList - List of SKUs that were rejected for exchange
 */
// function processExchangeRejected(currentOrder, skuList) {
//     var RefundHelper = require('*/cartridge/scripts/helpers/refundHelper');
    
//     var productLineItems = currentOrder.getProductLineItems();
//     var allSuccess = true;
//     // Iterate through the unique Rejected SKUs
//     skuList.forEach(function (sku) {
        
//         var matchingPlis = [];
//         var totalRefundAmount = 0;
//         var exchangeOrderNo = null;
//         var amountFoundForSku = false; // Flag to ensure we take amount only ONCE per SKU

//         // --- STEP 1: Collect Data (Find all matching PLIs & Calculate Refund) ---
//         var pliIter = productLineItems.iterator();
//         while (pliIter.hasNext()) {
//             var pli = pliIter.next();
//             if (pli.getProductID() === sku) {
//                 matchingPlis.push(pli);

//                 // LOGIC CHANGE: Only take exchangeAmount from the FIRST matching PLI we find for this SKU
//                 if (!amountFoundForSku) {
//                     if ('exchangeAmount' in pli.custom && pli.custom.exchangeAmount > 0) {
//                         totalRefundAmount = Math.abs(pli.custom.exchangeAmount);
//                         amountFoundForSku = true; // Mark as found so we don't add it again for duplicate PLIs
//                     }
//                 }

//                 // Capture the linked exchange order ID (assuming it's the same for the SKU)
//                 if (!exchangeOrderNo && 'exchangeOrder' in pli.custom && pli.custom.exchangeOrder) {
//                     exchangeOrderNo = pli.custom.exchangeOrder;
//                 }
//             }
//         }

//         if (matchingPlis.length === 0) {
//             return; // No PLIs found for this SKU, skip
//         }

//         // --- STEP 2: Process Refund (ONCE per SKU) ---
//         if (totalRefundAmount > 0) {
//             Logger.info('SKU {0} has negative exchange amount ({1}). Triggering manual refund (calculated once).', sku, totalRefundAmount);
//             var orderToRefund = OrderMgr.getOrder(exchangeOrderNo);
//             var refundRes = RefundHelper.processManualRefund(orderToRefund, totalRefundAmount);
            
//             if (refundRes.success) {
//                 emailHelper.sendRefundEmail(orderToRefund,matchingPlis,totalRefundAmount,false);
//                 Logger.info('Manual Refund Successful for SKU {0}. Amount: {1}', sku, totalRefundAmount);
//             } else {
//                 allSuccess = false
//                 Logger.error('Manual Refund Failed for SKU {0}. Reason: {1}', sku, refundRes.message);
//             }
//         }

//         // --- STEP 3: Cancel Linked Exchange Order (ONCE per SKU) ---
//         if (exchangeOrderNo) {
//             var exchangeOrder = OrderMgr.getOrder(exchangeOrderNo);

//             if (exchangeOrder) {
//                 if (exchangeOrder.status.value !== Order.ORDER_STATUS_CANCELLED &&
//                     exchangeOrder.status.value !== Order.ORDER_STATUS_FAILED) {

//                     try {
//                         // API Call
//                         var apiCallback = function (ordNo, sku, cancelWholeOrder, token) {
//                             return UnicommerceCancelOrderService.cancelSaleOrder(ordNo, sku, cancelWholeOrder, token);
//                         };

//                         var response = callCancelSaleOrder(exchangeOrderNo, '', true, apiCallback);

//                         if (response && response.ok && response.object && response.object.successful) {
//                             Logger.info('OMS Service Success: Request sent to cancel Exchange Order {0}.', exchangeOrderNo);
//                         } else {
//                             allSuccess = false
//                             var errMsg = response.errorMessage || (response.object ? response.object.message : 'Unknown Error');
//                             Logger.error('OMS Service Failed: Could not cancel Exchange Order {0}. Error: {1}', exchangeOrderNo, errMsg);
//                         }

//                         // Local Status Update for Linked Order
//                         Transaction.wrap(function () {
//                             exchangeOrder.setStatus(Order.ORDER_STATUS_CANCELLED);
//                             Logger.info('Locally Cancelled Linked Exchange Order {0}.', exchangeOrderNo);
//                         });

//                     } catch (e) {
//                         allSuccess = false
//                         Logger.error('Exception during Exchange Cancellation for {0}: {1}', exchangeOrderNo, e.message);
//                     }
//                 } else {
//                     Logger.warn('Skipping API Call: Linked Exchange Order {0} is already Cancelled or Failed.', exchangeOrderNo);
//                 }
//             } else {
//                 Logger.error('Linked Exchange Order {0} not found in SFCC.', exchangeOrderNo);
//             }
//         }

//         // --- STEP 4: Update All Matching PLIs (Status & Reset Amount) ---
//         Transaction.wrap(function () {
//             matchingPlis.forEach(function(pli) {
//                 // Update Status
//                 pli.custom.lineItemStatus = 29; // Exchange & Cancelled

//                 // Reset Amount to 0 for ALL matching lines to prevent future issues
//                 if ('exchangeAmount' in pli.custom) {
//                     pli.custom.exchangeAmount = 0;
//                 }
//             });
//             Logger.info('Updated {0} PLIs for SKU {1}: Status=29, ExchangeAmount=0.', matchingPlis.length, sku);
//         });
//     });
//     return allSuccess;
// }