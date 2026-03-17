'use strict'
var Logger = require('dw/system/Logger').getLogger('DeleteOldOTPs');
var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var Status = require('dw/system/Status');

function execute() {
    var minutes = 10;
    var now = new Date();
    var cutoffTime = new Date(now.getTime() - minutes * 60 * 1000);

    Logger.info('Starting cleanup: deleting loginCredsMapper entries created before {0}', cutoffTime);

    // Query all custom objects older than cutoff
    var query = 'creationDate <= {0}';
    var iterator = CustomObjectMgr.queryCustomObjects('loginCredsMapper', query, 'creationDate asc', cutoffTime);

    var deletedCount = 0;

    try {
        while (iterator.hasNext()) {
            var customObj = iterator.next();

            try {
                Transaction.wrap(function() {
                    CustomObjectMgr.remove(customObj);
                });
                deletedCount++;
            } catch (e) {
                Logger.error('Error deleting custom object {0}: {1}', customObj.custom.ID || customObj.key, e.message);
            }
        }
    } finally {
        iterator.close();
    }

    Logger.info('Job complete — Deleted {0} loginCredsMapper records older than {1} minutes.', deletedCount, minutes);
    return new Status(Status.OK);

}

exports.execute = execute