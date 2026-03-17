'use strict';

var server = require('server');
var Site = require('dw/system/Site');
var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var Transaction = require('dw/system/Transaction');
var Logger = require('dw/system/Logger');
var CustomObjectMgr = require('dw/object/CustomObjectMgr'); // Required for Wallet
var CustomerMgr = require('dw/customer/CustomerMgr'); // Required to fetch email
var walletHelpers = require('*/cartridge/scripts/helpers/walletHelper'); // Required for wallet credit
/**
 * Webhook to handle Order Creation OR Wallet Top-up from Breeze
 * Endpoint: /BreezeWebhook-CreateOrder
 */
server.post('CreateOrder', server.middleware.https, function (req, res, next) {

    var logger = Logger.getLogger('BreezeWebhook', 'BreezeWebhook');
    var paymentHelpers = require('*/cartridge/scripts/helpers/paymentHelpers.js');
    var sendRefersionDataHelper = require('*/cartridge/scripts/helpers/SendRefersionDataHelper.js');
    var UnicommerceCreatOrderService = require('*/cartridge/services/UnicommerceCreateOrderService')
    var callCreateSaleOrder = require('*/cartridge/scripts/helpers/UnicommerceServiceCallHelper').callCreateSaleOrder;
    var emailHelper = require('*/cartridge/scripts/helpers/emailHelper');


    // 1. AUTHENTICATION: Verify X-Api-Key
    var requestApiKey = req.httpHeaders['x-api-key'];
    var siteApiKey = Site.getCurrent().getCustomPreferenceValue('breezeApiKey');

    if (!requestApiKey || requestApiKey !== siteApiKey) {
        res.setStatusCode(401);
        res.json({
            success: false,
            message: 'Unauthorized: Invalid API Key'
        });
        return next();
    }

    var payload;
    try {
        payload = JSON.parse(req.body);
    } catch (e) {
        logger.error('Failed to parse JSON body: ' + e.message);
        res.setStatusCode(400);
        res.json({
            success: false,
            message: 'Invalid JSON format'
        });
        return next();
    }

    // EXTRACT DATA
    var breezeId = payload.id;
    var content = payload.content || {};
    // This ID could be an OrderNo OR a Wallet Transaction ID
    var referenceId = content.cart ? content.cart.id : null;
    var breezeTxnId = content.txnId;
    var status = content.status; // e.g., "CHARGED" or "SUCCESS"
    var paidAmount = content.payment ? parseFloat(content.payment.amount) : 0.0;
    if (!referenceId) {
        res.setStatusCode(400);
        res.json(createResponse(breezeId, 'FAILED', 'Missing cart.id (Reference ID)', null));
        return next();
    }

    var order = OrderMgr.getOrder(referenceId);

    if (order) {
        try {
            Transaction.wrap(function () {
                // A. Update Payment Instrument with Transaction ID
                var walletResult = paymentHelpers.processWalletPayment(order);
                
                if (!walletResult.success) {
                    //@ts-ignore
                    order.custom.orderStatus = 8;
                    OrderMgr.failOrder(order, true);
                    throw new Error('Wallet Deduction Failed: ' + walletResult.error);
                }
                var paymentInstruments = order.getPaymentInstruments();
                var breezePI = null;

                // Find Breeze Payment Instrument (or fallback to first one)
                var iter = paymentInstruments.iterator();
                while (iter.hasNext()) {
                    var pi = iter.next();
                    if (pi.paymentMethod.equals('BREEZE') || paymentInstruments.length === 1) {
                        breezePI = pi;
                        break;
                    }
                }

                if (breezePI) {
                    // Update the custom attribute and standard transaction ID
                    var paymentTransaction = breezePI.getPaymentTransaction();
                    paymentTransaction.setTransactionID(breezeTxnId);

                    // If status is CHARGED, mark payment as paid
                    if (status === 'SUCCESS' || status === 'CHARGED') {
                        order.setPaymentStatus(Order.PAYMENT_STATUS_PAID);
                        order.setConfirmationStatus(Order.CONFIRMATION_STATUS_CONFIRMED);
                        order.setExportStatus(Order.EXPORT_STATUS_READY);
                        order.custom.orderStatus = 0;

                        var placeOrderStatus = OrderMgr.placeOrder(order);
                        if (placeOrderStatus.isError()) {
                            // @ts-ignore
                            order.custom.orderStatus = 8;
                            OrderMgr.failOrder(order, true);
                            throw new Error('Order placement failed for order ' + order.orderNo);
                        }
                        paymentHelpers.updateTotalOrdersAndSpent(order);
                        sendRefersionDataHelper.sendRefersionData(order);
                        var createOrderRes = callCreateSaleOrder(order, function (order, token) {
                            return UnicommerceCreatOrderService.createSaleOrder(order, token);
                        });
                        emailHelper.sendOrderConfirmMail(order);
                        if (createOrderRes.object.successful == false) {
                            Logger.error('Unicommerce: Failed to create order for Breeze order {0}', order.orderNo);
                        } else {
                            Logger.info('Unicommerce: Successfully created order for Breeze order {0}.', order.orderNo);
                            order.exportStatus = 1;
                            order.custom.UpdateFlowFlag = true;
                        }
                    }

                } else {
                    logger.warn('No suitable payment instrument found for order: ' + referenceId);
                }
            });

            // SUCCESS RESPONSE FOR ORDER
            res.setStatusCode(200);
            res.json(createResponse(breezeId, 'SUCCESS', 'Order placed successfully', {
                orderId: order.getOrderNo(),
            }));

        } catch (e) {
            logger.error('Error processing order ' + referenceId + ': ' + e.message);
            // Optional: Fail order if processing crashed
            Transaction.wrap(function () {
                OrderMgr.failOrder(order, true);
                order.custom.orderStatus = 8;
            });

            res.setStatusCode(500);
            res.json(createResponse(breezeId, 'FAILED', 'Internal Server Error: ' + e.message, null));
        }
        return next();
    }

    // ============================================================
    // SCENARIO B: IT IS A WALLET TRANSACTION (New Logic)
    // ============================================================
    else {
        // Try to find the Custom Object using the ID
        var walletTxn = CustomObjectMgr.getCustomObject('walletTransactions', referenceId);

        if (walletTxn) {
            try {
                var updateSuccess = false;
                var failMessage = "";

                Transaction.wrap(function () {
                    // 1. Update Breeze Transaction ID
                    walletTxn.custom.breezeTxnId = breezeTxnId;

                    // 2. Validate Amount
                    var storedAmount = walletTxn.custom.amount;

                    if (Math.abs(storedAmount - paidAmount) > 0.01) {
                        walletTxn.custom.status = 'failed';
                        failMessage = "Amount Mismatch: Expected " + storedAmount + " but got " + paidAmount;
                        logger.error('Wallet Txn ' + referenceId + ': ' + failMessage);
                    }
                    // 3. Update Status based on Gateway Status
                    else if (status === 'SUCCESS') {
                        walletTxn.custom.status = 'success';
                        updateSuccess = true;


                    } else {
                        walletTxn.custom.status = 'failed';
                        failMessage = "Payment Gateway returned status: " + status;
                    }
                });

                if (updateSuccess) {
                    var customerno  = walletTxn.custom.customerNo;
                    var profile = CustomerMgr.getProfile(customerno);
                    if(profile && profile.email){
                        var creditResult = walletHelpers.creditCustomerWallet(
                            profile.email,                // email from profile
                            paidAmount,                   // amount
                            'wallet',                     // type
                            'Wallet Top-up via Breeze',   // description
                            'Breeze Txn: ' + breezeTxnId, // remarks
                            breezeTxnId                   // referenceId
                        );
                        if (creditResult.success) {
                            res.setStatusCode(200);
                            res.json(createResponse(breezeId, 'SUCCESS', 'Wallet transaction updated and credited successfully', {
                                orderId: referenceId
                            }));
                        }
                        else{
                            Transaction.wrap(function() {
                                walletTxn.custom.status = 'failed';
                            });
                            var errorMessage = 'Payment Success but Wallet Credit Failed: ' + (creditResult.error || 'Unknown Error');
                            logger.error(errorMessage);
                            res.setStatusCode(200);
                            res.json(createResponse(breezeId, 'FAILED', errorMessage, {
                                orderId: referenceId
                            }));
                        }

                    }
                    else{
                        Transaction.wrap(function() {
                            walletTxn.custom.status = 'failed';
                        })
                        res.setStatusCode(404);
                        res.json(createResponse(breezeId,'FAILED','Customer Not found :',{
                            orderId:referenceId
                        }))
                    }
                } else {
                    res.setStatusCode(200); // We still return 200 to acknowledge webhook, but payload says failed
                    res.json(createResponse(breezeId, 'FAILED', 'Wallet transaction failed: ' + failMessage, {
                        orderId: referenceId
                    }));
                }

            } catch (e) {
                logger.error('Error processing wallet txn ' + referenceId + ': ' + e.message);
                res.setStatusCode(500);
                res.json(createResponse(breezeId, 'FAILED', 'Internal Wallet Error: ' + e.message, null));
            }
            return next();
        }
        else {
            logger.error('Reference ID not found in Orders or Wallet: ' + referenceId);
            res.setStatusCode(404);
            res.json(createResponse(breezeId, 'FAILED', 'Order/Transaction not found', null));
            return next();
        }
    }
});

/**
 * Helper to structure the response body according to requirements
 */
function createResponse(id, status, message, content) {
    return {
        id: id || '',
        status: status,
        message: message,
        content: content || {}
    };
}

module.exports = server.exports();