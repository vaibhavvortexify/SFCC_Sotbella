'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var Calendar = require('dw/util/Calendar');
var Transaction = require('dw/system/Transaction');

/**
 * Job: Delete Old Wallet Transactions
 * Deletes 'walletTransaction' custom objects modified older than X hours (configurable).
 */
exports.execute = function (parameters) {
    var logger = Logger.getLogger('DeleteWalletTransactions', 'Job');

    try {
        var hoursToKeep = parameters.hoursToKeep || 24;
        var customObjectType = 'walletTransactions'; 
        // 2. Calculate Threshold Date (Now - X Hours)
        var calendar = new Calendar();
        calendar.add(Calendar.HOUR, -hoursToKeep);
        var thresholdDate = calendar.getTime();

        logger.info('Starting Cleanup for Type: {0}. Configuration: Delete objects older than {1} hours.', customObjectType, hoursToKeep);
        logger.info('Threshold Date: {0}', thresholdDate);

        // 3. Search for Old Objects
        // Query: "lastModified < {0}" means "Older than the threshold date"
        var queryString = "lastModified < {0}";
        var sortString = "lastModified asc"; // Delete oldest first

        var coIterator = CustomObjectMgr.queryCustomObjects(customObjectType, queryString, sortString, thresholdDate);
        var count = coIterator.count;

        logger.info('Found {0} old objects to delete.', count);

        if (count === 0) {
            coIterator.close();
            return new Status(Status.OK, 'OK', 'No objects found older than ' + hoursToKeep + ' hours.');
        }

        // 4. Batch Delete
        var deletedCount = 0;
        var batchSize = 1000; // Limit per transaction for performance
        var currentBatch = 0;

        // Process in chunks to avoid Transaction timeouts
        while (coIterator.hasNext()) {
            Transaction.wrap(function () {
                currentBatch = 0;
                while (coIterator.hasNext() && currentBatch < batchSize) {
                    var co = coIterator.next();
                    CustomObjectMgr.remove(co);
                    deletedCount++;
                    currentBatch++;
                }
            });
            logger.info('Deleted batch of {0} objects. Total deleted so far: {1}', currentBatch, deletedCount);
        }

        coIterator.close();
        
        logger.info('Job Finished. Successfully deleted {0} wallet transactions older than {1} hours.', deletedCount, hoursToKeep);
        return new Status(Status.OK, 'OK', 'Successfully deleted ' + deletedCount + ' wallet transactions.');

    } catch (e) {
        logger.error('Fatal Error in DeleteWalletTransactions job: {0}', e.message);
        return new Status(Status.ERROR, 'ERROR', e.message);
    }
};