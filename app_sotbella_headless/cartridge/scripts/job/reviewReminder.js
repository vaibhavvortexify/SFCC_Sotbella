'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var Calendar = require('dw/util/Calendar');
var Transaction = require('dw/system/Transaction');
var ArrayList = require('dw/util/ArrayList');
var StringUtils = require('dw/util/StringUtils');

// Import Helpers
var ReviewHelper = require('*/cartridge/scripts/helpers/reviewHelper');

/**
 * Helper to compare two dates (Year, Month, Day only)
 * Returns true if cal1 and cal2 represent the same calendar day.
 */
function isSameDate(date1, date2) {
    if (!date1 || !date2) return false;
    
    var cal1 = new Calendar(date1);
    var cal2 = new Calendar(date2);
    
    // Format both to YYYY-MM-DD to compare strictly by date (ignoring time)
    var d1 = StringUtils.formatCalendar(cal1, 'yyyy-MM-dd');
    var d2 = StringUtils.formatCalendar(cal2, 'yyyy-MM-dd');
    
    return d1 === d2;
}

/**
 * Job: Send Review Reminders
 * Logic: 
 * 1. Fetch ALL Orders where:
 * - Status = 12 (Delivered)
 * - reviewReminderSent = false/null
 * - isMigrated = false/null
 * 2. Filter PLIs where:
 * - Status = 5 (Delivered)
 * - DeliveredDate = (Today - fetchOrderDays)
 * 3. Send Email for valid PLIs.
 */
exports.execute = function (parameters, stepExecution) {
    var logger = Logger.getLogger('ReviewReminder', 'ReviewReminder');

    try {
        // 1. Get Parameter: Fetch Order Days (The Threshold)
        var thresholdDays = parameters.reviewReminderThreshold;
        if (!thresholdDays) {
            logger.warn('fetchOrderDays parameter is missing or 0. Defaulting to 1 day.');
            thresholdDays = 1;
        }

        // 2. Calculate Target Delivery Date (Today - Threshold)
        // If today is Dec 18 and threshold is 7, we look for items delivered on Dec 11.
        var targetCalendar = new Calendar(); 
        targetCalendar.add(Calendar.DAY_OF_YEAR, -thresholdDays);
        var targetDate = targetCalendar.getTime();

        logger.info('Looking for items delivered on: {0} (Today - {1} days)', StringUtils.formatCalendar(targetCalendar, 'yyyy-MM-dd'), thresholdDays);

        // 3. Build Query
        // Removed the "lastModified" constraint.
        var queryString = "custom.orderStatus = {0} AND (custom.reviewReminderSent = {1} OR custom.reviewReminderSent = NULL) AND (custom.isMigrated = {2} OR custom.isMigrated = NULL)";
        var sortString = "lastModified desc";

        // 4. Execute Search
        var orderIterator = OrderMgr.searchOrders(
            queryString,
            sortString,
            12,           // {0} - Custom Status 12 (Delivered)
            false,        // {1} - reviewReminderSent is false
            false         // {2} - isMigrated is false
        );

        logger.info('Found {0} potential orders to check.', orderIterator.count);

        // 5. Iterate Orders
        while (orderIterator.hasNext()) {
            var order = orderIterator.next();
            var orderNo = order.getOrderNo();

            try {
                var productLineItems = order.getProductLineItems();
                var pliIter = productLineItems.iterator();
                var validPLIs = new ArrayList();

                // 6. Filter Product Line Items
                while (pliIter.hasNext()) {
                    var pli = pliIter.next();

                    // Skip if specific line already sent
                    if (pli.custom.reviewReminderSent === true) {
                        continue;
                    }

                    // Check 1: Status is Delivered (5)
                    // Check 2: Delivered Date matches Target Date (Ignoring Time)
                    if (pli.custom.lineItemStatus == 5 && pli.custom.deliveredDate) {
                        
                        // Strict Date Comparison
                        if (isSameDate(pli.custom.deliveredDate, targetDate)) {
                            validPLIs.add(pli);
                        }
                    }
                }

                // 7. Process Valid PLIs
                if (!validPLIs.isEmpty()) {
                    logger.info('Order {0}: Found {1} items delivered on {2}. Sending Email.', orderNo, validPLIs.size(), StringUtils.formatCalendar(targetCalendar, 'yyyy-MM-dd'));

                    // Call Helper (Pass 'true' for reminderContext)
                    var result = ReviewHelper.sendOrderReviewReminder(order, validPLIs, true);

                    if (result.success) {
                        Transaction.wrap(function () {
                            // A. Update Order Level Flag (Assuming we only send one reminder per order)
                            // If you want to allow multiple reminders for different shipments, you might NOT want to set this to true yet.
                            // But per your previous request:
                            order.custom.reviewReminderSent = true;

                            // B. Update PLI Level Flags
                            var validPliIter = validPLIs.iterator();
                            while (validPliIter.hasNext()) {
                                var validPli = validPliIter.next();
                                validPli.custom.reviewReminderSent = true;
                            }
                        });

                        if (result.skipped) {
                            logger.info('Order {0} processed but no email sent (all items reviewed/skipped).', orderNo);
                        } else {
                            logger.info('Order {0} success. Email sent.', orderNo);
                        }
                    } else {
                        logger.error('Failed to process Order {0}. Error: {1}', orderNo, result.error);
                    }
                }

            } catch (innerErr) {
                logger.error('Exception processing Order {0}: {1}', orderNo, innerErr.message);
            }
        }

        orderIterator.close();
        return new Status(Status.OK, 'OK', 'Review reminder job finished.');

    } catch (e) {
        logger.error('Fatal Error in ReviewReminder job: {0}', e.message);
        return new Status(Status.ERROR, 'ERROR', e.message);
    }
};