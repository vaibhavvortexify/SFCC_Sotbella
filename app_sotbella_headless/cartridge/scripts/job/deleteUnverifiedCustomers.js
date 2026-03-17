'use strict';

var CustomerMgr = require('dw/customer/CustomerMgr');
var File = require('dw/io/File');
var FileWriter = require('dw/io/FileWriter');
var XMLStreamWriter = require('dw/io/XMLStreamWriter');
var Calendar = require('dw/util/Calendar');
var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');

/**
 * Job: Delete Unverified Customers
 * Logic:
 * 1. Search profiles where (isVerified = false OR null) AND lastModified < (Now - X hours).
 * 2. Create unverifiedCustomers.xml in src/UnverifiedCustomers.
 * 3. Write customer entries with mode="delete".
 */
exports.execute = function (parameters, stepExecution) {
    var logger = Logger.getLogger('UnverifiedCustomers', 'DeleteJob');
    var fileWriter, xmlWriter;

    try {
        // 1. Get Parameters
        var hoursThreshold = parameters.hoursThreshold || 24;
        
        // 2. Define Paths using String Concatenation (Fixes the Constructor Error)
        var folderPath = File.IMPEX + '/src/UnverifiedCustomers';
        var fileName = 'unverifiedCustomers.xml';
        var fullFilePath = folderPath + '/' + fileName;

        // 3. Calculate Date Threshold
        var calendar = new Calendar();
        calendar.add(Calendar.HOUR, -hoursThreshold);
        var thresholdDate = calendar.getTime();

        logger.info('Searching for unverified customers modified before: {0}', thresholdDate);

        // 4. Setup Folder
        var folderFile = new File(folderPath);
        if (!folderFile.exists()) {
            folderFile.mkdirs();
        }

        // 5. Setup Export File
        var exportFile = new File(fullFilePath);
        logger.info('Writing to file: {0}', exportFile.fullPath);

        // 6. Setup XML Writer
        fileWriter = new FileWriter(exportFile, 'UTF-8');
        xmlWriter = new XMLStreamWriter(fileWriter);

        // Start XML
        xmlWriter.writeStartDocument('UTF-8', '1.0');
        xmlWriter.writeStartElement('customers');
        xmlWriter.writeAttribute('xmlns', 'http://www.demandware.com/xml/impex/customer/2006-10-31');

        // 7. Execute Search
        var queryString = "(custom.isVerified = {0} OR custom.isVerified = NULL) AND lastModified < {1}";
        var sortString = "customerNo asc";

        var profileIterator = CustomerMgr.searchProfiles(
            queryString,
            sortString,
            false,        // {0} - isVerified is false
            thresholdDate // {1} - Date Threshold
        );

        var count = 0;

        // 8. Iterate and Write
        while (profileIterator.hasNext()) {
            var profile = profileIterator.next();
            var customerNo = profile.getCustomerNo();

            // <customer customer-no="00000001" mode="delete" />
            xmlWriter.writeStartElement('customer');
            xmlWriter.writeAttribute('customer-no', customerNo);
            xmlWriter.writeAttribute('mode', 'delete');
            xmlWriter.writeEndElement(); // </customer>

            count++;
        }

        profileIterator.close();

        // End XML
        xmlWriter.writeEndElement(); // </customers>
        xmlWriter.writeEndDocument();

        // Flush and Close
        xmlWriter.flush();
        xmlWriter.close();
        fileWriter.close();

        logger.info('Exported {0} unverified customers for deletion.', count);

        return new Status(Status.OK, 'OK', 'File generated successfully with ' + count + ' records.');

    } catch (e) {
        logger.error('Fatal Error in DeleteUnverifiedCustomers job: {0}', e.message);
        
        // Ensure resources are closed in case of error
        if (xmlWriter) xmlWriter.close();
        if (fileWriter) fileWriter.close();

        return new Status(Status.ERROR, 'ERROR', e.message);
    }
};